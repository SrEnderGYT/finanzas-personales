import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError, type CatalogEnvelope } from '@finanzas/domain';
import type { CatalogChange } from './executor';
export async function mutateAccount(
  client: PoolClient,
  userId: string,
  envelope: CatalogEnvelope,
): Promise<CatalogChange[]> {
  const c = envelope.command;
  if (c.type === 'account.create') {
    const p = c.payload,
      technicalId = randomUUID();
    // Both entities share this transaction; the P06 convenience helper opens its own.
    await client.query(
      "INSERT INTO app.ledger_accounts(user_id,id,currency,nature) VALUES($1,$2,$3,'asset')",
      [userId, technicalId, p.currency],
    );
    await client.query(
      'INSERT INTO app.product_accounts(user_id,id,ledger_account_id,name,type,currency,state,position,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        userId,
        c.id,
        technicalId,
        p.name,
        p.type,
        p.currency,
        p.state,
        p.position,
        envelope.operationId,
      ],
    );
    return [{ id: c.id, entity: 'account', version: '1' }];
  }
  if (c.type !== 'account.update') throw new DomainError('INVALID_COMMAND');
  const row = (
    await client.query<{ version: string }>(
      'SELECT version FROM app.product_accounts WHERE user_id=$1 AND id=$2 FOR UPDATE',
      [userId, c.id],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND');
  if (row.version !== envelope.baseVersion) throw new DomainError('VERSION_CONFLICT');
  const p = c.payload;
  const updated = await client.query<{ version: string }>(
    'UPDATE app.product_accounts SET name=coalesce($3,name),type=coalesce($4,type),state=coalesce($5,state),position=coalesce($6,position),version=version+1,operation_id=$7 WHERE user_id=$1 AND id=$2 RETURNING version',
    [
      userId,
      c.id,
      p.name ?? null,
      p.type ?? null,
      p.state ?? null,
      p.position ?? null,
      envelope.operationId,
    ],
  );
  return [{ id: c.id, entity: 'account', version: updated.rows[0]!.version }];
}
