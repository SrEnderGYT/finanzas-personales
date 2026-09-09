import { Money, DomainError, type Currency } from '../money';
import { financialDate, type FinancialDate, type Clock } from '../dates';
export type Nature = 'asset' | 'liability' | 'expense' | 'income' | 'equity';
export interface LedgerAccount {
  id: string;
  currency: Currency;
  nature: Nature;
}
export type Kind = 'expense' | 'income' | 'transfer' | 'payment' | 'refund' | 'adjustment';
interface BasePosting extends FinancialDate {
  currency: Currency;
  amountMinor: string;
  debitAccountId: string;
  creditAccountId: string;
}
export type Posting = BasePosting &
  (
    | { kind: 'expense' | 'income' | 'transfer' | 'payment' }
    | { kind: 'refund'; originalId: string }
    | { kind: 'adjustment'; reason: string }
  );
export interface Entry {
  accountId: string;
  currency: Currency;
  debitMinor: string;
  creditMinor: string;
}
export interface Journal extends FinancialDate {
  id: string;
  kind: Kind | 'reversal';
  currency: Currency;
  amountMinor: string;
  originalId?: string;
  reason?: string;
  entries: readonly Entry[];
}
export interface Envelope {
  operationId: string;
  deviceId: string;
  schemaVersion: 1;
  entityId: string;
  baseVersion: string;
  command:
    | { type: 'post'; payload: Posting }
    | { type: 'reverse'; payload: FinancialDate & { originalId: string } }
    | {
        type: 'correct';
        payload: FinancialDate & { originalId: string; reversalId: string; replacement: Posting };
      };
}
export const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function identifier(value: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new DomainError('INVALID_ID');
  return value;
}
export function closed(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new DomainError('INVALID_COMMAND');
}
const dateKeys = ['businessDate', 'timezone', 'occurredAt'];
export function normalizePosting(value: Posting, clock: Clock): Posting {
  closed(value, [
    ...dateKeys,
    'kind',
    'currency',
    'amountMinor',
    'debitAccountId',
    'creditAccountId',
    ...(value.kind === 'refund' ? ['originalId'] : value.kind === 'adjustment' ? ['reason'] : []),
  ]);
  if (!['expense', 'income', 'transfer', 'payment', 'refund', 'adjustment'].includes(value.kind))
    throw new DomainError('INVALID_KIND');
  const money = Money.fromJSON(value);
  if (money.minorUnits <= 0n) throw new DomainError('POSITIVE_AMOUNT_REQUIRED');
  identifier(value.debitAccountId);
  identifier(value.creditAccountId);
  if (value.debitAccountId === value.creditAccountId) throw new DomainError('SAME_ACCOUNT');
  if (value.kind === 'refund') identifier(value.originalId);
  if (
    value.kind === 'adjustment' &&
    (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 240)
  )
    throw new DomainError('ADJUSTMENT_REASON');
  return { ...value, ...financialDate(value, clock) };
}
export function normalizeEnvelope(value: Envelope, clock: Clock): Envelope {
  closed(value, ['operationId', 'deviceId', 'schemaVersion', 'entityId', 'baseVersion', 'command']);
  for (const id of [value.operationId, value.deviceId, value.entityId]) identifier(id);
  if (
    value.schemaVersion !== 1 ||
    typeof value.baseVersion !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(value.baseVersion)
  )
    throw new DomainError('INVALID_VERSION');
  closed(value.command, ['type', 'payload']);
  const command = value.command;
  if (command.type === 'post')
    return {
      ...value,
      command: { type: 'post', payload: normalizePosting(command.payload, clock) },
    };
  if (command.type !== 'reverse' && command.type !== 'correct')
    throw new DomainError('INVALID_COMMAND');
  closed(command.payload, [
    ...dateKeys,
    'originalId',
    ...(command.type === 'correct' ? ['reversalId', 'replacement'] : []),
  ]);
  identifier(command.payload.originalId);
  const date = financialDate(command.payload, clock);
  if (command.type === 'reverse')
    return { ...value, command: { type: 'reverse', payload: { ...command.payload, ...date } } };
  identifier(command.payload.reversalId);
  return {
    ...value,
    command: {
      type: 'correct',
      payload: {
        ...command.payload,
        ...date,
        replacement: normalizePosting(command.payload.replacement, clock),
      },
    },
  };
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key]))
      .join(',') +
    '}'
  );
}
export function post(
  id: string,
  payload: Posting,
  accounts: readonly LedgerAccount[],
  clock: Clock,
): Journal {
  identifier(id);
  const p = normalizePosting(payload, clock);
  const debit = accounts.find((a) => a.id === p.debitAccountId);
  const credit = accounts.find((a) => a.id === p.creditAccountId);
  if (!debit || !credit) throw new DomainError('ACCOUNT_NOT_FOUND');
  if (debit.currency !== p.currency || credit.currency !== p.currency)
    throw new DomainError('CURRENCY_MISMATCH');
  const d = debit.nature,
    c = credit.nature;
  const allowed = {
    expense: d === 'expense' && ['asset', 'liability'].includes(c),
    income: d === 'asset' && c === 'income',
    transfer: d === 'asset' && c === 'asset',
    payment: d === 'liability' && c === 'asset',
    refund: ['asset', 'liability'].includes(d) && c === 'expense',
    adjustment:
      (['asset', 'liability'].includes(d) && c === 'equity') ||
      (d === 'equity' && ['asset', 'liability'].includes(c)),
  };
  if (!allowed[p.kind]) throw new DomainError('INVALID_POSTING');
  return {
    id,
    kind: p.kind,
    currency: p.currency,
    amountMinor: p.amountMinor,
    ...financialDate(p, clock),
    ...(p.kind === 'refund' ? { originalId: p.originalId } : {}),
    ...(p.kind === 'adjustment' ? { reason: p.reason } : {}),
    entries: [
      { accountId: debit.id, currency: p.currency, debitMinor: p.amountMinor, creditMinor: '0' },
      { accountId: credit.id, currency: p.currency, debitMinor: '0', creditMinor: p.amountMinor },
    ],
  };
}
export function reverse(id: string, original: Journal, date: FinancialDate, clock: Clock): Journal {
  identifier(id);
  if (original.kind === 'reversal') throw new DomainError('REVERSE_REVERSAL');
  const normalized = financialDate(date, clock);
  if (normalized.businessDate < original.businessDate) throw new DomainError('BEFORE_ORIGINAL');
  return {
    id,
    kind: 'reversal',
    currency: original.currency,
    amountMinor: original.amountMinor,
    originalId: original.id,
    ...normalized,
    entries: original.entries.map((e) => ({
      ...e,
      debitMinor: e.creditMinor,
      creditMinor: e.debitMinor,
    })),
  };
}
/** Signed debit balance; credit-normal presentation belongs to the account adapter. */
export function balances(journals: readonly Journal[]): ReadonlyMap<string, Money> {
  const result = new Map<string, Money>();
  for (const j of journals)
    for (const e of j.entries) {
      const amount = Money.minor(BigInt(e.debitMinor) - BigInt(e.creditMinor), e.currency);
      result.set(e.accountId, (result.get(e.accountId) ?? Money.minor(0n, e.currency)).add(amount));
    }
  return result;
}
