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
