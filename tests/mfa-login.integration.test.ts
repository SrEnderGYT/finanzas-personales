import { replaceRecoveryCodes } from '../backend/api/src/mfa-recovery';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createApp } from '../backend/api/src/app';
import { denyIdentity } from '../backend/api/src/auth';
import { UserDatabase } from '../backend/api/src/database';
import { SessionAuthority, tokenHash } from '../backend/api/src/sessions';
import { EmailAuth } from '../backend/api/src/email-auth';
import { EmailOutbox } from '../backend/api/src/email-outbox';
import { MfaSecrets } from '../backend/api/src/mfa-secrets';
import { MfaStore } from '../backend/api/src/mfa-store';
import { MfaLogin } from '../backend/api/src/mfa-login';
import { GoogleAuth } from '../backend/api/src/google-auth';
import { hashPassword } from '../backend/api/src/passwords';
import { totpAt } from '../backend/api/src/totp';
if (!process.env['P05_TEST_AUTH_URL']) throw new Error('Use npm run test:postgres');
const authPool = new Pool({ connectionString: process.env['P05_TEST_AUTH_URL'], max: 5 });
const runtime = new Pool({ connectionString: process.env['P04_TEST_DATABASE_URL'] });
const admin = new Pool({ connectionString: process.env['P04_TEST_ADMIN_URL'] });
const store = new MfaStore(authPool, new MfaSecrets(randomBytes(32)));
const database = new UserDatabase(runtime);
const sessions = new SessionAuthority(database, denyIdentity);
const password = 'Synthetic MFA primary password';
const origin = 'https://finance.example.test';
let identity = { subject: 'synthetic', email: 'synthetic@example.test' };
let encoded: string;
let app: Awaited<ReturnType<typeof createApp>>;
const post = (path: string, payload: object) =>
  app.inject({ method: 'POST', url: '/v1/auth/' + path, payload });
async function account() {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await admin.query('INSERT INTO app.users(id) VALUES($1)', [id]);
  await admin.query(
    'INSERT INTO app.credentials(user_id,email,password_hash,verified) VALUES($1,$2,$3,true)',
    [id, email, encoded],
  );
  const enrollment = await store.beginEnrollment(id);
  const seconds = Number(
    (await admin.query('SELECT floor(extract(epoch FROM clock_timestamp())) AS seconds')).rows[0]
      .seconds,
  );
  expect(await store.confirmEnrollment(id, totpAt(enrollment.secret, seconds - 30))).toBe(true);
  return { id, email, secret: enrollment.secret, code: totpAt(enrollment.secret, seconds) };
}
async function challenge(email: string, pass = password) {
  const response = await post('login', { email, password: pass });
  expect(response.statusCode).toBe(200);
  const value = response.json() as { mfaRequired: boolean; challenge: string; token?: string };
  expect(value.mfaRequired).toBe(true);
  expect(value.token).toBeUndefined();
  return value.challenge;
}
beforeAll(async () => {
  encoded = await hashPassword(password);
  app = await createApp({
    database,
    sessions,
    identity: sessions,
    emailAuth: new EmailAuth(authPool, new EmailOutbox(randomBytes(32))),
    mfaLogin: new MfaLogin(authPool, store),
    googleAuth: new GoogleAuth(
      authPool,
      sessions,
      {
        authorization: ({ state }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
        exchange: async () => identity,
      },
      randomBytes(32),
      origin,
    ),
  });
});
afterAll(async () => {
  await app?.close();
  await Promise.all([authPool.end(), runtime.end(), admin.end()]);
});

it('requires the factor and issues only one session for five concurrent completions', async () => {
  const user = await account();
  const pending = await challenge(user.email);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${pending}` },
      })
    ).statusCode,
  ).toBe(401);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => post('mfa/complete', { challenge: pending, code: user.code })),
  );
  expect(results.filter((response) => response.statusCode === 200)).toHaveLength(1);
  expect(results.filter((response) => response.statusCode === 401)).toHaveLength(4);
  const session = results.find((response) => response.statusCode === 200)!.json() as {
    token: string;
  };
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${session.token}` },
      })
    ).statusCode,
  ).toBe(200);
  const again = await challenge(user.email);
  expect((await post('mfa/complete', { challenge: again, code: user.code })).statusCode).toBe(401);
});

it('enforces MFA after Google identity verification too', async () => {
  const user = await account();
  identity = { subject: randomUUID(), email: user.email };
  await admin.query('INSERT INTO app.google_identities(subject,user_id) VALUES($1,$2)', [
    identity.subject,
    user.id,
  ]);
  const start = await app.inject({
    method: 'POST',
    url: '/v1/auth/google/start',
    headers: { origin },
    payload: { mode: 'login' },
  });
  const state = new URL(start.json().authorizationUrl as string).searchParams.get('state');
  const complete = await app.inject({
    method: 'POST',
    url: '/v1/auth/google/complete',
    headers: { origin, cookie: String(start.headers['set-cookie']) },
    payload: { state, code: 'synthetic' },
  });
  expect(complete.statusCode).toBe(200);
  const pending = complete.json() as { mfaRequired: boolean; challenge: string; token?: string };
  expect(pending.mfaRequired).toBe(true);
  expect(pending.token).toBeUndefined();
  expect(
    (await post('mfa/complete', { challenge: pending.challenge, code: user.code })).statusCode,
  ).toBe(200);
});

it('password recovery invalidates old challenges without disabling the factor', async () => {
  const user = await account();
  const pending = await challenge(user.email);
  const reset = randomBytes(32).toString('base64url');
  await admin.query(
    "INSERT INTO app.email_challenges(token_hash,user_id,kind) VALUES($1,$2,'reset')",
    [tokenHash(reset), user.id],
  );
  const changed = 'Synthetic changed MFA password';
  expect((await post('reset-password', { token: reset, password: changed })).statusCode).toBe(200);
  expect((await post('mfa/complete', { challenge: pending, code: user.code })).statusCode).toBe(
    401,
  );
  const renewed = await challenge(user.email, changed);
  expect((await post('mfa/complete', { challenge: renewed, code: user.code })).statusCode).toBe(
    200,
  );
  expect(
    (await admin.query('SELECT active FROM app.mfa_factors WHERE user_id=$1', [user.id])).rows[0]
      .active,
  ).toBe(true);
});

it('limits attempts, rejects expired challenges and cannot consume another user factor', async () => {
  const a = await account();
  const b = await account();
  const pending = await challenge(a.email);
  for (let i = 0; i < 5; i++)
    expect((await post('mfa/complete', { challenge: pending, code: 'invalid' })).statusCode).toBe(
      401,
    );
  expect((await post('mfa/complete', { challenge: pending, code: a.code })).statusCode).toBe(401);
  const attempts = (
    await admin.query('SELECT attempts FROM app.mfa_challenges WHERE token_hash=$1', [
      tokenHash(pending),
    ])
  ).rows[0];
  expect(attempts.attempts).toBe(5);
  const other = await challenge(b.email);
  await admin.query(
    "UPDATE app.mfa_challenges SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [tokenHash(other)],
  );
  expect((await post('mfa/complete', { challenge: other, code: b.code })).statusCode).toBe(401);
  const fresh = await challenge(b.email);
  if (a.code !== b.code)
    expect((await post('mfa/complete', { challenge: fresh, code: a.code })).statusCode).toBe(401);
  expect((await post('mfa/complete', { challenge: fresh, code: b.code })).statusCode).toBe(200);
  await expect(runtime.query('SELECT * FROM app.mfa_challenges')).rejects.toMatchObject({
    code: '42501',
  });
});

it('rejects the legacy issuance path and rolls back factor consumption when session issuance fails', async () => {
  const user = await account();
  const legacy = new SessionAuthority(database, { verify: async () => user.id });
  await expect(legacy.issue('Bearer synthetic-primary-proof')).rejects.toThrow();
  const pending = await challenge(user.email);
  for (let i = 0; i < 10; i++)
    await admin.query('INSERT INTO app.sessions(user_id,id,token_hash) VALUES($1,$2,$3)', [
      user.id,
      randomUUID(),
      tokenHash(randomUUID()),
    ]);
  expect((await post('mfa/complete', { challenge: pending, code: user.code })).statusCode).toBe(
    429,
  );
  const row = (
    await admin.query('SELECT attempts,consumed_at FROM app.mfa_challenges WHERE token_hash=$1', [
      tokenHash(pending),
    ])
  ).rows[0];
  expect(row.attempts).toBe(0);
  expect(row.consumed_at).toBeNull();
  await admin.query('UPDATE app.sessions SET revoked_at=now() WHERE user_id=$1', [user.id]);
  expect((await post('mfa/complete', { challenge: pending, code: user.code })).statusCode).toBe(
    200,
  );
});

it('recovery requires a primary challenge, consumes once and keeps MFA enabled', async () => {
  const a = await account();
  const b = await account();
  const client = await authPool.connect();
  let codes: string[];
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id',$1,true)", [a.id]);
    codes = await replaceRecoveryCodes(client, a.id);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  const recover = (pending: string, code: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/recover',
      remoteAddress: '192.0.2.41',
      payload: { challenge: pending, code },
    });
  expect((await recover('invalid', codes[0]!)).statusCode).toBe(401);
  const other = await challenge(b.email);
  expect((await recover(other, codes[0]!)).statusCode).toBe(401);
  const pending = await challenge(a.email);
  const results = await Promise.all(Array.from({ length: 5 }, () => recover(pending, codes[0]!)));
  expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
  expect(results.filter((r) => r.statusCode === 401)).toHaveLength(4);
  const again = await challenge(a.email);
  expect((await recover(again, codes[0]!)).statusCode).toBe(401);
  expect((await recover(again, codes[1]!)).statusCode).toBe(200);
  expect(
    (await admin.query('SELECT active FROM app.mfa_factors WHERE user_id=$1', [a.id])).rows[0]
      .active,
  ).toBe(true);
  const limited = await challenge(a.email);
  for (let i = 0; i < 5; i++) expect((await recover(limited, 'invalid')).statusCode).toBe(401);
  expect((await recover(limited, codes[2]!)).statusCode).toBe(401);
  const retry = await challenge(a.email);
  await admin.query('UPDATE app.sessions SET revoked_at=now() WHERE user_id=$1', [a.id]);
  for (let i = 0; i < 10; i++)
    await admin.query('INSERT INTO app.sessions(user_id,id,token_hash) VALUES($1,$2,$3)', [
      a.id,
      randomUUID(),
      tokenHash(randomUUID()),
    ]);
  expect((await recover(retry, codes[2]!)).statusCode).toBe(429);
  await admin.query('UPDATE app.sessions SET revoked_at=now() WHERE user_id=$1', [a.id]);
  expect((await recover(retry, codes[2]!)).statusCode).toBe(200);
});
