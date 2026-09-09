import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../backend/api/src/app';
import { UserDatabase } from '../backend/api/src/database';
import { createSession, SessionAuthority } from '../backend/api/src/sessions';
import { LedgerStore } from '../backend/api/src/ledger/store';
import { LedgerService } from '../backend/api/src/ledger/service';
if (!process.env['P04_TEST_DATABASE_URL']) throw new Error('Use npm run test:postgres');
const pool = new Pool({ connectionString: process.env['P04_TEST_DATABASE_URL'] });
const admin = new Pool({ connectionString: process.env['P04_TEST_ADMIN_URL'] });
const db = new UserDatabase(pool),
  a = randomUUID(),
  b = randomUUID();
const logs: unknown[] = [];
let app: Awaited<ReturnType<typeof createApp>>;
let sessions: SessionAuthority;
let ha: { authorization: string }, hb: { authorization: string };
const envelope = (type: string, payload?: unknown, id = randomUUID(), version = '0') => ({
  operationId: randomUUID(),
  deviceId: randomUUID(),
  schemaVersion: 1,
  baseVersion: version,
  command: type === 'category.initialize' ? { type } : { type, id, payload },
});
beforeAll(async () => {
  await admin.query('INSERT INTO app.users(id) VALUES($1),($2)', [a, b]);
  // Synthetic issuer only; requests authenticate through the real revocable session verifier.
  sessions = new SessionAuthority(db, {
    verify: async (token) => {
      if (token !== a && token !== b) throw new Error('fixture identity');
      return token;
    },
  });
  const sa = await sessions.issue(a),
    sb = await sessions.issue(b);
  ha = { authorization: `Bearer ${sa.token}` };
  hb = { authorization: `Bearer ${sb.token}` };
  app = await createApp({ database: db, identity: sessions, sessions, log: (e) => logs.push(e) });
});
afterAll(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});
it('authenticates catalog API, paginates and preserves ledger-backed balances through archive', async () => {
  expect((await app.inject({ method: 'GET', url: '/v1/accounts' })).statusCode).toBe(401);
  const payload = {
    name: 'Caja sintética',
    type: 'cash',
    currency: 'PEN',
    state: 'active',
    position: 0,
  };
  const e = envelope('account.create', payload);
  const created = await app.inject({
    method: 'POST',
    url: '/v1/accounts',
    headers: ha,
    payload: e,
  });
  expect(created.statusCode).toBe(201);
  expect(created.json().status).toBe('applied');
  expect(
    (await app.inject({ method: 'POST', url: '/v1/accounts', headers: ha, payload: e })).json()
      .status,
  ).toBe('alreadyApplied');
  const id = e.command.id!;
  const get = async () =>
    (await app.inject({ method: 'GET', url: `/v1/accounts/${id}`, headers: ha })).json();
  expect((await get()).balance).toEqual({ currency: 'PEN', amountMinor: '0' });
  expect(await get()).not.toHaveProperty('ledgerId');
  expect(await get()).not.toHaveProperty('user_id');
  const asset = (
    await db.asUser(a, (c) =>
      c.query('SELECT ledger_account_id FROM app.product_accounts WHERE id=$1', [id]),
    )
  ).rows[0].ledger_account_id;
  const store = new LedgerStore(db),
    expense = randomUUID();
  await store.createTechnicalAccount(
    { userId: a },
    { id: expense, currency: 'PEN', nature: 'expense' },
  );
  const posting = await new LedgerService(store).execute(
    { userId: a },
    {
      operationId: randomUUID(),
      deviceId: randomUUID(),
      schemaVersion: 1,
      entityId: randomUUID(),
      baseVersion: '0',
      command: {
        type: 'post',
        payload: {
          kind: 'expense',
          currency: 'PEN',
          amountMinor: '1250',
          businessDate: '2026-01-01',
          timezone: 'America/Lima',
          debitAccountId: expense,
          creditAccountId: asset,
        },
      },
    },
  );
  expect(posting.status).toBe('applied');
  expect((await get()).balance.amountMinor).toBe('-1250');
  const edit = envelope(
    'account.update',
    { state: 'inactive', name: 'Archivo sintético' },
    id,
    '1',
  );
  expect(
    (await app.inject({ method: 'PATCH', url: `/v1/accounts/${id}`, headers: ha, payload: edit }))
      .statusCode,
  ).toBe(200);
  expect((await get()).balance.amountMinor).toBe('-1250');
  expect(
    (await app.inject({ method: 'GET', url: '/v1/accounts', headers: ha })).json().items,
  ).toHaveLength(0);
  expect(
    (await app.inject({ method: 'GET', url: '/v1/accounts?state=all', headers: ha })).json().items,
  ).toHaveLength(1);
  expect(
    (await app.inject({ method: 'GET', url: `/v1/accounts/${id}`, headers: hb })).statusCode,
  ).toBe(404);
  expect(
    (await app.inject({ method: 'PATCH', url: `/v1/accounts/${id}`, headers: hb, payload: edit }))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/v1/accounts/${id}`,
        headers: ha,
        payload: envelope('account.update', { name: 'stale' }, id, '1'),
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/v1/accounts/${id}`,
        headers: ha,
        payload: envelope('account.update', { state: 'active' }, id, '2'),
      })
    ).statusCode,
  ).toBe(200);
  for (const unit of ['USD', 'PEN'])
    await app.inject({
      method: 'POST',
      url: '/v1/accounts',
      headers: ha,
      payload: envelope('account.create', { ...payload, currency: unit }),
    });
  const first = (
    await app.inject({ method: 'GET', url: '/v1/accounts?limit=1', headers: ha })
  ).json();
  const second = (
    await app.inject({
      method: 'GET',
      url: `/v1/accounts?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
      headers: ha,
    })
  ).json();
  expect(second.items[0].id).not.toBe(first.items[0].id);
  expect(
    (await app.inject({ method: 'GET', url: '/v1/accounts?currency=USD', headers: ha }))
      .json()
      .items.every((x: { currency: string }) => x.currency === 'USD'),
  ).toBe(true);
  for (const query of ['user_id=' + b, 'limit=101', 'currency=EUR', 'cursor=bad'])
    expect(
      (await app.inject({ method: 'GET', url: '/v1/accounts?' + query, headers: ha })).statusCode,
    ).toBe(400);
  expect(
    (await db.asUser(a, (c) => c.query('SELECT 1 FROM app.ledger_transactions'))).rowCount,
  ).toBe(1);
});
it('category API initializes privately, edits and rejects immutable fields', async () => {
  const init = envelope('category.initialize');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/categories/initialize',
        headers: ha,
        payload: init,
      })
    ).statusCode,
  ).toBe(201);
  expect(
    (await app.inject({ method: 'GET', url: '/v1/categories', headers: hb })).json().items,
  ).toHaveLength(0);
  const e = envelope('category.create', {
    name: 'Personal DEMO',
    kind: 'income',
    state: 'active',
    position: 0,
  });
  expect(
    (await app.inject({ method: 'POST', url: '/v1/categories', headers: ha, payload: e }))
      .statusCode,
  ).toBe(201);
  const id = e.command.id!;
  const update = envelope('category.update', { state: 'archived' }, id, '1');
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${id}`,
        headers: hb,
        payload: update,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${id}`,
        headers: ha,
        payload: update,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ method: 'GET', url: `/v1/categories/${id}`, headers: ha })).json(),
  ).toMatchObject({ state: 'archived', origin: 'custom', version: '2' });
  expect(
    (await app.inject({ method: 'GET', url: `/v1/categories/${id}`, headers: hb })).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${id}`,
        headers: ha,
        payload: envelope('category.update', { kind: 'expense' }, id, '2'),
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${id}`,
        headers: ha,
        payload: envelope('category.update', { state: 'active' }, id, '2'),
      })
    ).statusCode,
  ).toBe(200);
  expect(JSON.stringify(logs)).not.toContain('Personal DEMO');
  expect(JSON.stringify(logs)).not.toContain(ha.authorization);
  const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json();
  expect(spec.paths['/v1/accounts'].post.requestBody).toBeDefined();
  await sessions.logout(hb.authorization, false);
  const expired = await db.asUser(b, (c) => createSession(c, b));
  await admin.query(
    "UPDATE app.sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1 AND id=$2",
    [b, expired.sessionId],
  );
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/v1/accounts',
        headers: { authorization: `Bearer ${expired.token}` },
      })
    ).statusCode,
  ).toBe(401);
  expect((await app.inject({ method: 'GET', url: '/v1/categories', headers: hb })).statusCode).toBe(
    401,
  );
});
