import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createApp } from '../backend/api/src/app';
import { denyIdentity } from '../backend/api/src/auth';
import { UserDatabase } from '../backend/api/src/database';
import { EmailAuth } from '../backend/api/src/email-auth';
import { EmailOutbox, type AuthMail } from '../backend/api/src/email-outbox';
import { SessionAuthority } from '../backend/api/src/sessions';
if (!process.env['P05_TEST_AUTH_URL']) throw new Error('Use npm run test:postgres');
const authPool = new Pool({ connectionString: process.env['P05_TEST_AUTH_URL'], max: 3 });
const runtime = new Pool({ connectionString: process.env['P04_TEST_DATABASE_URL'] });
const admin = new Pool({ connectionString: process.env['P04_TEST_ADMIN_URL'] });
const outbox = new EmailOutbox(randomBytes(32));
const auth = new EmailAuth(authPool, outbox);
const database = new UserDatabase(runtime);
const sessions = new SessionAuthority(database, denyIdentity);
let app: Awaited<ReturnType<typeof createApp>>;
const logs: unknown[] = [];
const password = 'Synthetic test passphrase - initial';
const nextPassword = 'Synthetic test passphrase - changed';
const email = () => randomUUID() + '@example.test';
const headers = (token: string) => ({ authorization: 'Bearer ' + token });
const post = (url: string, payload: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/v1/auth/' + url, payload });
async function mailFor(recipient: string, kind: 'verify' | 'reset') {
  const sent: AuthMail[] = [];
  while (
    await outbox.deliverOne(authPool, async (mail) => {
      sent.push(mail);
    })
  ) {
    /* synthetic delivery only */
  }
  return sent.reverse().find((mail) => mail.recipient === recipient && mail.kind === kind)!;
}
async function register(recipient: string) {
  expect((await post('register', { email: recipient })).statusCode).toBe(202);
  const mail = await mailFor(recipient, 'verify');
  expect(mail).toBeDefined();
  expect((await post('verify-email', { token: mail.token, password })).statusCode).toBe(200);
}
async function login(recipient: string, pwd = password) {
  const result = await post('login', { email: recipient, password: pwd });
  expect(result.statusCode).toBe(200);
  return result.json() as { token: string; sessionId: string };
}
beforeAll(async () => {
  await auth.assertRole();
  app = await createApp({
    database,
    sessions,
    identity: sessions,
    emailAuth: auth,
    log: (event) => logs.push(event),
  });
});
beforeEach(async () => {
  await admin.query('DELETE FROM app.auth_rate_limits');
});
afterAll(async () => {
  await app?.close();
  await Promise.all([runtime.end(), authPool.end(), admin.end()]);
});

it('registers without giving an attacker a chosen password before mailbox verification', async () => {
  const recipient = email();
  const response = await post('register', { email: recipient });
  expect(response.statusCode).toBe(202);
  expect(response.body).not.toContain(recipient);
  expect((await post('login', { email: recipient, password })).statusCode).toBe(401);
  const persisted = JSON.stringify(
    (await admin.query('SELECT envelope FROM app.auth_mail_outbox')).rows,
  );
  expect(persisted).not.toContain(recipient);
  const mail = await mailFor(recipient, 'verify');
  expect(persisted).not.toContain(mail.token);
  expect((await post('verify-email', { token: mail.token, password })).statusCode).toBe(200);
  expect((await post('verify-email', { token: mail.token, password })).statusCode).toBe(401);
  const signed = await login(recipient);
  expect(
    (await app.inject({ method: 'GET', url: '/v1/me', headers: headers(signed.token) })).statusCode,
  ).toBe(200);
  const hash = (
    await admin.query('SELECT password_hash FROM app.credentials WHERE email=$1', [recipient])
  ).rows[0]?.password_hash;
  expect(hash).toMatch(/^scrypt-v1\$/);
  expect(hash).not.toContain(password);
}, 15000);

it('returns the same accepted body for known and unknown recovery requests', async () => {
  const recipient = email();
  await register(recipient);
  const known = await post('forgot-password', { email: recipient });
  const unknown = await post('forgot-password', { email: email() });
  expect(known.statusCode).toBe(202);
  expect(known.body).toBe(unknown.body);
  expect((await post('register', { email: recipient })).body).toBe(known.body);
}, 15000);

it('consumes reset once and revokes all previous sessions without affecting another user', async () => {
  const a = email();
  const b = email();
  await register(a);
  await register(b);
  const first = await login(a);
  const second = await login(a);
  const other = await login(b);
  await post('forgot-password', { email: a });
  const mail = await mailFor(a, 'reset');
  expect(
    (await post('reset-password', { token: mail.token, password: nextPassword })).statusCode,
  ).toBe(200);
  expect((await post('reset-password', { token: mail.token, password })).statusCode).toBe(401);
  for (const token of [first.token, second.token])
    expect(
      (await app.inject({ method: 'GET', url: '/v1/me', headers: headers(token) })).statusCode,
    ).toBe(401);
  expect(
    (await app.inject({ method: 'GET', url: '/v1/me', headers: headers(other.token) })).statusCode,
  ).toBe(200);
  expect((await post('login', { email: a, password })).statusCode).toBe(401);
  await login(a, nextPassword);
}, 20000);

it('rejects expired or wrong-purpose tokens and concurrent double reset', async () => {
  const recipient = email();
  await register(recipient);
  await post('forgot-password', { email: recipient });
  const expired = await mailFor(recipient, 'reset');
  await admin.query(
    "UPDATE app.email_challenges SET expires_at=now()-interval '1 minute' WHERE user_id=(SELECT user_id FROM app.credentials WHERE email=$1)",
    [recipient],
  );
  expect(
    (await post('reset-password', { token: expired.token, password: nextPassword })).statusCode,
  ).toBe(401);
  await post('forgot-password', { email: recipient });
  const mail = await mailFor(recipient, 'reset');
  expect(
    (await post('verify-email', { token: mail.token, password: nextPassword })).statusCode,
  ).toBe(401);
  const responses = await Promise.all([
    post('reset-password', { token: mail.token, password: nextPassword }),
    post('reset-password', { token: mail.token, password: nextPassword }),
  ]);
  expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 401]);
}, 20000);

it('rate-limits across service instances and denies sensitive tables to the financial runtime', async () => {
  const second = new EmailAuth(authPool, outbox);
  const recipient = email();
  for (let i = 0; i < 10; i++)
    await (i % 2 ? auth : second).request({ email: recipient }, '192.0.2.44', 'reset');
  await expect(second.request({ email: recipient }, '192.0.2.45', 'reset')).rejects.toMatchObject({
    status: 429,
  });
  for (const table of ['credentials', 'email_challenges', 'auth_mail_outbox'])
    await expect(runtime.query('SELECT * FROM app.' + table)).rejects.toMatchObject({
      code: '42501',
    });
  await expect(authPool.query('SELECT * FROM app.user_preferences')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(new EmailAuth(admin, outbox).assertRole()).rejects.toThrow();
  expect(JSON.stringify(logs)).not.toContain(password);
  expect(JSON.stringify(logs)).not.toContain('@example.test');
});

it('does not leave an old-password session alive when login races with recovery', async () => {
  const recipient = email();
  await register(recipient);
  await post('forgot-password', { email: recipient });
  const mail = await mailFor(recipient, 'reset');
  const [signed, reset] = await Promise.all([
    post('login', { email: recipient, password }),
    post('reset-password', { token: mail.token, password: nextPassword }),
  ]);
  expect(reset.statusCode).toBe(200);
  expect([200, 401]).toContain(signed.statusCode);
  if (signed.statusCode === 200)
    expect(
      (await app.inject({ method: 'GET', url: '/v1/me', headers: headers(signed.json().token) }))
        .statusCode,
    ).toBe(401);
  await login(recipient, nextPassword);
}, 15000);

it('retains encrypted pending mail after transport failure and retries without exposing it through the API', async () => {
  const recipient = email();
  await post('register', { email: recipient });
  await expect(
    outbox.deliverOne(authPool, async () => {
      throw new Error('simulated transport failure');
    }),
  ).rejects.toThrow('Mail delivery failed');
  const mail = await mailFor(recipient, 'verify');
  expect(mail).toBeDefined();
  expect((await post('verify-email', { token: mail.token, password })).statusCode).toBe(200);
}, 15000);
