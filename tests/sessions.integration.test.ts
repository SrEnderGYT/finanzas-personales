import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createApp } from '../backend/api/src/app';
import { JwtIdentityVerifier } from '../backend/api/src/auth';
import { UserDatabase } from '../backend/api/src/database';
import { SessionAuthority, tokenHash } from '../backend/api/src/sessions';

if (!process.env['P04_TEST_DATABASE_URL'] || !process.env['P04_TEST_ADMIN_URL'])
  throw new Error('Use npm run test:postgres');
const pool = new Pool({ connectionString: process.env['P04_TEST_DATABASE_URL'], max: 2 });
const admin = new Pool({ connectionString: process.env['P04_TEST_ADMIN_URL'] });
const database = new UserDatabase(pool);
const a = randomUUID();
const b = randomUUID();
let sign: (id: string) => Promise<string>;
let sessions: SessionAuthority;
let app: Awaited<ReturnType<typeof createApp>>;
const logs: unknown[] = [];

beforeAll(async () => {
  await admin.query('INSERT INTO app.users(id) VALUES ($1),($2)', [a, b]);
  const key = await generateKeyPair('RS256');
  const publicKey = await exportJWK(key.publicKey);
  publicKey.kid = 'ephemeral-session-test';
  sign = (id) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: publicKey.kid })
      .setSubject(id)
      .setJti(randomUUID())
      .setIssuer('https://identity.example.test')
      .setAudience('finanzas-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key.privateKey);
  sessions = new SessionAuthority(
    database,
    new JwtIdentityVerifier({ keys: [publicKey] }, 'https://identity.example.test', 'finanzas-api'),
  );
  app = await createApp({
    database,
    identity: sessions,
    sessions,
    log: (event) => logs.push(event),
  });
});
afterAll(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
async function login(id: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/session',
    headers: headers(await sign(id)),
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { token: string; sessionId: string; expiresAt: string };
}

it('issues an opaque token once, stores only its hash and rejects direct JWT access', async () => {
  const proof = await sign(a);
  expect(
    (await app.inject({ method: 'GET', url: '/v1/me', headers: headers(proof) })).statusCode,
  ).toBe(401);
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/session',
    headers: headers(proof),
  });
  expect(response.statusCode).toBe(201);
  const issued = response.json();
  expect(issued.token).toMatch(/^fp_[A-Za-z0-9_-]{43}$/);
  expect(response.headers['cache-control']).toBe('no-store');
  const stored = await admin.query(
    'SELECT token_hash FROM app.sessions WHERE user_id=$1 AND id=$2',
    [a, issued.sessionId],
  );
  expect(stored.rows[0]?.token_hash).toBe(tokenHash(issued.token));
  expect(JSON.stringify(stored.rows)).not.toContain(issued.token);
  expect(
    (await app.inject({ method: 'POST', url: '/v1/auth/session', headers: headers(proof) }))
      .statusCode,
  ).toBe(401);
  expect(
    (await app.inject({ method: 'GET', url: '/v1/me', headers: headers(issued.token) })).json().id,
  ).toBe(a);
  expect(
    (await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: headers(issued.token) }))
      .statusCode,
  ).toBe(204);
  expect(
    (await app.inject({ method: 'GET', url: '/v1/me', headers: headers(issued.token) })).statusCode,
  ).toBe(401);
  expect(
    (await app.inject({ method: 'POST', url: '/v1/auth/session', headers: headers(proof) }))
      .statusCode,
  ).toBe(401);
  expect(JSON.stringify(logs)).not.toContain(issued.token);
});

it('rejects concurrent reuse of one login proof without creating a second session', async () => {
  const proof = await sign(a);
  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      app.inject({ method: 'POST', url: '/v1/auth/session', headers: headers(proof) }),
    ),
  );
  expect(responses.map((response) => response.statusCode).sort()).toEqual([
    201, 401, 401, 401, 401,
  ]);
  const issued = responses.find((response) => response.statusCode === 201)!.json();
  await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: headers(issued.token) });
});

it('lists only own sessions and prevents A from revoking B through API or direct SQL', async () => {
  const own = await login(a);
  const other = await login(b);
  const list = await app.inject({
    method: 'GET',
    url: '/v1/auth/sessions',
    headers: headers(own.token),
  });
  expect(list.statusCode).toBe(200);
  expect(list.json().some((session: { id: string }) => session.id === other.sessionId)).toBe(false);
  expect(list.body).not.toContain('token_hash');
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `/v1/auth/sessions/${other.sessionId}`,
        headers: headers(own.token),
      })
    ).statusCode,
  ).toBe(404);
  await database.asUser(a, async (client) => {
    expect((await client.query('SELECT id FROM app.sessions WHERE user_id=$1', [b])).rowCount).toBe(
      0,
    );
    expect(
      (await client.query('UPDATE app.sessions SET revoked_at=now() WHERE user_id=$1', [b]))
        .rowCount,
    ).toBe(0);
  });
  await expect(pool.query('SELECT token_hash FROM app.sessions')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(pool.query('SET ROLE finanzas_session_lookup')).rejects.toMatchObject({
    code: '42501',
  });
  expect(
    (await app.inject({ method: 'GET', url: '/v1/me', headers: headers(other.token) })).json().id,
  ).toBe(b);
  expect(
    (await app.inject({ method: 'DELETE', url: '/v1/auth/sessions', headers: headers(own.token) }))
      .statusCode,
  ).toBe(204);
  await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: headers(other.token) });
});

it('revokes all own sessions across independent application instances', async () => {
  const first = await login(a);
  const second = await login(a);
  const other = await login(b);
  const instance = await createApp({
    database,
    identity: new SessionAuthority(database, {
      verify: async () => {
        throw new Error();
      },
    }),
  });
  try {
    expect(
      (await instance.inject({ method: 'GET', url: '/v1/me', headers: headers(second.token) }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/v1/auth/sessions',
          headers: headers(first.token),
        })
      ).statusCode,
    ).toBe(204);
    for (const token of [first.token, second.token])
      expect(
        (await instance.inject({ method: 'GET', url: '/v1/me', headers: headers(token) }))
          .statusCode,
      ).toBe(401);
    expect(
      (await instance.inject({ method: 'GET', url: '/v1/me', headers: headers(other.token) }))
        .statusCode,
    ).toBe(200);
  } finally {
    await instance.close();
  }
  await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: headers(other.token) });
});

it('enforces idle and absolute expiration in PostgreSQL, and rejects malformed tokens', async () => {
  const idle = await login(a);
  const expired = await login(b);
  await admin.query(
    "UPDATE app.sessions SET last_seen_at=now()-interval '31 minutes' WHERE id=$1",
    [idle.sessionId],
  );
  await admin.query(
    "UPDATE app.sessions SET created_at=now()-interval '13 hours', expires_at=now()-interval '1 hour' WHERE id=$1",
    [expired.sessionId],
  );
  for (const token of [idle.token, expired.token, 'fp_invalid', 'fp_' + 'x'.repeat(43)]) {
    expect(
      (await app.inject({ method: 'GET', url: '/v1/me', headers: headers(token) })).statusCode,
    ).toBe(401);
  }
  const valid = await login(a);
  await expect(
    database.asUser(a, (client) =>
      client.query("UPDATE app.sessions SET expires_at=now()+interval '1 year' WHERE id=$1", [
        valid.sessionId,
      ]),
    ),
  ).rejects.toMatchObject({ code: '42501' });
  await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: headers(valid.token) });
});
