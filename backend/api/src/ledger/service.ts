import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  DomainError,
  canonical,
  identifier,
  normalizeEnvelope,
  post,
  reverse,
  type Clock,
  type Envelope,
  type Journal,
  type LedgerAccount,
} from '@finanzas/domain';
import { LedgerStore, type LedgerContext } from './store';
export type LedgerResult =
  | { status: 'applied' | 'alreadyApplied'; result: { transactionIds: string[] } }
  | { status: 'conflict' | 'invalid'; code: string };
const conflictCodes = new Set([
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'ALREADY_REVERSED',
  'ACTIVE_REFUNDS',
  'REFUND_LIMIT',
]);
/** No auth/provider dependency: caller supplies identity verified at its boundary. */
export class LedgerService {
  constructor(
    readonly store: LedgerStore,
    readonly clock: Clock = { now: () => new Date() },
  ) {}
  async execute(context: LedgerContext, input: Envelope): Promise<LedgerResult> {
    try {
      return await this.store.database.asUser(context.userId, (c) =>
        this.executeInTransaction(c, context, input),
      );
    } catch (error) {
      if (error instanceof DomainError) {
        const code = (error as DomainError).code;
        return { status: conflictCodes.has(code) ? 'conflict' : 'invalid', code };
      }
      const code = (error as { code?: string })?.code;
      if (code === '23505') return { status: 'conflict', code: 'ENTITY_CONFLICT' };
      if (['23503', '23514', '42501', '22003'].includes(code ?? ''))
        return { status: 'invalid', code: 'LEDGER_CONSTRAINT' };
      throw error; // transient infrastructure failures are retryable; no receipt survives rollback.
    }
  }
  /** Internal composition point: caller owns BEGIN/COMMIT and must propagate failures. */
  async executeInTransaction(c: PoolClient, context: LedgerContext, input: Envelope) {
    identifier(context.userId);
    const actual = (
      await c.query<{ id: string }>("SELECT current_setting('app.user_id',true) AS id")
    ).rows[0]?.id;
    if (actual !== context.userId) throw new DomainError('INVALID_TRANSACTION_CONTEXT');
    const command = normalizeEnvelope(input, this.clock);
    const hash = createHash('sha256').update(canonical(command)).digest('hex');
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('ledger:'||$1,0))", [
      context.userId,
    ]);
    const receipt = (
      await c.query<{ payload_hash: string; result: { transactionIds: string[] } }>(
        'SELECT payload_hash,result FROM app.ledger_receipts WHERE user_id=$1 AND operation_id=$2',
        [context.userId, command.operationId],
      )
    ).rows[0];
    if (receipt) {
      if (receipt.payload_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
      return { status: 'alreadyApplied' as const, result: receipt.result };
    }
    const journals = await this.prepare(c, context.userId, command);
    for (const journal of journals)
      await this.store.insert(c, context.userId, journal, command.operationId);
    const result = { transactionIds: journals.map((j) => j.id) };
    await c.query(
      'INSERT INTO app.ledger_receipts(user_id,operation_id,payload_hash,result) VALUES($1,$2,$3,$4)',
      [context.userId, command.operationId, hash, result],
    );
    await c.query(
      "INSERT INTO app.ledger_audit(user_id,operation_id,entity_id,action,outcome) VALUES($1,$2,$3,$4,'applied')",
      [context.userId, command.operationId, command.entityId, command.command.type],
    );
    return { status: 'applied' as const, result };
  }
  async version(context: LedgerContext, id: string): Promise<string> {
    identifier(id);
    return this.store.database.asUser(context.userId, async (c) => {
      await this.store.load(c, context.userId, id);
      return this.versionIn(c, context.userId, id);
    });
  }
  private async versionIn(c: PoolClient, userId: string, id: string): Promise<string> {
    return (
      await c.query<{ version: string }>(
        `SELECT (1+count(*))::text version FROM app.ledger_transactions t WHERE t.user_id=$1 AND
   (t.original_id=$2 OR t.original_id IN (SELECT id FROM app.ledger_transactions WHERE user_id=$1 AND original_id=$2 AND kind='refund'))`,
        [userId, id],
      )
    ).rows[0]!.version;
  }
  private async assertVersion(c: PoolClient, userId: string, id: string, version: string) {
    if ((await this.versionIn(c, userId, id)) !== version)
      throw new DomainError('VERSION_CONFLICT');
  }
  private async assertActive(c: PoolClient, userId: string, id: string) {
    if (
      (
        await c.query(
          "SELECT id FROM app.ledger_transactions WHERE user_id=$1 AND original_id=$2 AND kind='reversal'",
          [userId, id],
        )
      ).rowCount
    )
      throw new DomainError('ALREADY_REVERSED');
  }
  private async refundable(c: PoolClient, userId: string, id: string): Promise<bigint> {
    const result = await c.query<{ total: string }>(
      `SELECT coalesce(sum(r.amount_minor),0)::text total FROM app.ledger_transactions r WHERE r.user_id=$1 AND r.original_id=$2 AND r.kind='refund'
   AND NOT EXISTS(SELECT 1 FROM app.ledger_transactions v WHERE v.user_id=r.user_id AND v.original_id=r.id AND v.kind='reversal')`,
      [userId, id],
    );
    return BigInt(result.rows[0]!.total);
  }
  private async prepare(c: PoolClient, userId: string, envelope: Envelope): Promise<Journal[]> {
    const accounts = (
      await c.query<LedgerAccount>(
        'SELECT id,currency,nature FROM app.ledger_accounts WHERE user_id=$1',
        [userId],
      )
    ).rows;
    const command = envelope.command;
    if (command.type === 'post') {
      const journal = post(envelope.entityId, command.payload, accounts, this.clock);
      if (journal.kind === 'refund') {
        const original = await this.store.load(c, userId, journal.originalId!);
        await this.assertVersion(c, userId, original.id, envelope.baseVersion);
        await this.assertActive(c, userId, original.id);
        if (
          original.kind !== 'expense' ||
          original.currency !== journal.currency ||
          journal.businessDate < original.businessDate ||
          original.entries.find((e) => e.debitMinor !== '0')?.accountId !==
            journal.entries.find((e) => e.creditMinor !== '0')?.accountId
        )
          throw new DomainError('INVALID_REFUND');
        if (
          (await this.refundable(c, userId, original.id)) + BigInt(journal.amountMinor) >
          BigInt(original.amountMinor)
        )
          throw new DomainError('REFUND_LIMIT');
      } else if (envelope.baseVersion !== '0') throw new DomainError('VERSION_CONFLICT');
      return [journal];
    }
    const original = await this.store.load(c, userId, command.payload.originalId);
    await this.assertVersion(c, userId, original.id, envelope.baseVersion);
    await this.assertActive(c, userId, original.id);
    if (original.kind === 'expense' && (await this.refundable(c, userId, original.id)) > 0n)
      throw new DomainError('ACTIVE_REFUNDS');
    if (command.type === 'reverse')
      return [reverse(envelope.entityId, original, command.payload, this.clock)];
    return [
      reverse(command.payload.reversalId, original, command.payload, this.clock),
      post(envelope.entityId, command.payload.replacement, accounts, this.clock),
    ];
  }
}
