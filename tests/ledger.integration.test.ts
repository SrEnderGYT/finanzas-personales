import type { PoolClient } from 'pg';
import { LedgerService } from '../backend/api/src/ledger/service';
import type { Envelope, Posting, Journal } from '../packages/domain/src';
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
it('composes a ledger write in a caller transaction and rolls back on caller failure', async () => {
  const a = await fixture();
  const command: Envelope = {
    operationId: randomUUID(),
    deviceId: randomUUID(),
    entityId: randomUUID(),
    schemaVersion: 1,
    baseVersion: '0',
    command: {
      type: 'post',
      payload: {
        kind: 'expense',
        currency: 'PEN',
        amountMinor: '10',
        businessDate: '2026-08-01',
        timezone: 'America/Lima',
        debitAccountId: a.accounts[2]!.id,
        creditAccountId: a.accounts[0]!.id,
      },
    },
  };
  const service = new LedgerService(store, clock);
  await expect(
    db.asUser(a.userId, async (c) => {
      await service.executeInTransaction(c, a, command);
      throw new Error('caller rollback');
    }),
  ).rejects.toThrow('caller rollback');
  expect(
    (
      await db.asUser(a.userId, (c) =>
        c.query('SELECT 1 FROM app.ledger_receipts WHERE operation_id=$1', [command.operationId]),
      )
    ).rowCount,
  ).toBe(0);
  await expect(
    db.asUser(a.userId, (c) => service.executeInTransaction(c, { userId: randomUUID() }, command)),
  ).rejects.toThrow('INVALID_TRANSACTION_CONTEXT');
});
it('seals balanced journals and rejects append, mutation and cross-user access', async () => {
  const a = await fixture(),
    b = await fixture();
  await db.asUser(a.userId, (c) => persist(c, a.userId, a.journal));
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
  await expect(db.asUser(a.userId, (c) => persist(c, a.userId, bad))).rejects.toThrow();
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
    await expect(db.asUser(a.userId, (c) => persist(c, a.userId, journal))).rejects.toThrow();
  expect(
    await db.asUser(
      a.userId,
      async (c) =>
        (await c.query('SELECT id FROM app.ledger_transactions WHERE user_id=$1', [a.userId]))
          .rowCount,
    ),
  ).toBe(0);
});

it('requires an adjustment reason at the database boundary too', async () => {
  const a = await fixture();
  await expect(
    db.asUser(a.userId, (c) =>
      c.query(
        `INSERT INTO app.ledger_transactions(user_id,id,kind,currency,amount_minor,business_date,timezone,operation_id)
     VALUES($1,$2,'adjustment','PEN',100,'2026-08-01','America/Lima',$3)`,
        [a.userId, randomUUID(), randomUUID()],
      ),
    ),
  ).rejects.toMatchObject({ constraint: 'ledger_adjustment_reason_required' });
});

function command(
  a: Awaited<ReturnType<typeof fixture>>,
  override: Partial<Posting> = {},
): Envelope {
  return {
    operationId: randomUUID(),
    deviceId: randomUUID(),
    entityId: randomUUID(),
    schemaVersion: 1,
    baseVersion: '0',
    command: {
      type: 'post',
      payload: {
        kind: 'expense',
        currency: 'PEN',
        amountMinor: '10000',
        businessDate: '2026-08-01',
        timezone: 'America/Lima',
        debitAccountId: a.accounts[2]!.id,
        creditAccountId: a.accounts[1]!.id,
        ...override,
      } as Posting,
    },
  };
}
const service = new LedgerService(store, clock);
it('applies five concurrent retries once and rejects changed payload without conflating identical purchases', async () => {
  const a = await fixture(),
    cmd = command(a);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => service.execute(a, JSON.parse(JSON.stringify(cmd)))),
  );
  expect(results.filter((r) => r.status === 'applied')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'alreadyApplied')).toHaveLength(4);
  expect(await service.execute(a, { ...cmd, deviceId: randomUUID() })).toMatchObject({
    status: 'conflict',
    code: 'IDEMPOTENCY_CONFLICT',
  });
  expect((await service.execute(a, command(a))).status).toBe('applied');
  expect((await service.execute(a, cmd)).status).toBe('alreadyApplied');
  expect(
    await db.asUser(
      a.userId,
      async (c) =>
        (await c.query('SELECT * FROM app.ledger_receipts WHERE user_id=$1', [a.userId])).rowCount,
    ),
  ).toBe(2);
  expect(
    await db.asUser(
      a.userId,
      async (c) =>
        (await c.query('SELECT * FROM app.ledger_audit WHERE user_id=$1', [a.userId])).rowCount,
    ),
  ).toBe(2);
});
it('rolls back journal and receipt on failed correction and protects refund capacity under concurrency', async () => {
  const a = await fixture(),
    purchase = command(a);
  expect((await service.execute(a, purchase)).status).toBe('applied');
  const refund = () => ({
    ...command(a, {
      kind: 'refund',
      originalId: purchase.entityId,
      amountMinor: '6000',
      businessDate: '2026-09-01',
      debitAccountId: a.accounts[0]!.id,
      creditAccountId: a.accounts[2]!.id,
    }),
    baseVersion: '1',
  });
  const r1 = refund(),
    r2 = refund();
  const results = await Promise.all([service.execute(a, r1), service.execute(a, r2)]);
  expect(results.filter((r) => r.status === 'applied')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'conflict')).toHaveLength(1);
  const winner = results[0]!.status === 'applied' ? r1 : r2;
  const rejected = results[0]!.status === 'applied' ? r2 : r1;
  expect(
    await service.execute(a, {
      ...rejected,
      baseVersion: await service.version(a, purchase.entityId),
    }),
  ).toMatchObject({ status: 'conflict', code: 'REFUND_LIMIT' });
  const undo: Envelope = {
    ...command(a),
    baseVersion: await service.version(a, purchase.entityId),
    command: {
      type: 'reverse',
      payload: {
        originalId: purchase.entityId,
        businessDate: '2026-09-02',
        timezone: 'America/Lima',
      },
    },
  };
  expect(await service.execute(a, undo)).toMatchObject({
    status: 'conflict',
    code: 'ACTIVE_REFUNDS',
  });
  const undoRefund: Envelope = {
    ...command(a),
    baseVersion: '1',
    command: {
      type: 'reverse',
      payload: {
        originalId: winner.entityId,
        businessDate: '2026-09-02',
        timezone: 'America/Lima',
      },
    },
  };
  expect((await service.execute(a, undoRefund)).status).toBe('applied');
  const correction: Envelope = {
    ...command(a),
    baseVersion: await service.version(a, purchase.entityId),
    command: {
      type: 'correct',
      payload: {
        originalId: purchase.entityId,
        reversalId: randomUUID(),
        businessDate: '2026-09-02',
        timezone: 'America/Lima',
        replacement: {
          kind: 'expense',
          currency: 'PEN',
          amountMinor: '3000',
          businessDate: '2026-09-02',
          timezone: 'America/Lima',
          debitAccountId: randomUUID(),
          creditAccountId: a.accounts[0]!.id,
        },
      },
    },
  };
  expect((await service.execute(a, correction)).status).toBe('invalid');
  expect(
    await db.asUser(
      a.userId,
      async (c) =>
        (
          await c.query('SELECT * FROM app.ledger_receipts WHERE user_id=$1 AND operation_id=$2', [
            a.userId,
            correction.operationId,
          ])
        ).rowCount,
    ),
  ).toBe(0);
  const revisions = await Promise.all([
    service.execute(a, {
      ...undo,
      operationId: randomUUID(),
      entityId: randomUUID(),
      baseVersion: await service.version(a, purchase.entityId),
    }),
    service.execute(a, {
      ...undo,
      operationId: randomUUID(),
      entityId: randomUUID(),
      baseVersion: await service.version(a, purchase.entityId),
    }),
  ]);
  expect(revisions.filter((r) => r.status === 'applied')).toHaveLength(1);
  expect(revisions.filter((r) => r.status === 'conflict')).toHaveLength(1);
});
it('atomically corrects money and rejects references owned by another user', async () => {
  const a = await fixture(),
    b = await fixture(),
    purchase = command(a);
  await service.execute(a, purchase);
  const correction: Envelope = {
    ...command(a),
    baseVersion: '1',
    command: {
      type: 'correct',
      payload: {
        originalId: purchase.entityId,
        reversalId: randomUUID(),
        businessDate: '2026-09-02',
        timezone: 'America/Lima',
        replacement: {
          kind: 'expense',
          currency: 'PEN',
          amountMinor: '4000',
          businessDate: '2026-09-02',
          timezone: 'America/Lima',
          debitAccountId: a.accounts[2]!.id,
          creditAccountId: a.accounts[1]!.id,
        },
      },
    },
  };
  expect((await service.execute(b, correction)).status).toBe('invalid');
  expect((await service.execute(a, correction)).status).toBe('applied');
  expect(
    (await store.balances(a)).find((row) => row.accountId === a.accounts[2]!.id)!.amountMinor,
  ).toBe('4000');
  expect((await service.execute(a, correction)).status).toBe('alreadyApplied');
});

it('rolls back an already inserted reversal if replacement insert conflicts', async () => {
  const a = await fixture(),
    purchase = command(a);
  await service.execute(a, purchase);
  const reversalId = randomUUID();
  const correction: Envelope = {
    ...command(a),
    entityId: purchase.entityId,
    baseVersion: '1',
    command: {
      type: 'correct',
      payload: {
        originalId: purchase.entityId,
        reversalId,
        businessDate: '2026-09-02',
        timezone: 'America/Lima',
        replacement: (command(a).command as { type: 'post'; payload: Posting }).payload,
      },
    },
  };
  expect((await service.execute(a, correction)).status).toBe('conflict');
  await expect(store.journal(a, reversalId)).rejects.toThrow('NOT_FOUND');
  expect(await service.version(a, purchase.entityId)).toBe('1');
  expect(
    await db.asUser(
      a.userId,
      async (c) =>
        (await c.query('SELECT operation_id FROM app.ledger_receipts WHERE user_id=$1', [a.userId]))
          .rowCount,
    ),
  ).toBe(1);
});
it('serializes a refund racing a reversal and rejects reversal of a reversal', async () => {
  const a = await fixture(),
    purchase = command(a);
  await service.execute(a, purchase);
  const refund = {
    ...command(a, {
      kind: 'refund',
      originalId: purchase.entityId,
      amountMinor: '10000',
      debitAccountId: a.accounts[0]!.id,
      creditAccountId: a.accounts[2]!.id,
    }),
    baseVersion: '1',
  };
  const undo: Envelope = {
    ...command(a),
    baseVersion: '1',
    command: {
      type: 'reverse',
      payload: {
        originalId: purchase.entityId,
        businessDate: '2026-09-02',
        timezone: 'America/Lima',
      },
    },
  };
  const result = await Promise.all([service.execute(a, refund), service.execute(a, undo)]);
  expect(result.filter((r) => r.status === 'applied')).toHaveLength(1);
  expect(result.filter((r) => r.status === 'conflict')).toHaveLength(1);
  const b = await fixture(),
    p = command(b);
  await service.execute(b, p);
  const reversed = {
    ...undo,
    operationId: randomUUID(),
    entityId: randomUUID(),
    command: {
      type: 'reverse' as const,
      payload: { ...undo.command.payload, originalId: p.entityId },
    },
  };
  expect((await service.execute(b, reversed)).status).toBe('applied');
  expect(
    await service.execute(b, {
      ...reversed,
      operationId: randomUUID(),
      entityId: randomUUID(),
      command: {
        type: 'reverse',
        payload: {
          originalId: reversed.entityId,
          businessDate: '2026-09-03',
          timezone: 'America/Lima',
        },
      },
    }),
  ).toMatchObject({ status: 'invalid', code: 'REVERSE_REVERSAL' });
});
it('isolates receipts and balances for the same operation ID across users', async () => {
  const a = await fixture(),
    b = await fixture(),
    x = command(a),
    y = { ...command(b), operationId: x.operationId };
  expect((await service.execute(a, x)).status).toBe('applied');
  expect((await service.execute(b, y)).status).toBe('applied');
  const records = await db.asUser(
    a.userId,
    async (c) => (await c.query('SELECT user_id FROM app.ledger_receipts')).rows,
  );
  expect(records.every((row) => row.user_id === a.userId)).toBe(true);
  expect(
    (await store.balances(a)).every((row) =>
      a.accounts.some((account) => account.id === row.accountId),
    ),
  ).toBe(true);
  expect((await pool.query('SELECT * FROM app.ledger_entries')).rowCount).toBe(0);
});
it('persists 10,000 synthetic commands with exact per-currency balances and receipts', async () => {
  const a = await fixture();
  const usdExpense: LedgerAccount = { id: randomUUID(), currency: 'USD', nature: 'expense' };
  const usdAsset: LedgerAccount = { id: randomUUID(), currency: 'USD', nature: 'asset' };
  await store.createTechnicalAccount(a, usdExpense);
  await store.createTechnicalAccount(a, usdAsset);
  let last!: Envelope;
  for (let i = 0; i < 10000; i++) {
    last = command(
      a,
      i % 2
        ? {
            currency: 'USD',
            amountMinor: '1',
            debitAccountId: usdExpense.id,
            creditAccountId: usdAsset.id,
          }
        : { amountMinor: '1' },
    );
    if ((await service.execute(a, last)).status !== 'applied')
      throw new Error('Synthetic volume command failed');
  }
  expect((await service.execute(a, last)).status).toBe('alreadyApplied');
  const result = await store.balances(a);
  expect(result.find((r) => r.accountId === a.accounts[2]!.id)!.amountMinor).toBe('5000');
  expect(result.find((r) => r.accountId === usdExpense.id)!.amountMinor).toBe('5000');
  expect(
    await db.asUser(
      a.userId,
      async (c) =>
        (
          await c.query('SELECT count(*)::text n FROM app.ledger_transactions WHERE user_id=$1', [
            a.userId,
          ])
        ).rows[0].n,
    ),
  ).toBe('10000');
  expect(
    await db.asUser(
      a.userId,
      async (c) =>
        (
          await c.query('SELECT count(*)::text n FROM app.ledger_receipts WHERE user_id=$1', [
            a.userId,
          ])
        ).rows[0].n,
    ),
  ).toBe('10000');
}, 180000);

async function persist(c: PoolClient, userId: string, journal: Journal) {
  const operationId = randomUUID();
  await store.insert(c, userId, journal, operationId);
  await c.query(
    'INSERT INTO app.ledger_receipts(user_id,operation_id,payload_hash,result) VALUES($1,$2,$3,$4)',
    [userId, operationId, '0'.repeat(64), { transactionIds: [journal.id] }],
  );
  await c.query(
    "INSERT INTO app.ledger_audit(user_id,operation_id,entity_id,action,outcome) VALUES($1,$2,$3,'post','applied')",
    [userId, operationId, journal.id],
  );
}
it('cannot commit a journal without its matching receipt and audit', async () => {
  const a = await fixture();
  await expect(
    db.asUser(a.userId, (c) => store.insert(c, a.userId, a.journal, randomUUID())),
  ).rejects.toThrow();
  await expect(store.journal(a, a.journal.id)).rejects.toThrow('NOT_FOUND');
});
it('enforces refund capacity and exact reversals when bypassing the service', async () => {
  const a = await fixture();
  await db.asUser(a.userId, (c) => persist(c, a.userId, a.journal));
  const excessive = post(
    randomUUID(),
    {
      kind: 'refund',
      originalId: a.journal.id,
      amountMinor: '10001',
      currency: 'PEN',
      businessDate: '2026-09-01',
      timezone: 'America/Lima',
      debitAccountId: a.accounts[0]!.id,
      creditAccountId: a.accounts[2]!.id,
    },
    a.accounts,
    clock,
  );
  await expect(db.asUser(a.userId, (c) => persist(c, a.userId, excessive))).rejects.toThrow();
  const invalid: Journal = {
    ...a.journal,
    id: randomUUID(),
    kind: 'reversal',
    originalId: a.journal.id,
    entries: a.journal.entries.map((e) => ({
      ...e,
      debitMinor: e.creditMinor,
      creditMinor: e.debitMinor,
      accountId: e.creditMinor !== '0' ? a.accounts[0]!.id : e.accountId,
    })),
  };
  await expect(db.asUser(a.userId, (c) => persist(c, a.userId, invalid))).rejects.toThrow();
});

it('cannot attach a later journal to a committed receipt', async () => {
  const a = await fixture(),
    cmd = command(a);
  await service.execute(a, cmd);
  await expect(
    db.asUser(a.userId, (c) => store.insert(c, a.userId, a.journal, cmd.operationId)),
  ).rejects.toThrow();
  await expect(store.journal(a, a.journal.id)).rejects.toThrow('NOT_FOUND');
});
