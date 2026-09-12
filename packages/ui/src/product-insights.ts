import type { ManualPayload } from '../../domain/src';

export interface ProductMovementItem {
  id: string;
  payload: ManualPayload;
  state: string;
  account: string;
  category: string;
  failure?: string;
}

export interface ProductMovementFilters {
  query: string;
  currency: 'ALL' | ManualPayload['currency'];
  kind: 'all' | ManualPayload['kind'];
  state: 'all' | 'confirmed' | 'pending' | 'attention';
  from: string;
  to: string;
}

export interface ProductCurrencySummary {
  currency: ManualPayload['currency'];
  incomeMinor: bigint;
  expenseMinor: bigint;
  balanceMinor: bigint;
  confirmedCount: number;
}

export interface ProductSummary {
  currencies: ProductCurrencySummary[];
  confirmedCount: number;
  pendingCount: number;
  attentionCount: number;
}

const PENDING_STATES = new Set(['pending', 'sending', 'retryable']);
const ATTENTION_STATES = new Set(['retryable', 'failed']);

function fold(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es-PE')
    .trim();
}

function validRange(from: string, to: string) {
  return !from || !to || from <= to;
}

export function formatMinorExact(currency: string, minor: bigint) {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(3, '0');
  const whole = digits.slice(0, -2);
  const cents = digits.slice(-2);
  return `${currency} ${negative ? '−' : ''}${whole}.${cents}`;
}

export function filterProductMovements(
  rows: readonly ProductMovementItem[],
  filters: ProductMovementFilters,
) {
  if (!validRange(filters.from, filters.to)) return [];
  const query = fold(filters.query);
  return rows.filter((row) => {
    const p = row.payload;
    if (filters.currency !== 'ALL' && p.currency !== filters.currency) return false;
    if (filters.kind !== 'all' && p.kind !== filters.kind) return false;
    if (filters.from && p.businessDate < filters.from) return false;
    if (filters.to && p.businessDate > filters.to) return false;
    if (filters.state === 'confirmed' && row.state !== 'confirmed') return false;
    if (filters.state === 'pending' && !PENDING_STATES.has(row.state)) return false;
    if (
      filters.state === 'attention' &&
      !ATTENTION_STATES.has(row.state) &&
      row.failure === undefined
    )
      return false;
    if (!query) return true;
    return fold(
      [
        row.account,
        row.category,
        p.note ?? '',
        p.businessDate,
        p.timezone,
        p.currency,
        p.kind === 'expense' ? 'gasto' : 'ingreso',
        formatMinorExact(p.currency, BigInt(p.amountMinor)),
        p.amountMinor,
        row.state,
        row.failure ?? '',
      ].join(' '),
    ).includes(query);
  });
}

export function summarizeProductMovements(rows: readonly ProductMovementItem[]): ProductSummary {
  const currencies = new Map<ManualPayload['currency'], ProductCurrencySummary>();
  let confirmedCount = 0;
  let pendingCount = 0;
  let attentionCount = 0;

  for (const row of rows) {
    if (PENDING_STATES.has(row.state)) pendingCount++;
    if (ATTENTION_STATES.has(row.state) || row.failure !== undefined) attentionCount++;
    if (row.state !== 'confirmed') continue;

    confirmedCount++;
    const p = row.payload;
    const current = currencies.get(p.currency) ?? {
      currency: p.currency,
      incomeMinor: 0n,
      expenseMinor: 0n,
      balanceMinor: 0n,
      confirmedCount: 0,
    };
    const amount = BigInt(p.amountMinor);
    const next = {
      ...current,
      incomeMinor: current.incomeMinor + (p.kind === 'income' ? amount : 0n),
      expenseMinor: current.expenseMinor + (p.kind === 'expense' ? amount : 0n),
      balanceMinor:
        current.balanceMinor + (p.kind === 'income' ? amount : p.kind === 'expense' ? -amount : 0n),
      confirmedCount: current.confirmedCount + 1,
    };
    currencies.set(p.currency, next);
  }

  return {
    currencies: [...currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    confirmedCount,
    pendingCount,
    attentionCount,
  };
}
