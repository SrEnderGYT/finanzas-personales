import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { UserDatabase } from '../backend/api/src/database';
import { CatalogExecutor } from '../backend/api/src/catalog/executor';
import { mutateAccount } from '../backend/api/src/catalog/accounts';
if (!process.env['P04_TEST_DATABASE_URL']) throw new Error('Use npm run test:postgres');
const pool = new Pool({ connectionString: process.env['P04_TEST_DATABASE_URL'] });
const admin = new Pool({ connectionString: process.env['P04_TEST_ADMIN_URL'] });
const db = new UserDatabase(pool);
async function user() {
  const id = randomUUID();
  await admin.query('INSERT INTO app.users(id) VALUES($1)', [id]);
  return id;
}
const initialize = () => ({
  operationId: randomUUID(),
  deviceId: randomUUID(),
  schemaVersion: 1,
  baseVersion: '0',
  command: { type: 'category.initialize' },
});
const account = () => ({
  ...initialize(),
  command: {
    type: 'account.create',
    id: randomUUID(),
    payload: { name: 'Caja DEMO', type: 'cash', currency: 'PEN', state: 'active', position: 0 },
  },
});
const executeAccount = (id: string, e: unknown) =>
  new CatalogExecutor(db).execute(id, e, (c, n) => mutateAccount(c, id, n));
it('creates a private asset mapping atomically and serializes account edits', async () => {
  const a = await user(),
    b = await user(),
    e = account();
  await executeAccount(a, e);
  const stored = (
    await db.asUser(a, (c) =>
      c.query('SELECT * FROM app.product_accounts WHERE id=$1', [e.command.id]),
    )
  ).rows[0]!;
  expect(stored.ledger_account_id).not.toBe(e.command.id);
  expect(
    (
      await db.asUser(a, (c) =>
        c.query('SELECT nature FROM app.ledger_accounts WHERE id=$1', [stored.ledger_account_id]),
      )
    ).rows[0].nature,
  ).toBe('asset');
  expect((await db.asUser(a, (c) => c.query('SELECT 1 FROM app.ledger_entries'))).rowCount).toBe(0);
  const edit = () => ({
    ...initialize(),
    baseVersion: '1',
    command: { type: 'account.update', id: e.command.id, payload: { state: 'inactive' } },
  });
  const edits = await Promise.allSettled([executeAccount(a, edit()), executeAccount(a, edit())]);
  expect(edits.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  await expect(executeAccount(b, edit())).rejects.toThrow('NOT_FOUND');
  await expect(executeAccount(a, { ...account(), command: { ...e.command } })).rejects.toThrow(
    'ENTITY_CONFLICT',
  );
  expect((await db.asUser(a, (c) => c.query('SELECT 1 FROM app.ledger_accounts'))).rowCount).toBe(
    1,
  );
  await expect(
    db.asUser(a, (c) =>
      c.query("UPDATE app.product_accounts SET currency='USD' WHERE id=$1", [e.command.id]),
    ),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    db.asUser(a, (c) => c.query('DELETE FROM app.product_accounts WHERE id=$1', [e.command.id])),
  ).rejects.toMatchObject({ code: '42501' });
});
afterAll(async () => {
  await pool.end();
  await admin.end();
});
it('catalog receipts retry once, isolate users and rollback failures', async () => {
  const a = await user(),
    b = await user(),
    e = initialize(),
    executor = new CatalogExecutor(db);
  let mutations = 0;
  const mutate = async () => {
    mutations++;
    return [];
  };
  const results = await Promise.all(
    Array.from({ length: 5 }, () => executor.execute(a, e, mutate)),
  );
  expect(results.filter((r) => r.status === 'applied')).toHaveLength(1);
  expect(mutations).toBe(1);
  expect((await executor.execute(a, JSON.parse(JSON.stringify(e)), mutate)).status).toBe(
    'alreadyApplied',
  );
  await expect(executor.execute(a, { ...e, deviceId: randomUUID() }, mutate)).rejects.toThrow(
    'IDEMPOTENCY_CONFLICT',
  );
  expect((await executor.execute(b, e, mutate)).status).toBe('applied');
  const failed = initialize();
  await expect(
    executor.execute(a, failed, async () => {
      throw new Error('synthetic interruption');
    }),
  ).rejects.toThrow('synthetic interruption');
  expect(
    (
      await db.asUser(a, (c) =>
        c.query('SELECT 1 FROM app.catalog_receipts WHERE operation_id=$1', [failed.operationId]),
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (await db.asUser(a, (c) => c.query('SELECT 1 FROM app.catalog_receipts WHERE user_id=$1', [b])))
      .rowCount,
  ).toBe(0);
  await expect(
    db.asUser(a, (c) =>
      c.query("INSERT INTO app.catalog_receipts VALUES($1,$2,1,$3,'{}',now())", [
        a,
        randomUUID(),
        '0'.repeat(64),
      ]),
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
