import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { UserDatabase } from '../backend/api/src/database';
import { CatalogExecutor } from '../backend/api/src/catalog/executor';
import { mutateAccount } from '../backend/api/src/catalog/accounts';
import { mutateCategory } from '../backend/api/src/catalog/categories';
import { LedgerStore } from '../backend/api/src/ledger/store';
if (!process.env['P04_TEST_DATABASE_URL']) throw new Error('Use npm run test:postgres');
const pool = new Pool({ connectionString: process.env['P04_TEST_DATABASE_URL'] });
const admin = new Pool({ connectionString: process.env['P04_TEST_ADMIN_URL'] });
const db = new UserDatabase(pool);
it('rejects direct SQL mappings across owners, currencies, nature and committed receipts', async () => {
  const a = await user(),
    b = await user(),
    store = new LedgerStore(db);
  const foreign = randomUUID(),
    liability = randomUUID(),
    usd = randomUUID();
  await store.createTechnicalAccount(
    { userId: b },
    { id: foreign, currency: 'PEN', nature: 'asset' },
  );
  await store.createTechnicalAccount(
    { userId: a },
    { id: liability, currency: 'PEN', nature: 'liability' },
  );
  await store.createTechnicalAccount({ userId: a }, { id: usd, currency: 'USD', nature: 'asset' });
  for (const technical of [foreign, liability, usd])
    await expect(
      db.asUser(a, (c) =>
        c.query(
          "INSERT INTO app.product_accounts(user_id,id,ledger_account_id,name,type,currency,state,position,operation_id) VALUES($1,$2,$3,'Fixture','cash','PEN','active',0,$4)",
          [a, randomUUID(), technical, randomUUID()],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  const e = account();
  await executeAccount(a, e);
  const empty = initialize();
  await new CatalogExecutor(db).execute(a, empty, async () => []);
  await expect(
    db.asUser(a, (c) =>
      c.query(
        "UPDATE app.product_accounts SET name='unreceipted',version=version+1,operation_id=$2 WHERE id=$1",
        [e.command.id, empty.operationId],
      ),
    ),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await db.asUser(a, (c) =>
        c.query('SELECT name,version FROM app.product_accounts WHERE id=$1', [e.command.id]),
      )
    ).rows[0],
  ).toMatchObject({ name: 'Caja DEMO', version: '1' });
  const victim = account();
  await executeAccount(b, victim);
  await expect(
    db.asUser(a, (c) =>
      c.query('INSERT INTO app.catalog_audit_entities VALUES($1,$2,$3,$4,NULL)', [
        a,
        e.operationId,
        randomUUID(),
        victim.command.id,
      ]),
    ),
  ).rejects.toMatchObject({ code: '23503' });
  expect((await pool.query('SELECT * FROM app.product_accounts')).rowCount).toBe(0);
  await expect(
    db.asUser(a, (c) => c.query('UPDATE app.catalog_receipts SET result=result')),
  ).rejects.toMatchObject({ code: '42501' });
});
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
  const retries = await Promise.all(Array.from({ length: 5 }, () => executeAccount(a, e)));
  expect(retries.filter((r) => r.status === 'applied')).toHaveLength(1);
  expect(retries.filter((r) => r.status === 'alreadyApplied')).toHaveLength(4);
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
const executeCategory = (id: string, e: unknown) =>
  new CatalogExecutor(db).execute(id, e, (c, n) => mutateCategory(c, id, n));
it('initializes private categories concurrently and preserves archived customizations', async () => {
  const a = await user(),
    b = await user();
  await Promise.all([executeCategory(a, initialize()), executeCategory(a, initialize())]);
  let rows = (await db.asUser(a, (c) => c.query('SELECT * FROM app.categories ORDER BY position')))
    .rows;
  expect(rows).toHaveLength(21);
  expect(rows.filter((r) => r.kind === 'income')).toHaveLength(2);
  const first = rows[0];
  await executeCategory(a, {
    ...initialize(),
    baseVersion: '1',
    command: {
      type: 'category.update',
      id: first.id,
      payload: { name: 'Mi comida', state: 'archived', position: 99 },
    },
  });
  await executeCategory(a, initialize());
  rows = (
    await db.asUser(a, (c) => c.query('SELECT * FROM app.categories WHERE id=$1', [first.id]))
  ).rows;
  expect(rows[0]).toMatchObject({
    name: 'Mi comida',
    state: 'archived',
    position: 99,
    version: '2',
  });
  expect((await db.asUser(b, (c) => c.query('SELECT * FROM app.categories'))).rows).toHaveLength(0);
  await executeCategory(b, initialize());
  expect(
    (
      await db.asUser(b, (c) =>
        c.query('SELECT name FROM app.categories WHERE template_key=$1', [first.template_key]),
      )
    ).rows[0].name,
  ).not.toBe('Mi comida');
  await expect(
    pool.query("UPDATE app.category_templates SET name='changed'"),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    db.asUser(a, (c) => c.query("UPDATE app.categories SET kind='income' WHERE id=$1", [first.id])),
  ).rejects.toMatchObject({ code: '42501' });
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
