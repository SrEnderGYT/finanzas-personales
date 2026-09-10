import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  canonical,
  manualAmount,
  normalizeManual,
  validateManualReferences,
} from '../packages/domain/src';
const clock = { now: () => new Date('2026-09-09T12:00:00Z') };
export const manualFixture = () => ({
  operationId: randomUUID(),
  deviceId: randomUUID(),
  movementId: randomUUID(),
  schemaVersion: 1,
  baseVersion: '0',
  payload: {
    kind: 'expense',
    accountId: randomUUID(),
    categoryId: randomUUID(),
    currency: 'PEN',
    amountMinor: '10',
    businessDate: '2026-09-08',
    timezone: 'America/Lima',
  },
});
it('requires financial day and zone and preserves exact money through JSON', () => {
  const input = manualFixture(),
    normalized = normalizeManual(input, clock);
  expect(manualAmount('0,10', 'PEN').add(manualAmount('0.20', 'PEN')).toJSON().amountMinor).toBe(
    '30',
  );
  expect(canonical(normalizeManual(JSON.parse(JSON.stringify(normalized)), clock))).toBe(
    canonical(normalized),
  );
  for (const field of ['businessDate', 'timezone']) {
    const p = { ...input.payload } as Record<string, unknown>;
    delete p[field];
    expect(() => normalizeManual({ ...input, payload: p }, clock)).toThrow(
      'REQUIRED_FINANCIAL_DATE',
    );
  }
  for (const change of [
    { businessDate: '2026-02-30' },
    { timezone: '' },
    { occurredAt: '2026-09-08T01:00:00Z' },
    { note: '\u0000' },
    { amountMinor: '1.2' },
    { kind: 'transfer' },
  ])
    expect(() =>
      normalizeManual({ ...input, payload: { ...input.payload, ...change } }, clock),
    ).toThrow();
  for (const text of ['1,000.00', '1e2', '0', '-1', '0.001'])
    expect(() => manualAmount(text, 'PEN')).toThrow();
});
it('validates product references without creating financial rules', () => {
  const command = normalizeManual(manualFixture(), clock);
  const catalog = {
    accounts: [
      {
        id: command.payload.accountId,
        name: 'DEMO',
        currency: 'PEN' as const,
        state: 'active' as const,
      },
    ],
    categories: [
      {
        id: command.payload.categoryId,
        name: 'DEMO',
        kind: 'expense' as const,
        state: 'active' as const,
      },
    ],
    downloadedAt: clock.now().toISOString(),
  };
  expect(() => validateManualReferences(command, catalog)).not.toThrow();
  expect(() => validateManualReferences(command, { ...catalog, accounts: [] })).toThrow(
    'REFERENCE_NOT_FOUND',
  );
  expect(() =>
    validateManualReferences(
      { ...command, payload: { ...command.payload, currency: 'USD' } },
      catalog,
    ),
  ).toThrow('CURRENCY_MISMATCH');
  expect(() =>
    validateManualReferences(
      { ...command, payload: { ...command.payload, kind: 'income' } },
      catalog,
    ),
  ).toThrow('CATEGORY_MISMATCH');
});
