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
let secondClient: { authorization: string };
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
  secondClient = { authorization: 'Bearer ' + (await authority.issue(a)).token };
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
async function original() {
  const c = command();
  expect(
    (await app.inject({ method: 'POST', url: '/v1/sync/commands', headers: ha, payload: c }))
      .statusCode,
  ).toBe(200);
  return c;
}
function correction(rootId: string, amountMinor = '20', expectedVersion = '1') {
  const replacement = command();
  replacement.payload.amountMinor = amountMinor;
  return {
    operationId: randomUUID(),
    deviceId: replacement.deviceId,
    schemaVersion: 1,
    rootId,
    expectedVersion,
    reason: 'Synthetic explicit correction',
    action: 'replace',
    replacement,
    reversalId: randomUUID(),
    reversalOperationId: randomUUID(),
    businessDate: '2026-01-02',
    timezone: 'America/Lima',
  };
}
const postCorrection = (payload: Record<string, unknown>, headers = ha) =>
  app.inject({ method: 'POST', url: '/v1/sync/corrections', headers, payload });
it('two independent sessions produce one atomic correction and a durable 409 with both versions', async () => {
  const c = await original();
  const one = correction(c.movementId, '20'),
    two = correction(c.movementId, '30');
  const results = await Promise.all([postCorrection(one), postCorrection(two, secondClient)]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const winner = results.find((r) => r.statusCode === 200)!.json();
  const conflict = results.find((r) => r.statusCode === 409)!.json();
  expect(conflict.status).toBe('conflict');
  expect(conflict.server).toEqual(winner.server);
  expect(conflict.server.version).toBe('2');
  expect(conflict.differentFields).toContain('amountMinor');
  expect(conflict.local.replacement.payload.amountMinor).not.toBe(
    conflict.server.payload.amountMinor,
  );
  const retry = await postCorrection(conflict.local);
  expect(retry.statusCode).toBe(409);
  expect(retry.json()).toEqual(conflict);
  const history = await db.asUser(a, (client) =>
    client.query(
      'SELECT amount_minor::text,kind FROM app.ledger_transactions WHERE user_id=$1 AND (id=$2 OR id=$3 OR original_id=$2)',
      [a, c.movementId, winner.server.movementId],
    ),
  );
  expect(history.rows).toHaveLength(3);
  expect(history.rows.filter((r) => r.kind === 'reversal')).toHaveLength(1);
  expect(
    history.rows.reduce(
      (sum, r) => sum + BigInt(r.amount_minor) * (r.kind === 'reversal' ? -1n : 1n),
      0n,
    ),
  ).toBe(BigInt(winner.server.payload.amountMinor));
  const keep = {
    operationId: randomUUID(),
    deviceId: randomUUID(),
    schemaVersion: 1,
    rootId: c.movementId,
    expectedVersion: '2',
    reason: 'Synthetic reviewed server version',
    action: 'keep_server',
    resolves: conflict.operationId,
  };
  const resolutions = await Promise.all(
    Array.from({ length: 5 }, () => postCorrection(keep, secondClient)),
  );
  expect(resolutions.every((r) => r.statusCode === 200)).toBe(true);
  expect(new Set(resolutions.map((r) => JSON.stringify(r.json()))).size).toBe(1);
  expect(resolutions[0]!.json().server).toEqual(winner.server);
  expect(
    (
      await db.asUser(a, (client) =>
        client.query('SELECT 1 FROM app.manual_correction_audit WHERE user_id=$1 AND root_id=$2', [
          a,
          c.movementId,
        ]),
      )
    ).rowCount,
  ).toBe(3);
  expect((await postCorrection({ ...keep, reason: 'changed' })).statusCode).toBe(409);
  expect((await postCorrection({ ...keep, operationId: randomUUID() })).statusCode).toBe(409);
});
it('explicit replacement resolution reverses the newest journal once and carries lineage through sync', async () => {
  const c = await original();
  expect((await postCorrection(correction(c.movementId, '20'))).statusCode).toBe(200);
  const stale = correction(c.movementId, '30');
  const conflict = (await postCorrection(stale, secondClient)).json();
  expect(conflict.status).toBe('conflict');
  const resolved = { ...correction(c.movementId, '30', '2'), resolves: conflict.operationId };
  const results = await Promise.all(
    Array.from({ length: 5 }, () => postCorrection(resolved, secondClient)),
  );
  expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
  const version = results[0]!.json().server;
  expect(version.version).toBe('3');
  const current = await app.inject({
    method: 'GET',
    url: '/v1/sync/movements/' + c.movementId,
    headers: ha,
  });
  expect(current.json()).toEqual(version);
  const feed = (await app.inject({ method: 'GET', url: '/v1/sync/changes', headers: ha })).json();
  const change = feed.changes.find(
    (row: { movement: { id: string } }) => row.movement.id === version.movementId,
  );
  expect(change.revision).toMatchObject({
    rootId: c.movementId,
    version: '3',
    reversalId: resolved.reversalId,
  });
  expect(
    (
      await db.asUser(a, (client) =>
        client.query('SELECT 1 FROM app.manual_corrections WHERE user_id=$1 AND root_id=$2', [
          a,
          c.movementId,
        ]),
      )
    ).rowCount,
  ).toBe(2);
});
it('foreign identities cannot read, correct or resolve another user; failed replacement rolls back its reversal', async () => {
  const c = await original();
  const correctionCommand = correction(c.movementId);
  expect((await postCorrection(correctionCommand, hb)).statusCode).toBe(403);
  expect(
    (await app.inject({ method: 'GET', url: '/v1/sync/movements/' + c.movementId, headers: hb }))
      .statusCode,
  ).toBe(403);
  correctionCommand.replacement.payload.categoryId = randomUUID();
  expect((await postCorrection(correctionCommand)).statusCode).toBe(403);
  expect(
    (
      await db.asUser(a, (client) =>
        client.query('SELECT 1 FROM app.ledger_transactions WHERE user_id=$1 AND id=$2', [
          a,
          correctionCommand.reversalId,
        ]),
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await db.asUser(a, (client) =>
        client.query(
          'SELECT 1 FROM app.manual_correction_receipts WHERE user_id=$1 AND operation_id=$2',
          [a, correctionCommand.operationId],
        ),
      )
    ).rowCount,
  ).toBe(0);
  const forbidden = { ...correction(c.movementId), user_id: b };
  expect((await postCorrection(forbidden)).statusCode).toBe(422);
  expect(
    (await db.asUser(b, (client) => client.query('SELECT 1 FROM app.manual_corrections'))).rowCount,
  ).toBe(0);
});
it('PostgreSQL denies mutation of correction history and checks incomplete receipts at commit', async () => {
  const c = await original();
  const cmd = correction(c.movementId);
  expect((await postCorrection(cmd)).statusCode).toBe(200);
  await expect(
    db.asUser(a, (client) =>
      client.query('DELETE FROM app.manual_corrections WHERE root_id=$1', [c.movementId]),
    ),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    admin.query('UPDATE app.manual_corrections SET version=9 WHERE user_id=$1 AND root_id=$2', [
      a,
      c.movementId,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.asUser(a, (client) =>
      client.query(
        `INSERT INTO app.manual_correction_receipts(user_id,operation_id,root_id,payload_hash,action,outcome,command,result)
     VALUES($1,$2,$3,$4,'replace','applied','{}','{}')`,
        [a, randomUUID(), c.movementId, 'a'.repeat(64)],
      ),
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
