import { describe, expect, it } from 'vitest';
import type { ManualPayload } from '../packages/domain/src';
import {
  filterProductMovements,
  formatMinorExact,
  summarizeProductMovements,
  type ProductMovementItem,
} from '../packages/ui/src/product-insights';

function payload(
  amountMinor: string,
  kind: 'expense' | 'income' = 'expense',
  currency: 'PEN' | 'USD' = 'PEN',
  overrides: Partial<ManualPayload> = {},
): ManualPayload {
  return {
    kind,
    accountId: '10000000-0000-4000-8000-000000000001',
    categoryId: '10000000-0000-4000-8000-000000000002',
    currency,
    amountMinor,
    businessDate: '2026-09-11',
    timezone: 'America/Lima',
    note: 'Mercado',
    ...overrides,
  };
}

function row(
  id: string,
  p: ManualPayload,
  state = 'confirmed',
  overrides: Partial<ProductMovementItem> = {},
): ProductMovementItem {
  return {
    id,
    payload: p,
    state,
    account: 'Cuenta diaria',
    category: p.kind === 'expense' ? 'Alimentación' : 'Ingresos',
    ...overrides,
  };
}

describe('product insights', () => {
  it('sums confirmed money exactly and never mixes currencies', () => {
    const summary = summarizeProductMovements([
      row('a', payload('10')),
      row('b', payload('20')),
      row('c', payload('100', 'income')),
      row('d', payload('250', 'expense', 'USD')),
      row('e', payload('9999'), 'pending'),
    ]);

    expect(summary.confirmedCount).toBe(4);
    expect(summary.pendingCount).toBe(1);
    expect(summary.attentionCount).toBe(0);
    expect(summary.currencies).toEqual([
      {
        currency: 'PEN',
        incomeMinor: 100n,
        expenseMinor: 30n,
        balanceMinor: 70n,
        confirmedCount: 3,
      },
      {
        currency: 'USD',
        incomeMinor: 0n,
        expenseMinor: 250n,
        balanceMinor: -250n,
        confirmedCount: 1,
      },
    ]);
    expect(formatMinorExact('PEN', 30n)).toBe('PEN 0.30');
    expect(formatMinorExact('USD', -250n)).toBe('USD −2.50');
  });

  it('keeps pending and failed movements visible without counting them as confirmed totals', () => {
    const summary = summarizeProductMovements([
      row('a', payload('100'), 'pending'),
      row('b', payload('200'), 'sending'),
      row('c', payload('300'), 'retryable'),
      row('d', payload('400'), 'failed', { failure: '422 INVALID' }),
    ]);

    expect(summary.confirmedCount).toBe(0);
    expect(summary.pendingCount).toBe(3);
    expect(summary.attentionCount).toBe(2);
    expect(summary.currencies).toEqual([]);
  });

  it('filters by date, currency, kind, state and normalized text', () => {
    const rows = [
      row('a', payload('1234', 'expense', 'PEN', { businessDate: '2026-09-10' }), 'confirmed', {
        account: 'Ahorros Perú',
        category: 'Alimentación',
      }),
      row('b', payload('5000', 'income', 'USD', { businessDate: '2026-09-11', note: 'Freelance' })),
      row('c', payload('700', 'expense', 'PEN', { businessDate: '2026-09-12' }), 'retryable'),
    ];

    expect(
      filterProductMovements(rows, {
        query: 'alimentacion',
        currency: 'PEN',
        kind: 'expense',
        state: 'confirmed',
        from: '2026-09-01',
        to: '2026-09-11',
      }).map((item) => item.id),
    ).toEqual(['a']);

    expect(
      filterProductMovements(rows, {
        query: 'usd 50.00',
        currency: 'ALL',
        kind: 'all',
        state: 'all',
        from: '',
        to: '',
      }).map((item) => item.id),
    ).toEqual(['b']);

    expect(
      filterProductMovements(rows, {
        query: '',
        currency: 'ALL',
        kind: 'all',
        state: 'attention',
        from: '',
        to: '',
      }).map((item) => item.id),
    ).toEqual(['c']);
  });

  it('fails closed for an inverted financial date range', () => {
    const rows = [row('a', payload('100'))];
    expect(
      filterProductMovements(rows, {
        query: '',
        currency: 'ALL',
        kind: 'all',
        state: 'all',
        from: '2026-09-12',
        to: '2026-09-01',
      }),
    ).toEqual([]);
  });
});
