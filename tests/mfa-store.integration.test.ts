import { issueEnrollmentGrant, consumeEnrollmentGrant } from '../backend/api/src/reauth-grants';
import { replaceRecoveryCodes, consumeRecoveryCode } from '../backend/api/src/mfa-recovery';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { MfaSecrets } from '../backend/api/src/mfa-secrets';
import { MfaStore } from '../backend/api/src/mfa-store';
import { totpAt } from '../backend/api/src/totp';

if (!process.env['P05_TEST_AUTH_URL']) throw new Error('Use npm run test:postgres');
const auth = new Pool({ connectionString: process.env['P05_TEST_AUTH_URL'], max: 5 });
const admin = new Pool({ connectionString: process.env['P04_TEST_ADMIN_URL'] });
const runtime = new Pool({ connectionString: process.env['P04_TEST_DATABASE_URL'] });
const key = randomBytes(32);
const box = new MfaSecrets(key);
const store = new MfaStore(auth, box);
async function user() {
  const id = randomUUID();
  await admin.query('INSERT INTO app.users(id) VALUES($1)', [id]);
  return id;
}
async function now() {
  return Number(
    (
      await admin.query<{ seconds: string }>(
        'SELECT floor(extract(epoch FROM clock_timestamp())) AS seconds',
      )
    ).rows[0]!.seconds,
  );
}
beforeAll(async () => {
  await auth.query('SELECT 1');
});
afterAll(async () => {
  await Promise.all([auth.end(), admin.end(), runtime.end()]);
});

it('confirms possession, stores ciphertext and accepts exactly one of five concurrent replays', async () => {
  const id = await user();
  const enrollment = await store.beginEnrollment(id);
  const timestamp = await now();
  expect(await store.consumeActive(id, totpAt(enrollment.secret, timestamp))).toBe(false);
  expect(await store.confirmEnrollment(id, totpAt(enrollment.secret, timestamp - 30))).toBe(true);
  await expect(store.beginEnrollment(id)).rejects.toThrow();
  const otherInstance = new MfaStore(auth, new MfaSecrets(key));
  const code = totpAt(enrollment.secret, timestamp);
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      (index % 2 ? store : otherInstance).consumeActive(id, code),
    ),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  const row = (await admin.query('SELECT * FROM app.mfa_factors WHERE user_id=$1', [id])).rows[0]!;
  expect(JSON.stringify(row).includes(enrollment.secret)).toBe(false);
  expect(row.active).toBe(true);
  expect(Number(row.last_used_step)).toBe(Math.floor(timestamp / 30));
});

it('commits failed attempts, locks out across instances and preserves limits when enrollment changes', async () => {
  const id = await user();
  await store.beginEnrollment(id);
  for (let i = 0; i < 5; i++) expect(await store.confirmEnrollment(id, 'invalid')).toBe(false);
  const enrollment = await store.beginEnrollment(id);
  const another = new MfaStore(auth, new MfaSecrets(key));
  expect(await another.confirmEnrollment(id, totpAt(enrollment.secret, await now()))).toBe(false);
  const row = (
    await admin.query('SELECT failed_attempts,locked_until FROM app.mfa_factors WHERE user_id=$1', [
      id,
    ])
  ).rows[0]!;
  expect(row.failed_attempts).toBe(5);
  expect(row.locked_until).toBeInstanceOf(Date);
  await admin.query(
    "UPDATE app.mfa_factors SET locked_until=now()-interval '1 second' WHERE user_id=$1",
    [id],
  );
  expect(await another.confirmEnrollment(id, totpAt(enrollment.secret, await now()))).toBe(true);
});

it('rejects expired enrollment and ciphertext copied from another user', async () => {
  const a = await user();
  const b = await user();
  const first = await store.beginEnrollment(a);
  await store.beginEnrollment(b);
  await admin.query(
    "UPDATE app.mfa_factors SET created_at=now()-interval '11 minutes' WHERE user_id=$1",
    [a],
  );
  expect(await store.confirmEnrollment(a, totpAt(first.secret, await now()))).toBe(false);
  await admin.query(
    'UPDATE app.mfa_factors SET envelope=(SELECT envelope FROM app.mfa_factors WHERE user_id=$1) WHERE user_id=$2',
    [a, b],
  );
  await expect(store.confirmEnrollment(b, totpAt(first.secret, await now()))).rejects.toThrow(
    'could not be decrypted',
  );
});

it('enforces own-user RLS and keeps factors inaccessible to the financial runtime', async () => {
  const a = await user();
  const b = await user();
  await store.beginEnrollment(a);
  await store.beginEnrollment(b);
  const client = await auth.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id',$1,true)", [a]);
    expect(
      (await client.query('SELECT user_id FROM app.mfa_factors WHERE user_id=$1', [b])).rowCount,
    ).toBe(0);
    expect(
      (await client.query('UPDATE app.mfa_factors SET failed_attempts=0 WHERE user_id=$1', [b]))
        .rowCount,
    ).toBe(0);
    await client.query('ROLLBACK');
    expect((await client.query('SELECT user_id FROM app.mfa_factors')).rowCount).toBe(0);
  } finally {
    client.release();
  }
  await expect(runtime.query('SELECT * FROM app.mfa_factors')).rejects.toMatchObject({
    code: '42501',
  });
});

it('recovery codes are isolated, atomic, replaceable and survive transaction rollback', async () => {
  const a = await user();
  const b = await user();
  for (const id of [a, b]) {
    const enrollment = await store.beginEnrollment(id);
    expect(await store.confirmEnrollment(id, totpAt(enrollment.secret, await now()))).toBe(true);
  }
  async function transaction<T>(
    id: string,
    work: (client: import('pg').PoolClient) => Promise<T>,
    rollback = false,
  ) {
    const client = await auth.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.user_id',$1,true)", [id]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,5))', [id]);
      const result = await work(client);
      await client.query(rollback ? 'ROLLBACK' : 'COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const codes = await transaction(a, (client) => replaceRecoveryCodes(client, a));
  expect(codes).toHaveLength(10);
  const rows = (await admin.query('SELECT * FROM app.mfa_recovery_codes WHERE user_id=$1', [a]))
    .rows;
  expect(rows).toHaveLength(10);
  expect(codes.some((code) => JSON.stringify(rows).includes(code))).toBe(false);
  expect(await transaction(b, (client) => consumeRecoveryCode(client, a, codes[0]))).toBe(false);
  expect(await transaction(b, (client) => consumeRecoveryCode(client, b, codes[0]))).toBe(false);
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      transaction(a, (client) => consumeRecoveryCode(client, a, codes[0])),
    ),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await transaction(a, (client) => consumeRecoveryCode(client, a, codes[1]), true)).toBe(
    true,
  );
  expect(await transaction(a, (client) => consumeRecoveryCode(client, a, codes[1]))).toBe(true);
  const replacement = await transaction(a, (client) => replaceRecoveryCodes(client, a));
  expect(await transaction(a, (client) => consumeRecoveryCode(client, a, codes[2]))).toBe(false);
  expect(await transaction(a, (client) => consumeRecoveryCode(client, a, replacement[0]))).toBe(
    true,
  );
  await expect(runtime.query('SELECT * FROM app.mfa_recovery_codes')).rejects.toThrow();
});

it('activation issues one recovery batch and never reveals it on replay', async () => {
  const id = await user();
  const enrollment = await store.beginEnrollment(id);
  expect(await store.confirmEnrollmentWithRecovery(id, 'invalid')).toBeNull();
  expect(
    (await admin.query('SELECT * FROM app.mfa_recovery_codes WHERE user_id=$1', [id])).rowCount,
  ).toBe(0);
  const code = totpAt(enrollment.secret, await now());
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => store.confirmEnrollmentWithRecovery(id, code)),
  );
  expect(responses.filter(Boolean)).toHaveLength(1);
  const issued = responses.find((value) => value !== null)!;
  expect(issued.recoveryCodes).toHaveLength(10);
  const stored = (await admin.query('SELECT * FROM app.mfa_recovery_codes WHERE user_id=$1', [id]))
    .rows;
  expect(stored).toHaveLength(10);
  expect(issued.recoveryCodes.some((value) => JSON.stringify(stored).includes(value))).toBe(false);
  expect(await store.confirmEnrollmentWithRecovery(id, code)).toBeNull();
});

it('enrollment grants bind to a live session and permit only one concurrent consumption', async () => {
  const a = await user();
  const b = await user();
  const session = randomUUID();
  const other = randomUUID();
  for (const [id, sid] of [
    [a, session],
    [a, other],
    [b, randomUUID()],
  ])
    await admin.query('INSERT INTO app.sessions(user_id,id,token_hash) VALUES($1,$2,$3)', [
      id,
      sid,
      randomBytes(32).toString('hex'),
    ]);
  async function tx<T>(id: string, work: (client: import('pg').PoolClient) => Promise<T>) {
    const client = await auth.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.user_id',$1,true)", [id]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const first = await tx(a, (c) => issueEnrollmentGrant(c, a, session));
  expect(await tx(a, (c) => consumeEnrollmentGrant(c, a, other, first.grant))).toBe(false);
  await expect(tx(b, (c) => consumeEnrollmentGrant(c, a, session, first.grant))).rejects.toThrow();
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      tx(a, (c) => consumeEnrollmentGrant(c, a, session, first.grant)),
    ),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  const old = await tx(a, (c) => issueEnrollmentGrant(c, a, session));
  const fresh = await tx(a, (c) => issueEnrollmentGrant(c, a, session));
  expect(await tx(a, (c) => consumeEnrollmentGrant(c, a, session, old.grant))).toBe(false);
  await admin.query(
    "UPDATE app.reauth_grants SET created_at=now()-interval '10 minutes',expires_at=now()-interval '5 minutes' WHERE user_id=$1",
    [a],
  );
  expect(await tx(a, (c) => consumeEnrollmentGrant(c, a, session, fresh.grant))).toBe(false);
  const revoked = await tx(a, (c) => issueEnrollmentGrant(c, a, session));
  await admin.query('UPDATE app.sessions SET revoked_at=now() WHERE user_id=$1', [a]);
  await expect(
    tx(a, (c) => consumeEnrollmentGrant(c, a, session, revoked.grant)),
  ).rejects.toThrow();
  await expect(runtime.query('SELECT * FROM app.reauth_grants')).rejects.toThrow();
});
