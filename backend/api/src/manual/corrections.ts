import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  canonical,
  DomainError,
  identifier,
  normalizeCorrection,
  normalizeManual,
  differingMovementFields,
  type Clock,
  type CorrectionResult,
  type MovementVersion,
} from '@finanzas/domain';
import { UserDatabase } from '../database';
import { LedgerService } from '../ledger/service';
import { LedgerStore } from '../ledger/store';
import { ManualMovementService } from './service';

export class ManualCorrectionService {
  constructor(
    readonly database: UserDatabase,
    readonly clock: Clock = { now: () => new Date() },
  ) {}
  private async lock(c: PoolClient, userId: string) {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('catalog:'||$1,0))", [userId]);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('ledger:'||$1,0))", [userId]);
  }
  async current(userId: string, rootId: string) {
    identifier(userId);
    identifier(rootId);
    return this.database.asUser(userId, async (c) => {
      await this.lock(c, userId);
      return this.currentIn(c, userId, rootId);
    });
  }
  private async currentIn(c: PoolClient, userId: string, rootId: string): Promise<MovementVersion> {
    const root = await c.query(
      `SELECT 1 FROM app.manual_movements m WHERE m.user_id=$1 AND m.id=$2
       AND NOT EXISTS(SELECT 1 FROM app.manual_corrections r WHERE r.user_id=m.user_id AND r.replacement_id=m.id)`,
      [userId, rootId],
    );
    if (!root.rowCount) throw new DomainError('REFERENCE_NOT_FOUND');
    const revision = (
      await c.query<{ version: string; replacement_id: string }>(
        'SELECT version,replacement_id FROM app.manual_corrections WHERE user_id=$1 AND root_id=$2 ORDER BY version DESC LIMIT 1',
        [userId, rootId],
      )
    ).rows[0];
    const movementId = revision?.replacement_id ?? rootId;
    const row = (
      await c.query<{ operation_id: string; payload: unknown }>(
        `SELECT operation_id,jsonb_strip_nulls(jsonb_build_object('kind',kind,'accountId',account_id,
      'categoryId',category_id,'currency',currency,'amountMinor',amount_minor::text,
      'businessDate',to_char(business_date,'YYYY-MM-DD'),'timezone',timezone,
      'occurredAt',CASE WHEN occurred_at IS NULL THEN NULL ELSE to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'note',note)) payload FROM app.manual_movements WHERE user_id=$1 AND id=$2`,
        [userId, movementId],
      )
    ).rows[0];
    if (!row) throw new DomainError('REFERENCE_NOT_FOUND');
    const command = normalizeManual(
      {
        operationId: row.operation_id,
        deviceId: rootId,
        movementId,
        schemaVersion: 1,
        baseVersion: '0',
        payload: row.payload,
      },
      this.clock,
    );
    return { rootId, movementId, version: revision?.version ?? '1', payload: command.payload };
  }
  async execute(userId: string, input: unknown): Promise<CorrectionResult> {
    identifier(userId);
    const command = normalizeCorrection(input, this.clock);
    const hash = createHash('sha256').update(canonical(command)).digest('hex');
    return this.database.asUser(userId, async (c) => {
      await this.lock(c, userId);
      const old = (
        await c.query<{ payload_hash: string; result: CorrectionResult }>(
          'SELECT payload_hash,result FROM app.manual_correction_receipts WHERE user_id=$1 AND operation_id=$2',
          [userId, command.operationId],
        )
      ).rows[0];
      if (old) {
        if (old.payload_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
        return old.result;
      }
      const current = await this.currentIn(c, userId, command.rootId);
      if (command.resolves) {
        const conflict = (
          await c.query<{ root_id: string; outcome: string }>(
            'SELECT root_id,outcome FROM app.manual_correction_receipts WHERE user_id=$1 AND operation_id=$2',
            [userId, command.resolves],
          )
        ).rows[0];
        if (!conflict || conflict.root_id !== command.rootId || conflict.outcome !== 'conflict')
          throw new DomainError('REFERENCE_NOT_FOUND');
        if (
          (
            await c.query(
              "SELECT 1 FROM app.manual_correction_receipts WHERE user_id=$1 AND resolves=$2 AND outcome='applied'",
              [userId, command.resolves],
            )
          ).rowCount
        )
          throw new DomainError('RESOLUTION_CONFLICT');
      }
      const ids =
        command.action === 'replace'
          ? [command.operationId, command.replacement.operationId, command.reversalOperationId]
          : [command.operationId];
      if (
        (
          await c.query(
            `SELECT 1 FROM app.ledger_receipts WHERE user_id=$1 AND operation_id=ANY($2::uuid[])
         UNION ALL SELECT 1 FROM app.manual_correction_receipts WHERE user_id=$1 AND operation_id=ANY($2::uuid[])`,
            [userId, ids],
          )
        ).rowCount
      )
        throw new DomainError('OPERATION_CONFLICT');
      let result: CorrectionResult;
      if (current.version !== command.expectedVersion) {
        result = {
          status: 'conflict',
          operationId: command.operationId,
          payloadHash: hash,
          server: current,
          local: command,
          differentFields:
            command.action === 'replace'
              ? differingMovementFields(command.replacement.payload, current.payload)
              : [],
        };
      } else {
        let server = current;
        if (command.action === 'replace') {
          if (command.replacement.payload.currency !== current.payload.currency)
            throw new DomainError('CURRENCY_MISMATCH');
          // A replacement cannot reuse an existing journal. Both postings and the
          // product revision are committed in the caller-owned transaction.
          const ledger = new LedgerService(new LedgerStore(this.database), this.clock);
          await ledger.executeInTransaction(
            c,
            { userId },
            {
              operationId: command.reversalOperationId,
              deviceId: command.deviceId,
              entityId: command.reversalId,
              schemaVersion: 1,
              baseVersion: '1',
              command: {
                type: 'reverse',
                payload: {
                  originalId: current.movementId,
                  businessDate: command.businessDate,
                  timezone: command.timezone,
                  ...(command.occurredAt ? { occurredAt: command.occurredAt } : {}),
                },
              },
            },
          );
          await new ManualMovementService(this.database, this.clock).confirmInTransaction(
            c,
            { userId },
            command.replacement,
          );
          server = {
            rootId: current.rootId,
            version: (BigInt(current.version) + 1n).toString(),
            movementId: command.replacement.movementId,
            payload: command.replacement.payload,
          };
          await c.query(
            `INSERT INTO app.manual_corrections(user_id,root_id,version,previous_id,replacement_id,reversal_id,operation_id)
             VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [
              userId,
              server.rootId,
              server.version,
              current.movementId,
              server.movementId,
              command.reversalId,
              command.operationId,
            ],
          );
        }
        result = {
          status: 'applied',
          action: command.action,
          operationId: command.operationId,
          payloadHash: hash,
          server,
        };
      }
      await c.query(
        `INSERT INTO app.manual_correction_receipts(user_id,operation_id,root_id,payload_hash,action,outcome,resolves,command,result)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          userId,
          command.operationId,
          command.rootId,
          hash,
          command.action,
          result.status,
          command.resolves ?? null,
          command,
          result,
        ],
      );
      return result;
    });
  }
}
