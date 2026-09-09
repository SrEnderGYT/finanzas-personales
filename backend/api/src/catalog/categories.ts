import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError, type CatalogEnvelope } from '@finanzas/domain';
import type { CatalogChange } from './executor';
export async function mutateCategory(
  client: PoolClient,
  userId: string,
  envelope: CatalogEnvelope,
): Promise<CatalogChange[]> {
  const c = envelope.command;
  if (c.type === 'category.initialize') {
    const templates = (
      await client.query<{ key: string; name: string; kind: string; position: number }>(
        'SELECT t.* FROM app.category_templates t WHERE NOT EXISTS(SELECT 1 FROM app.categories c WHERE c.user_id=$1 AND c.template_key=t.key) ORDER BY t.position,t.key',
        [userId],
      )
    ).rows;
    const changes: CatalogChange[] = [];
    for (const t of templates) {
      const id = randomUUID();
      await client.query(
        "INSERT INTO app.categories(user_id,id,name,kind,template_key,state,position,operation_id) VALUES($1,$2,$3,$4,$5,'active',$6,$7)",
        [userId, id, t.name, t.kind, t.key, t.position, envelope.operationId],
      );
      changes.push({ id, entity: 'category', version: '1' });
    }
    return changes;
  }
  if (c.type === 'category.create') {
    const p = c.payload;
    await client.query(
      'INSERT INTO app.categories(user_id,id,name,kind,state,position,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [userId, c.id, p.name, p.kind, p.state, p.position, envelope.operationId],
    );
    return [{ id: c.id, entity: 'category', version: '1' }];
  }
  if (c.type !== 'category.update') throw new DomainError('INVALID_COMMAND');
  const row = (
    await client.query<{ version: string }>(
      'SELECT version FROM app.categories WHERE user_id=$1 AND id=$2 FOR UPDATE',
      [userId, c.id],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND');
  if (row.version !== envelope.baseVersion) throw new DomainError('VERSION_CONFLICT');
  const p = c.payload;
  const updated = await client.query<{ version: string }>(
    'UPDATE app.categories SET name=coalesce($3,name),state=coalesce($4,state),position=coalesce($5,position),version=version+1,operation_id=$6 WHERE user_id=$1 AND id=$2 RETURNING version',
    [userId, c.id, p.name ?? null, p.state ?? null, p.position ?? null, envelope.operationId],
  );
  return [{ id: c.id, entity: 'category', version: updated.rows[0]!.version }];
}
