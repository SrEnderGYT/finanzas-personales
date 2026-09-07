import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from '../backend/api/src/app';
import { JwtIdentityVerifier } from '../backend/api/src/auth';
import { UserDatabase } from '../backend/api/src/database';

if (!process.env['P04_TEST_DATABASE_URL'] || !process.env['P04_TEST_ADMIN_URL']) {
  throw new Error('Use npm run test:postgres to provision an isolated synthetic database');
}
const pool = new Pool({ connectionString: process.env['P04_TEST_DATABASE_URL'], max: 1 });
const admin = new Pool({ connectionString: process.env['P04_TEST_ADMIN_URL'] });
const database = new UserDatabase(pool);
const a = randomUUID();
const b = randomUUID();
const logs: unknown[] = [];
let app: Awaited<ReturnType<typeof createApp>>;
let tokenA: string;
let tokenB: string;
let sign: (id: string, issuer?: string, audience?: string, expiry?: string) => Promise<string>;

beforeAll(async () => {
  await database.assertRuntimeRole();
  await admin.query('INSERT INTO app.users(id) VALUES ($1), ($2)', [a, b]);
  await admin.query(
    "INSERT INTO app.user_preferences(user_id,theme) VALUES ($1,'light'), ($2,'dark')",
    [a, b],
  );
  const pair = await generateKeyPair('RS256');
  const publicKey = await exportJWK(pair.publicKey);
  publicKey.kid = 'ephemeral-test';
  sign = (id, issuer = 'https://identity.example.test', audience = 'finanzas-api', expiry = '5m') =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'ephemeral-test' })
      .setSubject(id)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiry)
      .sign(pair.privateKey);
  tokenA = await sign(a);
  tokenB = await sign(b);
  app = await createApp({
    database,
    identity: new JwtIdentityVerifier(
      { keys: [publicKey] },
      'https://identity.example.test',
      'finanzas-api',
    ),
    log: (event) => logs.push(event),
  });
}, 15000);
afterAll(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});

describe('PostgreSQL 17 — user isolation with the actual restricted runtime role', () => {
  it('applies migrations once, forces RLS and rejects a privileged runtime', async () => {
    expect((await admin.query('SELECT * FROM public.schema_migrations')).rowCount).toBe(2);
    const tables = await admin.query(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r'",
    );
    expect(tables.rows).toHaveLength(4);
    for (const table of tables.rows)
      expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    await expect(new UserDatabase(admin).assertRuntimeRole()).rejects.toThrow('Unsafe');
    await expect(pool.query('TRUNCATE app.users CASCADE')).rejects.toMatchObject({ code: '42501' });
    await expect(
      pool.query('ALTER TABLE app.users DISABLE ROW LEVEL SECURITY'),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('fails closed without identity and clears context after commit and rollback', async () => {
    expect((await pool.query('SELECT * FROM app.users')).rows).toEqual([]);
    await database.asUser(a, async (client) => {
      expect((await client.query('SELECT id FROM app.users')).rows).toEqual([{ id: a }]);
      expect((await client.query('SELECT * FROM app.users WHERE id=$1', [b])).rows).toEqual([]);
      expect(
        (await client.query('SELECT * FROM app.user_preferences WHERE user_id=$1', [b])).rows,
      ).toEqual([]);
      expect(
        (await client.query("UPDATE app.user_preferences SET theme='light' WHERE user_id=$1", [b]))
          .rowCount,
      ).toBe(0);
    });
    expect((await pool.query('SELECT * FROM app.users')).rows).toEqual([]);
    await expect(
      database.asUser(a, async (client) => {
        await client.query("UPDATE app.user_preferences SET theme='dark' WHERE user_id=$1", [a]);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await pool.query('SELECT * FROM app.users')).rows).toEqual([]);
    expect(
      (await admin.query('SELECT theme FROM app.user_preferences WHERE user_id=$1', [a])).rows[0]
        ?.theme,
    ).toBe('light');
  });
  it('rejects foreign writes, reassignment and missing parent references', async () => {
    await expect(
      database.asUser(a, (client) =>
        client.query("INSERT INTO app.user_preferences(user_id,theme) VALUES ($1,'light')", [b]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      database.asUser(a, (client) =>
        client.query('UPDATE app.user_preferences SET user_id=$1 WHERE user_id=$2', [b, a]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const unknown = randomUUID();
    await expect(
      database.asUser(unknown, (client) =>
        client.query("INSERT INTO app.user_preferences(user_id,theme) VALUES ($1,'light')", [
          unknown,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      database.asUser(a, (client) => client.query('DELETE FROM app.users WHERE id=$1', [b])),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('isolates concurrent users even through the same pooled connection', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => {
        const id = index % 2 ? a : b;
        return database.asUser(id, async (client) => {
          const result = await client.query('SELECT id FROM app.users');
          expect(result.rows).toEqual([{ id }]);
        });
      }),
    );
    expect(results).toHaveLength(20);
    expect((await pool.query('SELECT * FROM app.user_preferences')).rows).toEqual([]);
  });
  it('API derives identity from signed tokens, rejects tampering and unknown users', async () => {
    for (const token of [
      undefined,
      'invalid',
      await sign(a, 'https://wrong.example.test'),
      await sign(a, undefined, 'wrong'),
      await sign(a, undefined, undefined, '-1m'),
      tokenA.slice(0, -12) + 'invalidtoken',
    ]) {
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/v1/me',
            headers: token ? { authorization: `Bearer ${token}` } : {},
          })
        ).statusCode,
      ).toBe(401);
    }
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/me',
          headers: { authorization: `Bearer ${await sign(randomUUID())}` },
        })
      ).statusCode,
    ).toBe(404);
    const response = await app.inject({
      method: 'GET',
      url: `/v1/me?user_id=${b}`,
      headers: { authorization: `Bearer ${tokenA}`, 'x-user-id': b },
    });
    expect(response.json()).toEqual({ id: a, theme: 'light', locale: 'es-PE' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/users/${b}`,
          headers: { authorization: `Bearer ${tokenA}` },
        })
      ).statusCode,
    ).toBe(404);
  });
  it('persists own preferences and rejects unrecognized fields without leaking values in errors or logs', async () => {
    const headers = { authorization: `Bearer ${tokenA}` };
    for (const payload of [
      { theme: 'light', user_id: b },
      { theme: '<script>private-marker</script>' },
      { theme: ['light'] },
      {},
    ]) {
      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/me/preferences',
        headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('private-marker');
    }
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/v1/me/preferences',
          headers,
          payload: { theme: 'system' },
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers })).json().theme).toBe(
      'system',
    );
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/me',
          headers: { authorization: `Bearer ${tokenB}` },
        })
      ).json().theme,
    ).toBe('dark');
    const encoded = JSON.stringify(logs);
    for (const sensitive of [a, b, tokenA, 'private-marker', 'authorization', 'theme'])
      expect(encoded).not.toContain(sensitive);
    expect(logs.length).toBeGreaterThan(0);
  });
});
