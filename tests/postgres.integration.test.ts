import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
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
    const migrationFiles = (await readdir('backend/api/migrations')).filter((name) =>
      name.endsWith('.sql'),
    );
    expect((await admin.query('SELECT * FROM public.schema_migrations')).rowCount).toBe(
      migrationFiles.length,
    );
    const tables = await admin.query(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r' AND c.relname NOT IN ('ledger_timezones','category_templates')",
    );
    expect(tables.rows.length).toBeGreaterThan(0);
    for (const table of tables.rows)
      expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    await expect(
      pool.query("INSERT INTO app.ledger_timezones(name) VALUES('Fake/Zone')"),
    ).rejects.toMatchObject({ code: '42501' });
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
      (await admin.query('SELECT theme FROM app.user_preferences WHERE user_id=$1', [a])).rows[0],
    ).toEqual({ theme: 'light' });
  });
  it('rejects foreign writes, reassignment and missing parent references', async () => {
    await expect(
      database.asUser(a, async (client) => {
        await client.query('INSERT INTO app.user_preferences(user_id) VALUES ($1)', [b]);
      }),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      database.asUser(a, async (client) => {
        await client.query('UPDATE app.user_preferences SET user_id=$1 WHERE user_id=$2', [b, a]);
      }),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      admin.query('INSERT INTO app.user_preferences(user_id) VALUES ($1)', [randomUUID()]),
    ).rejects.toMatchObject({ code: '23503' });
  });
  it('isolates concurrent users even through the same pooled connection', async () => {
    const rounds = 20;
    await Promise.all(
      Array.from({ length: rounds }, (_, index) =>
        database.asUser(index % 2 === 0 ? a : b, async (client) => {
          const expected = index % 2 === 0 ? a : b;
          const rows = (await client.query('SELECT id FROM app.users')).rows;
          expect(rows).toEqual([{ id: expected }]);
        }),
      ),
    );
    expect((await pool.query('SELECT * FROM app.users')).rows).toEqual([]);
  });
  it('API derives identity from signed tokens, rejects tampering and unknown users', async () => {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const own = await fetch(`${base}/v1/me`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ id: a, theme: 'light', locale: 'es-PE' });
    const wrongAudience = await fetch(`${base}/v1/me`, {
      headers: { authorization: `Bearer ${await sign(a, undefined, 'other-api')}` },
    });
    expect(wrongAudience.status).toBe(401);
    const unknown = await fetch(`${base}/v1/me`, {
      headers: { authorization: `Bearer ${await sign(randomUUID())}` },
    });
    expect(unknown.status).toBe(404);
    const tampered = `${tokenB.slice(0, -1)}${tokenB.endsWith('a') ? 'b' : 'a'}`;
    const invalid = await fetch(`${base}/v1/me`, {
      headers: { authorization: `Bearer ${tampered}` },
    });
    expect(invalid.status).toBe(401);
  });
  it('persists own preferences and rejects unrecognized fields without leaking values in errors or logs', async () => {
    const base = await app.getUrl();
    const changed = await fetch(`${base}/v1/me/preferences`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'dark' }),
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ theme: 'dark', locale: 'es-PE' });
    const invalid = await fetch(`${base}/v1/me/preferences`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'light', unexpected_secret: 'must-not-leak' }),
    });
    expect(invalid.status).toBe(400);
    expect(JSON.stringify(await invalid.json())).not.toContain('must-not-leak');
    expect(JSON.stringify(logs)).not.toContain('must-not-leak');
  });
});
