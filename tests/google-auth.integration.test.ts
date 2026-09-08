import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createApp } from '../backend/api/src/app';
import { denyIdentity } from '../backend/api/src/auth';
import { UserDatabase } from '../backend/api/src/database';
import { GoogleAuth } from '../backend/api/src/google-auth';
import { type GoogleProvider } from '../backend/api/src/google-provider';
import { createSession, SessionAuthority } from '../backend/api/src/sessions';
if (!process.env['P05_TEST_AUTH_URL']) throw new Error('Use npm run test:postgres');
const pool = new Pool({ connectionString: process.env['P05_TEST_AUTH_URL'] });
const runtime = new Pool({ connectionString: process.env['P04_TEST_DATABASE_URL'] });
const admin = new Pool({ connectionString: process.env['P04_TEST_ADMIN_URL'] });
const database = new UserDatabase(runtime);
const sessions = new SessionAuthority(database, denyIdentity);
const origin = 'https://app.example.test';
const flows = new Map<string, { nonce: string; challenge: string }>();
let identity = { subject: '', email: '' };
let exchanges = 0;
const provider: GoogleProvider = {
  authorization(parameters) {
    flows.set(parameters.state, parameters);
    return (
      'https://accounts.google.com/o/oauth2/v2/auth?' +
      new URLSearchParams({
        state: parameters.state,
        nonce: parameters.nonce,
        challenge: parameters.challenge,
      })
    );
  },
  async exchange(code, verifier, nonce) {
    exchanges++;
    const flow = flows.get(code);
    if (
      !flow ||
      flow.nonce !== nonce ||
      createHash('sha256').update(verifier).digest('base64url') !== flow.challenge
    )
      throw new Error('Invalid simulated code or PKCE');
    flows.delete(code);
    return identity;
  },
};
let app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  app = await createApp({
    database,
    identity: sessions,
    sessions,
    googleAuth: new GoogleAuth(pool, sessions, provider, randomBytes(32), origin),
  });
});
beforeEach(async () => {
  identity = { subject: randomUUID(), email: randomUUID() + '@example.test' };
  await admin.query('DELETE FROM app.auth_rate_limits WHERE key_hash=$1', [
    createHash('sha256').update('google-ip:127.0.0.1').digest('hex'),
  ]);
});
afterAll(async () => {
  await app?.close();
  await Promise.all([pool.end(), runtime.end(), admin.end()]);
});
async function start(mode = 'login', token?: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/google/start',
    headers: { origin, ...(token ? { authorization: 'Bearer ' + token } : {}) },
    payload: { mode },
  });
  expect(response.statusCode).toBe(200);
  const cookie = String(response.headers['set-cookie']);
  expect(cookie).toContain('HttpOnly; Secure; SameSite=Lax');
  expect(response.body).not.toContain('binding');
  return {
    state: new URL(response.json().authorizationUrl).searchParams.get('state')!,
    cookie: cookie.split(';')[0]!,
  };
}
function complete(flow: { state: string; cookie: string }, overrides: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/google/complete',
    headers: { origin, cookie: flow.cookie },
    payload: { state: flow.state, code: flow.state, ...overrides },
  });
}
async function localUser() {
  const id = randomUUID();
  await admin.query('INSERT INTO app.users(id) VALUES($1)', [id]);
  return { id, session: await database.asUser(id, (client) => createSession(client, id)) };
}
it('binds flow to browser and origin, exchanges PKCE and resolves a stable subject to the same user', async () => {
  const flow = await start();
  const count = exchanges;
  const missing = await app.inject({
    method: 'POST',
    url: '/v1/auth/google/complete',
    headers: { origin },
    payload: { state: flow.state, code: flow.state },
  });
  expect(missing.statusCode).toBe(401);
  expect(exchanges).toBe(count);
  const wrongOrigin = await app.inject({
    method: 'POST',
    url: '/v1/auth/google/start',
    headers: { origin: 'https://attacker.example.test' },
    payload: { mode: 'login' },
  });
  expect(wrongOrigin.statusCode).toBe(403);
  const response = await complete(flow);
  expect(response.statusCode).toBe(200);
  const first = (
    await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer ' + response.json().token },
    })
  ).json().id;
  expect((await complete(flow)).statusCode).toBe(401);
  identity.email = 'changed@example.test';
  const second = await complete(await start());
  expect(second.statusCode).toBe(200);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: 'Bearer ' + second.json().token },
      })
    ).json().id,
  ).toBe(first);
});
it('rejects swapped state, expired flows and concurrent replay before creating duplicate sessions', async () => {
  const first = await start();
  const second = await start();
  expect((await complete({ ...first, cookie: second.cookie })).statusCode).toBe(401);
  const results = await Promise.all([complete(first), complete(first)]);
  expect(results.map((result) => result.statusCode).sort()).toEqual([200, 401]);
  await admin.query(
    "UPDATE app.oidc_flows SET expires_at=now()-interval '1 minute' WHERE state_hash=$1",
    [createHash('sha256').update(second.state).digest('hex')],
  );
  expect((await complete(second)).statusCode).toBe(401);
});
it('refuses automatic email linking and only links with a live initiating session', async () => {
  const user = await localUser();
  await admin.query('INSERT INTO app.credentials(user_id,email) VALUES($1,$2)', [
    user.id,
    identity.email,
  ]);
  expect((await complete(await start())).statusCode).toBe(409);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/auth/google/start',
        headers: { origin },
        payload: { mode: 'link' },
      })
    ).statusCode,
  ).toBe(401);
  const linked = await complete(await start('link', user.session.token));
  expect(linked.statusCode).toBe(200);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: 'Bearer ' + linked.json().token },
      })
    ).json().id,
  ).toBe(user.id);
  const other = await localUser();
  expect((await complete(await start('link', other.session.token))).statusCode).toBe(409);
});
it('rejects linking after logout and denies financial runtime access to OIDC secrets', async () => {
  const user = await localUser();
  const flow = await start('link', user.session.token);
  await sessions.logout('Bearer ' + user.session.token);
  expect((await complete(flow)).statusCode).toBe(401);
  for (const table of ['oidc_flows', 'google_identities'])
    await expect(runtime.query('SELECT * FROM app.' + table)).rejects.toMatchObject({
      code: '42501',
    });
  const stored = JSON.stringify((await admin.query('SELECT envelope FROM app.oidc_flows')).rows);
  expect(stored).not.toContain('verifier');
  expect(stored).not.toContain('nonce');
});
