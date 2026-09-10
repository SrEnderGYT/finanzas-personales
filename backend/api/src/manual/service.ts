import { createHash, randomUUID } from 'node:crypto';
import { canonical, DomainError, identifier, normalizeManual, type Clock } from '@finanzas/domain';
import { UserDatabase } from '../database';
import { LedgerService } from '../ledger/service';
import { LedgerStore, type LedgerContext } from '../ledger/store';
export class ManualMovementService {
  constructor(
    readonly database: UserDatabase,
    readonly clock: Clock = { now: () => new Date() },
  ) {}
  async confirm(context: LedgerContext, input: unknown) {
    identifier(context.userId);
    const command = normalizeManual(input, this.clock),
      p = command.payload,
      userId = context.userId;
    const hash = createHash('sha256').update(canonical(command)).digest('hex');
    return this.database.asUser(userId, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('catalog:'||$1,0))", [userId]);
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('ledger:'||$1,0))", [userId]);
      const old = (
        await c.query<{ payload_hash: string; movement_id: string; recorded_at: Date }>(
          'SELECT * FROM app.manual_receipts WHERE user_id=$1 AND operation_id=$2',
          [userId, command.operationId],
        )
      ).rows[0];
      if (old) {
        if (old.payload_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
        return {
          operationId: command.operationId,
          movementId: old.movement_id,
          payloadHash: hash,
          recordedAt: old.recorded_at.toISOString(),
        };
      }
      if (
        (
          await c.query('SELECT 1 FROM app.ledger_receipts WHERE user_id=$1 AND operation_id=$2', [
            userId,
            command.operationId,
          ])
        ).rowCount
      )
        throw new DomainError('OPERATION_CONFLICT');
      const a = (
        await c.query<{ ledger_account_id: string; currency: string; state: string }>(
          'SELECT ledger_account_id,currency,state FROM app.product_accounts WHERE user_id=$1 AND id=$2',
          [userId, p.accountId],
        )
      ).rows[0];
      const cat = (
        await c.query<{ kind: string; state: string }>(
          'SELECT kind,state FROM app.categories WHERE user_id=$1 AND id=$2',
          [userId, p.categoryId],
        )
      ).rows[0];
      if (!a || !cat) throw new DomainError('REFERENCE_NOT_FOUND');
      if (a.state !== 'active' || cat.state !== 'active')
        throw new DomainError('REFERENCE_INACTIVE');
      if (a.currency !== p.currency || cat.kind !== p.kind)
        throw new DomainError('REFERENCE_MISMATCH');
      const key = `manual:${p.kind}`;
      let technical = (
        await c.query<{ id: string }>(
          'SELECT id FROM app.ledger_accounts WHERE user_id=$1 AND system_key=$2 AND currency=$3 AND nature=$4',
          [userId, key, p.currency, p.kind],
        )
      ).rows[0]?.id;
      if (!technical) {
        technical = randomUUID();
        await c.query(
          'INSERT INTO app.ledger_accounts(user_id,id,currency,nature,system_key) VALUES($1,$2,$3,$4,$5)',
          [userId, technical, p.currency, p.kind, key],
        );
      }
      await new LedgerService(new LedgerStore(this.database), this.clock).executeInTransaction(
        c,
        context,
        {
          operationId: command.operationId,
          deviceId: command.deviceId,
          entityId: command.movementId,
          schemaVersion: 1,
          baseVersion: '0',
          command: {
            type: 'post',
            payload: {
              kind: p.kind,
              currency: p.currency,
              amountMinor: p.amountMinor,
              businessDate: p.businessDate,
              timezone: p.timezone,
              ...(p.occurredAt ? { occurredAt: p.occurredAt } : {}),
              debitAccountId: p.kind === 'expense' ? technical : a.ledger_account_id,
              creditAccountId: p.kind === 'expense' ? a.ledger_account_id : technical,
            },
          },
        },
      );
      await c.query(
        'INSERT INTO app.manual_movements(user_id,id,operation_id,account_id,category_id,journal_id,kind,currency,amount_minor,business_date,timezone,occurred_at,note) VALUES($1,$2,$3,$4,$5,$2,$6,$7,$8,$9,$10,$11,$12)',
        [
          userId,
          command.movementId,
          command.operationId,
          p.accountId,
          p.categoryId,
          p.kind,
          p.currency,
          p.amountMinor,
          p.businessDate,
          p.timezone,
          p.occurredAt ?? null,
          p.note ?? null,
        ],
      );
      const receipt = await c.query<{ recorded_at: Date }>(
        'INSERT INTO app.manual_receipts(user_id,operation_id,movement_id,payload_hash) VALUES($1,$2,$3,$4) RETURNING recorded_at',
        [userId, command.operationId, command.movementId, hash],
      );
      return {
        operationId: command.operationId,
        movementId: command.movementId,
        payloadHash: hash,
        recordedAt: receipt.rows[0]!.recorded_at.toISOString(),
      };
    });
  }
}
