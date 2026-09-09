import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { post, type LedgerAccount } from '../packages/domain/src';
import { UserDatabase } from '../backend/api/src/database';
import { LedgerStore } from '../backend/api/src/ledger/store';
if (!process.env['P04_TEST_DATABASE_URL']) throw new Error('Use npm run test:postgres');
const pool = new Pool({ connectionString: process.env['P04_TEST_DATABASE_URL'] });
const admin = new Pool({ connectionString: process.env['P04_TEST_ADMIN_URL'] });
const db = new UserDatabase(pool),
  store = new LedgerStore(db);
const clock = { now: () => new Date('2026-09-09T12:00:00Z') };
async function fixture() {
  const userId = randomUUID();
  await admin.query('INSERT INTO app.users(id) VALUES($1)', [userId]);
  const accounts: LedgerAccount[] = ['asset', 'liability', 'expense', 'income', 'equity'].map(
    (nature) => ({ id: randomUUID(), currency: 'PEN', nature: nature as LedgerAccount['nature'] }),
  );
  for (const account of accounts) await store.createTechnicalAccount({ userId }, account);
  const journal = post(
    randomUUID(),
    {
      kind: 'expense',
      currency: 'PEN',
      amountMinor: '10000',
      businessDate: '2026-08-01',
      timezone: 'America/Lima',
      debitAccountId: accounts[2]!.id,
      creditAccountId: accounts[1]!.id,
    },
    accounts,
    clock,
  );
  return { userId, accounts, journal };
}
afterAll(async () => {
  await pool.end();
  await admin.end();
});
it('seals balanced journals and rejects append, mutation and cross-user access', async () => {
  const a = await fixture(),
    b = await fixture();
  await db.asUser(a.userId, (c) => store.insert(c, a.userId, a.journal));
  expect((await store.journal(a, a.journal.id)).amountMinor).toBe('10000');
  await expect(store.journal(b, a.journal.id)).rejects.toThrow('NOT_FOUND');
  await expect(
    db.asUser(a.userId, (c) =>
      c.query('INSERT INTO app.ledger_entries VALUES($1,$2,$3,$4,1,0)', [
        a.userId,
        a.journal.id,
        a.accounts[0]!.id,
        'PEN',
      ]),
    ),
  ).rejects.toThrow();
  await expect(
    db.asUser(a.userId, (c) =>
      c.query('UPDATE app.ledger_transactions SET sealed=false WHERE user_id=$1 AND id=$2', [
        a.userId,
        a.journal.id,
      ]),
    ),
  ).rejects.toThrow();
  await expect(
    db.asUser(a.userId, (c) =>
      c.query('DELETE FROM app.ledger_entries WHERE user_id=$1', [a.userId]),
    ),
  ).rejects.toThrow();
  const bad = {
    ...a.journal,
    id: randomUUID(),
    entries: a.journal.entries.map((e, i) => (i ? { ...e, accountId: b.accounts[1]!.id } : e)),
  };
  await expect(db.asUser(a.userId, (c) => store.insert(c, a.userId, bad))).rejects.toThrow();
});
it('rolls back unbalanced, empty, wrong-nature and mixed-currency SQL writes', async () => {
  const a = await fixture();
  for (const journal of [
    { ...a.journal, id: randomUUID(), entries: [] },
    {
      ...a.journal,
      id: randomUUID(),
      entries: a.journal.entries.map((e, i) => (i ? { ...e, creditMinor: '9999' } : e)),
    },
    { ...a.journal, id: randomUUID(), kind: 'payment' as const },
    { ...a.journal, id: randomUUID(), currency: 'USD' as const },
  ])
    await expect(db.asUser(a.userId, (c) => store.insert(c, a.userId, journal))).rejects.toThrow();
  expect(
    await db.asUser(
      a.userId,
      async (c) =>
        (await c.query('SELECT id FROM app.ledger_transactions WHERE user_id=$1', [a.userId]))
          .rowCount,
    ),
  ).toBe(0);
});
