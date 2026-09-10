import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, it, expect } from 'vitest';
import { createApp } from '../backend/api/src/app';
import { UserDatabase } from '../backend/api/src/database';
import { SessionAuthority } from '../backend/api/src/sessions';
if (!process.env['P04_TEST_DATABASE_URL']) throw new Error('Use npm run test:postgres');
const pool = new Pool({ connectionString: process.env['P04_TEST_DATABASE_URL'] }),
  admin = new Pool({ connectionString: process.env['P04_TEST_ADMIN_URL'] }),
  db = new UserDatabase(pool);
let app: Awaited<ReturnType<typeof createApp>>;
let authority: SessionAuthority;
const a = randomUUID(),
  b = randomUUID();
let ha: { authorization: string }, hb: { authorization: string };
let sessionId: string;
const accountId = randomUUID(),
  categoryId = randomUUID();
const command = () => ({
  operationId: randomUUID(),
  movementId: randomUUID(),
  deviceId: randomUUID(),
  schemaVersion: 1,
  baseVersion: '0',
  payload: {
    kind: 'expense',
    accountId,
    categoryId,
    currency: 'PEN',
    amountMinor: '10',
    businessDate: '2026-01-01',
    timezone: 'America/Lima',
    note: 'Synthetic sync',
  },
});
beforeAll(async () => {
  await admin.query('INSERT INTO app.users(id) VALUES($1),($2)', [a, b]);
  authority = new SessionAuthority(db, {
    verify: async (token) => {
      if (token !== a && token !== b) throw new Error();
      return token;
    },
  });
  const sa = await authority.issue(a),
    sb = await authority.issue(b);
  sessionId = sa.sessionId;
  ha = { authorization: 'Bearer ' + sa.token };
  hb = { authorization: 'Bearer ' + sb.token };
  app = await createApp({ database: db, identity: authority, sessions: authority });
  for (const [path, type, id, payload] of [
    [
      '/v1/accounts',
      'account.create',
      accountId,
      { name: 'Synthetic cash', type: 'cash', currency: 'PEN', state: 'active', position: 0 },
    ],
    [
      '/v1/categories',
      'category.create',
      categoryId,
      { name: 'Synthetic expense', kind: 'expense', state: 'active', position: 0 },
    ],
  ] as const) {
    const result = await app.inject({
      method: 'POST',
      url: path,
      headers: ha,
      payload: {
        operationId: randomUUID(),
        deviceId: randomUUID(),
        schemaVersion: 1,
        baseVersion: '0',
        command: { type, id, payload },
      },
    });
    expect(result.statusCode).toBe(201);
  }
});
afterAll(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});
it('commits once under five concurrent retries and returns original receipt after response loss', async () => {
  const c = command();
  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      app.inject({ method: 'POST', url: '/v1/sync/commands', headers: ha, payload: c }),
    ),
  );
  expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
  expect(responses.filter((r) => r.json().status === 'applied')).toHaveLength(1);
  expect(responses.filter((r) => r.json().status === 'already_applied')).toHaveLength(4);
  expect(new Set(responses.map((r) => JSON.stringify(r.json().receipt))).size).toBe(1);
  const retry = await app.inject({
    method: 'POST',
    url: '/v1/sync/commands',
    headers: ha,
    payload: c,
  });
  expect(retry.json().status).toBe('already_applied');
  expect(
    (await db.asUser(a, (client) => client.query('SELECT 1 FROM app.sync_changes'))).rowCount,
  ).toBe(1);
  expect(
    (await app.inject({ method: 'GET', url: '/v1/accounts/' + accountId, headers: ha })).json()
      .balance,
  ).toEqual({ currency: 'PEN', amountMinor: '-10' });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/sync/commands',
        headers: ha,
        payload: { ...c, payload: { ...c.payload, note: 'different' } },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/sync/commands',
        headers: hb,
        payload: command(),
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/sync/commands',
        headers: ha,
        payload: { ...command(), user_id: b },
      })
    ).statusCode,
  ).toBe(422);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/sync/commands',
        headers: ha,
        payload: { ...command(), payload: { ...c.payload, amountMinor: '0' } },
      })
    ).statusCode,
  ).toBe(422);
});
it('pages durable per-user changes without duplicates and rejects foreign cursor and revoked session', async () => {
  for (let i = 0; i < 3; i++)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/sync/commands',
          headers: ha,
          payload: command(),
        })
      ).statusCode,
    ).toBe(200);
  const first = (
    await app.inject({ method: 'GET', url: '/v1/sync/changes?limit=2', headers: ha })
  ).json();
  expect(first.changes).toHaveLength(2);
  expect(first.hasMore).toBe(true);
  const path = '/v1/sync/changes?limit=2&cursor=' + first.nextCursor;
  const second = (await app.inject({ method: 'GET', url: path, headers: ha })).json();
  expect(second.changes).toHaveLength(2);
  expect(second.hasMore).toBe(false);
  expect((await app.inject({ method: 'GET', url: path, headers: ha })).json()).toEqual(second);
  expect(new Set([...first.changes, ...second.changes].map((c) => c.movement.id)).size).toBe(4);
  expect((await app.inject({ method: 'GET', url: path, headers: hb })).statusCode).toBe(403);
  expect(
    (await app.inject({ method: 'GET', url: '/v1/sync/changes', headers: hb })).json().changes,
  ).toEqual([]);
  await authority.revoke(ha.authorization, sessionId);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/sync/commands',
        headers: ha,
        payload: command(),
      })
    ).statusCode,
  ).toBe(401);
});
