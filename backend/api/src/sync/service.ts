import { closed, DomainError, identifier } from '@finanzas/domain';
import { UserDatabase } from '../database';
import { ManualMovementService } from '../manual/service';
export class SyncService {
  constructor(readonly database: UserDatabase) {}
  async execute(userId: string, command: unknown) {
    return new ManualMovementService(this.database).confirmWithStatus({ userId }, command);
  }
  async changes(userId: string, query: unknown) {
    identifier(userId);
    closed(query, ['cursor', 'limit']);
    const rawLimit = query['limit'] ?? '200';
    if (typeof rawLimit !== 'string' || !/^[1-9]\d{0,2}$/.test(rawLimit) || Number(rawLimit) > 200)
      throw new DomainError('INVALID_LIMIT');
    const limit = Number(rawLimit);
    let cursor: [string, string] | undefined;
    if (query['cursor'] !== undefined) {
      const raw = query['cursor'];
      if (typeof raw !== 'string' || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw))
        throw new DomainError('INVALID_CURSOR');
      try {
        const decoded: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
        if (
          !Array.isArray(decoded) ||
          decoded.length !== 2 ||
          typeof decoded[0] !== 'string' ||
          typeof decoded[1] !== 'string' ||
          !/^(0|[1-9]\d{0,18})$/.test(decoded[1])
        )
          throw new Error();
        cursor = [identifier(decoded[0]), decoded[1]];
      } catch {
        throw new DomainError('INVALID_CURSOR');
      }
    }
    return this.database.asUser(userId, async (c) => {
      await c.query(
        'INSERT INTO app.sync_heads(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING',
        [userId],
      );
      const head = (
        await c.query<{ generation: string; last_sequence: string }>(
          'SELECT generation,last_sequence FROM app.sync_heads WHERE user_id=$1',
          [userId],
        )
      ).rows[0]!;
      if (cursor && cursor[0] !== head.generation) throw new DomainError('CURSOR_FORBIDDEN');
      const after = cursor?.[1] ?? '0';
      if (BigInt(after) > BigInt(head.last_sequence)) throw new DomainError('INVALID_CURSOR');
      const rows = (
        await c.query<{
          sequence: string;
          movement: unknown;
          receipt: unknown;
          revision: unknown | null;
        }>(
          `SELECT s.sequence,
       jsonb_build_object('id',m.id,'operationId',m.operation_id,'kind',m.kind,'accountId',m.account_id,'categoryId',m.category_id,'currency',m.currency,'amountMinor',m.amount_minor::text,'businessDate',to_char(m.business_date,'YYYY-MM-DD'),'timezone',m.timezone,'occurredAt',CASE WHEN m.occurred_at IS NULL THEN NULL ELSE to_char(m.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,'note',m.note) AS movement,
       jsonb_build_object('operationId',r.operation_id,'movementId',r.movement_id,'payloadHash',r.payload_hash,'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS receipt,
       CASE WHEN x.root_id IS NULL THEN NULL ELSE jsonb_build_object('rootId',x.root_id,'version',x.version::text,'previousId',x.previous_id,'reversalId',x.reversal_id) END AS revision
       FROM app.sync_changes s JOIN app.manual_movements m ON (m.user_id,m.id)=(s.user_id,s.movement_id)
       JOIN app.manual_receipts r ON (r.user_id,r.operation_id)=(s.user_id,s.operation_id)
       LEFT JOIN app.manual_corrections x ON (x.user_id,x.replacement_id)=(m.user_id,m.id)
       WHERE s.user_id=$1 AND s.sequence>$2 AND s.sequence<=$3 ORDER BY s.sequence LIMIT $4`,
          [userId, after, head.last_sequence, limit + 1],
        )
      ).rows;
      const changes = rows.slice(0, limit).map(({ revision, ...row }) => ({
        ...row,
        ...(revision ? { revision } : {}),
      }));
      const sequence = changes.at(-1)?.sequence ?? after;
      return {
        changes,
        nextCursor: Buffer.from(JSON.stringify([head.generation, sequence])).toString('base64url'),
        hasMore: rows.length > limit,
        cursorGeneration: head.generation,
      };
    });
  }
}
