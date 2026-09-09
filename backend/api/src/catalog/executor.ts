import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  canonical,
  DomainError,
  identifier,
  normalizeCatalog,
  type CatalogEnvelope,
} from '@finanzas/domain';
import { UserDatabase } from '../database';
export interface CatalogChange {
  id: string;
  entity: 'account' | 'category';
  version: string;
}
export interface CatalogResult {
  status: 'applied' | 'alreadyApplied';
  result: { changes: CatalogChange[] };
}
export class CatalogExecutor {
  constructor(readonly database: UserDatabase) {}
  async execute(
    userId: string,
    input: unknown,
    mutate: (client: PoolClient, envelope: CatalogEnvelope) => Promise<CatalogChange[]>,
  ): Promise<CatalogResult> {
    identifier(userId);
    const envelope = normalizeCatalog(input);
    const hash = createHash('sha256').update(canonical(envelope)).digest('hex');
    try {
      return await this.database.asUser(userId, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('catalog:'||$1,0))", [
          userId,
        ]);
        const receipt = (
          await client.query<{ payload_hash: string; result: CatalogResult['result'] }>(
            'SELECT payload_hash,result FROM app.catalog_receipts WHERE user_id=$1 AND operation_id=$2',
            [userId, envelope.operationId],
          )
        ).rows[0];
        if (receipt) {
          if (receipt.payload_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
          return { status: 'alreadyApplied', result: receipt.result };
        }
        const result = { changes: await mutate(client, envelope) };
        await client.query(
          'INSERT INTO app.catalog_receipts(user_id,operation_id,schema_version,payload_hash,result) VALUES($1,$2,1,$3,$4)',
          [userId, envelope.operationId, hash, result],
        );
        await client.query(
          "INSERT INTO app.catalog_audit(user_id,operation_id,action,outcome) VALUES($1,$2,$3,'applied')",
          [userId, envelope.operationId, envelope.command.type],
        );
        for (const change of result.changes)
          await client.query(
            'INSERT INTO app.catalog_audit_entities(user_id,operation_id,id,account_id,category_id) VALUES($1,$2,$3,$4,$5)',
            [
              userId,
              envelope.operationId,
              randomUUID(),
              change.entity === 'account' ? change.id : null,
              change.entity === 'category' ? change.id : null,
            ],
          );
        return { status: 'applied', result };
      });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      const code = (error as { code?: string })?.code;
      if (code === '23505') throw new DomainError('ENTITY_CONFLICT');
      if (['23503', '23514', '42501', '22003'].includes(code ?? ''))
        throw new DomainError('CATALOG_CONSTRAINT');
      throw error;
    }
  }
}
