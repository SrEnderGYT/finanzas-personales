import {
  accountTypes,
  closed,
  currency,
  DomainError,
  identifier,
  Money,
  type Currency,
} from '@finanzas/domain';
import { UserDatabase } from '../database';
import { LedgerStore } from '../ledger/store';
export type CatalogEntity = 'account' | 'category';
interface Row {
  id: string;
  name: string;
  state: string;
  position: number;
  version: string;
  createdAt: Date;
  updatedAt: Date;
  currency?: Currency;
  ledgerId?: string;
  type?: string;
  kind?: string;
  origin?: string;
}
export function catalogQuery(entity: CatalogEntity, input: unknown) {
  closed(input, [
    'state',
    'limit',
    'cursor',
    ...(entity === 'account' ? ['type', 'currency'] : ['kind']),
  ]);
  const state = input['state'] ?? 'active';
  if (
    !(
      entity === 'account' ? ['active', 'inactive', 'all'] : ['active', 'archived', 'all']
    ).includes(state as string)
  )
    throw new DomainError('INVALID_FILTER');
  const rawLimit = input['limit'] ?? '50';
  if (typeof rawLimit !== 'string' || !/^[1-9]\d{0,2}$/.test(rawLimit) || Number(rawLimit) > 100)
    throw new DomainError('INVALID_LIMIT');
  const type = input['type'];
  if (type !== undefined && !accountTypes.includes(type as (typeof accountTypes)[number]))
    throw new DomainError('INVALID_FILTER');
  const unit = input['currency'] === undefined ? undefined : currency(input['currency']);
  const kind = input['kind'];
  if (kind !== undefined && kind !== 'expense' && kind !== 'income')
    throw new DomainError('INVALID_FILTER');
  let cursor: { position: number; id: string } | undefined;
  if (input['cursor'] !== undefined) {
    const raw = input['cursor'];
    if (typeof raw !== 'string' || !/^(0|[1-9]\d{0,9}):[0-9a-f-]{36}$/.test(raw))
      throw new DomainError('INVALID_CURSOR');
    const [p, id] = raw.split(':');
    const position = Number(p);
    if (position > 2147483647) throw new DomainError('INVALID_CURSOR');
    cursor = { position, id: identifier(id!) };
  }
  return { state, limit: Number(rawLimit), type, currency: unit, kind, cursor };
}
export class CatalogRead {
  constructor(readonly database: UserDatabase) {}
  async get(userId: string, entity: CatalogEntity, id: string) {
    identifier(id);
    const rows = await this.rows(userId, entity, {}, id);
    if (!rows.length) throw new DomainError('NOT_FOUND');
    return (await this.present(userId, entity, rows))[0]!;
  }
  async list(userId: string, entity: CatalogEntity, input: unknown) {
    const query = catalogQuery(entity, input);
    const rows = await this.rows(userId, entity, input);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit),
      last = page.at(-1);
    return {
      items: await this.present(userId, entity, page),
      nextCursor: hasMore && last ? `${last.position}:${last.id}` : null,
    };
  }
  private async rows(
    userId: string,
    entity: CatalogEntity,
    input: unknown,
    id?: string,
  ): Promise<Row[]> {
    identifier(userId);
    const q = catalogQuery(entity, input),
      params: unknown[] = [userId],
      where = ['user_id=$1'];
    const add = (expression: string, value: unknown) => {
      params.push(value);
      where.push(expression.replace('?', `$${params.length}`));
    };
    if (id) add('id=?', id);
    else {
      if (q.state !== 'all') add('state=?', q.state);
      if (q.type !== undefined) add('type=?', q.type);
      if (q.currency !== undefined) add('currency=?', q.currency);
      if (q.kind !== undefined) add('kind=?', q.kind);
      if (q.cursor) {
        params.push(q.cursor.position, q.cursor.id);
        where.push(`(position,id)>($${params.length - 1}::integer,$${params.length}::uuid)`);
      }
    }
    params.push(id ? 1 : q.limit + 1);
    const table = entity === 'account' ? 'product_accounts' : 'categories';
    const extra =
      entity === 'account'
        ? 'type,currency,ledger_account_id AS "ledgerId"'
        : "kind,CASE WHEN template_key IS NULL THEN 'custom' ELSE 'system' END AS origin";
    return this.database.asUser(
      userId,
      async (c) =>
        (
          await c.query<Row>(
            `SELECT id,name,state,position,version,created_at AS "createdAt",updated_at AS "updatedAt",${extra} FROM app.${table} WHERE ${where.join(' AND ')} ORDER BY position,id LIMIT $${params.length}`,
            params,
          )
        ).rows,
    );
  }
  private async present(userId: string, entity: CatalogEntity, rows: Row[]) {
    const balances =
      entity === 'account' && rows.length
        ? new Map(
            (await new LedgerStore(this.database).balances({ userId })).map((b) => [
              b.accountId,
              b,
            ]),
          )
        : new Map();
    return rows.map((row) => {
      const { ledgerId, ...dto } = row;
      if (entity !== 'account') return dto;
      const balance = balances.get(ledgerId!);
      if (!balance) throw new DomainError('BALANCE_UNAVAILABLE');
      try {
        return { ...dto, balance: Money.fromJSON(balance).toJSON() };
      } catch {
        throw new DomainError('BALANCE_OUT_OF_RANGE');
      }
    });
  }
}
