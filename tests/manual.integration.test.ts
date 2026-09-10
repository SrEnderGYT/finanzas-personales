import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, it, expect } from 'vitest';
import { UserDatabase } from '../backend/api/src/database';
import { CatalogExecutor } from '../backend/api/src/catalog/executor';
import { mutateAccount } from '../backend/api/src/catalog/accounts';
import { mutateCategory } from '../backend/api/src/catalog/categories';
import { ManualMovementService } from '../backend/api/src/manual/service';
if (!process.env['P04_TEST_DATABASE_URL']) throw new Error('Use npm run test:postgres');
const pool = new Pool({ connectionString: process.env['P04_TEST_DATABASE_URL'] }),
  admin = new Pool({ connectionString: process.env['P04_TEST_ADMIN_URL'] }),
  db = new UserDatabase(pool),
  service = new ManualMovementService(db);
afterAll(async () => {
  await pool.end();
  await admin.end();
});
async function fixture() {
  const userId = randomUUID(),
    accountId = randomUUID(),
    categoryId = randomUUID();
  await admin.query('INSERT INTO app.users(id) VALUES($1)', [userId]);
  const ex = new CatalogExecutor(db);
  const env = (command: unknown) => ({
    operationId: randomUUID(),
    deviceId: randomUUID(),
    schemaVersion: 1,
    baseVersion: '0',
    command,
  });
  await ex.execute(
    userId,
    env({
      type: 'account.create',
      id: accountId,
      payload: { name: 'Synthetic', type: 'cash', currency: 'PEN', state: 'active', position: 0 },
    }),
    (c, n) => mutateAccount(c, userId, n),
  );
  await ex.execute(
    userId,
    env({
      type: 'category.create',
      id: categoryId,
      payload: { name: 'Synthetic', kind: 'expense', state: 'active', position: 0 },
    }),
    (c, n) => mutateCategory(c, userId, n),
  );
  return {
    userId,
    command: {
      operationId: randomUUID(),
      deviceId: randomUUID(),
      movementId: randomUUID(),
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
        note: 'Synthetic note',
      },
    },
  };
}
it('confirms exactly once, preserves explicit date/zone and rejects cross-user references', async () => {
  const a = await fixture(),
    b = await fixture();
  const results = await Promise.all(Array.from({ length: 5 }, () => service.confirm(a, a.command)));
  expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  expect(
    (
      await db.asUser(a.userId, (c) =>
        c.query(
          "SELECT amount_minor,to_char(business_date,'YYYY-MM-DD') day,timezone FROM app.manual_movements",
        ),
      )
    ).rows,
  ).toEqual([{ amount_minor: '10', day: '2026-01-01', timezone: 'America/Lima' }]);
  await expect(
    service.confirm(a, { ...a.command, payload: { ...a.command.payload, note: 'different' } }),
  ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  for (const field of ['accountId', 'categoryId'] as const)
    await expect(
      service.confirm(a, {
        ...a.command,
        operationId: randomUUID(),
        movementId: randomUUID(),
        payload: { ...a.command.payload, [field]: b.command.payload[field] },
      }),
    ).rejects.toThrow('REFERENCE_NOT_FOUND');
  expect(
    (await db.asUser(b.userId, (c) => c.query('SELECT * FROM app.manual_movements'))).rowCount,
  ).toBe(0);
  await expect(
    service.confirm(a, {
      ...a.command,
      operationId: randomUUID(),
      movementId: randomUUID(),
      payload: { ...a.command.payload, currency: 'USD' },
    }),
  ).rejects.toThrow('REFERENCE_MISMATCH');
});
it('rolls back journal and receipt when movement insertion fails', async () => {
  const a = await fixture();
  // Synthetic fault injection in this isolated test DB, scoped to this user only.
  await admin.query(
    `CREATE FUNCTION app.manual_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${a.userId}'::uuid THEN RAISE EXCEPTION 'synthetic insertion failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER manual_test_failure BEFORE INSERT ON app.manual_movements FOR EACH ROW EXECUTE FUNCTION app.manual_test_failure();`,
  );
  try {
    await expect(service.confirm(a, a.command)).rejects.toThrow('synthetic insertion failure');
    expect(
      (await db.asUser(a.userId, (c) => c.query('SELECT 1 FROM app.ledger_transactions'))).rowCount,
    ).toBe(0);
    expect(
      (await db.asUser(a.userId, (c) => c.query('SELECT 1 FROM app.ledger_receipts'))).rowCount,
    ).toBe(0);
  } finally {
    await admin.query(
      'DROP TRIGGER manual_test_failure ON app.manual_movements; DROP FUNCTION app.manual_test_failure();',
    );
  }
  expect((await service.confirm(a, a.command)).movementId).toBe(a.command.movementId);
});
