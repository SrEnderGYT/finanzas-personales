import type { PoolClient } from 'pg';
import {
  DomainError,
  identifier,
  type Journal,
  type LedgerAccount,
  type Currency,
} from '@finanzas/domain';
import { UserDatabase } from '../database';
export interface LedgerContext {
  userId: string;
}
export class LedgerStore {
  constructor(readonly database: UserDatabase) {}
  async createTechnicalAccount(context: LedgerContext, account: LedgerAccount) {
    identifier(context.userId);
    identifier(account.id);
    await this.database.asUser(context.userId, (c) =>
      c.query('INSERT INTO app.ledger_accounts(user_id,id,currency,nature) VALUES($1,$2,$3,$4)', [
        context.userId,
        account.id,
        account.currency,
        account.nature,
      ]),
    );
  }
  async journal(context: LedgerContext, id: string): Promise<Journal> {
    identifier(id);
    return this.database.asUser(context.userId, (c) => this.load(c, context.userId, id));
  }
  async load(c: PoolClient, userId: string, id: string): Promise<Journal> {
    const row = (
      await c.query<{
        id: string;
        kind: Journal['kind'];
        currency: Currency;
        amount_minor: string;
        business_date: string;
        timezone: string;
        occurred_at: Date | null;
        original_id: string | null;
        reason: string | null;
      }>(
        `SELECT id,kind,currency,amount_minor,to_char(business_date,'YYYY-MM-DD') business_date,timezone,occurred_at,original_id,reason FROM app.ledger_transactions WHERE user_id=$1 AND id=$2 AND sealed`,
        [userId, id],
      )
    ).rows[0];
    if (!row) throw new DomainError('NOT_FOUND');
    const entries = (
      await c.query<{
        accountId: string;
        currency: Currency;
        debitMinor: string;
        creditMinor: string;
      }>(
        'SELECT account_id AS "accountId",currency,debit_minor AS "debitMinor",credit_minor AS "creditMinor" FROM app.ledger_entries WHERE user_id=$1 AND transaction_id=$2 ORDER BY account_id',
        [userId, id],
      )
    ).rows;
    return {
      id: row.id,
      kind: row.kind,
      currency: row.currency,
      amountMinor: row.amount_minor,
      businessDate: row.business_date,
      timezone: row.timezone,
      ...(row.occurred_at ? { occurredAt: row.occurred_at.toISOString() } : {}),
      ...(row.original_id ? { originalId: row.original_id } : {}),
      ...(row.reason ? { reason: row.reason } : {}),
      entries,
    };
  }
  async insert(c: PoolClient, userId: string, j: Journal) {
    await c.query(
      `INSERT INTO app.ledger_transactions(user_id,id,kind,currency,amount_minor,business_date,timezone,occurred_at,original_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        userId,
        j.id,
        j.kind,
        j.currency,
        j.amountMinor,
        j.businessDate,
        j.timezone,
        j.occurredAt ?? null,
        j.originalId ?? null,
        j.reason ?? null,
      ],
    );
    for (const e of j.entries)
      await c.query(
        'INSERT INTO app.ledger_entries(user_id,transaction_id,account_id,currency,debit_minor,credit_minor) VALUES($1,$2,$3,$4,$5,$6)',
        [userId, j.id, e.accountId, e.currency, e.debitMinor, e.creditMinor],
      );
    await c.query('UPDATE app.ledger_transactions SET sealed=true WHERE user_id=$1 AND id=$2', [
      userId,
      j.id,
    ]);
  }
  async balances(context: LedgerContext) {
    return this.database.asUser(
      context.userId,
      async (c) =>
        (
          await c.query<{ accountId: string; currency: Currency; amountMinor: string }>(
            `SELECT a.id AS "accountId",a.currency,coalesce(sum(e.debit_minor::numeric-e.credit_minor::numeric),0)::text AS "amountMinor"
       FROM app.ledger_accounts a LEFT JOIN app.ledger_entries e ON (a.user_id,a.id)=(e.user_id,e.account_id)
       WHERE a.user_id=$1 GROUP BY a.id,a.currency ORDER BY a.id`,
            [context.userId],
          )
        ).rows,
    );
  }
}
