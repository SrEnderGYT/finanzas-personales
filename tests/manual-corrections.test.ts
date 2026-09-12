import { it, expect } from 'vitest';
import {
  normalizeCorrection,
  differingMovementFields,
  Money,
  canonical,
} from '../packages/domain/src';
const clock = { now: () => new Date('2026-09-10T12:00:00Z') };
function fixture() {
  const deviceId = crypto.randomUUID();
  return {
    operationId: crypto.randomUUID(),
    deviceId,
    schemaVersion: 1,
    rootId: crypto.randomUUID(),
    expectedVersion: '1',
    reason: '  Synthetic correction  ',
    action: 'replace',
    reversalId: crypto.randomUUID(),
    reversalOperationId: crypto.randomUUID(),
    businessDate: '2026-09-09',
    timezone: 'America/Lima',
    replacement: {
      operationId: crypto.randomUUID(),
      deviceId,
      movementId: crypto.randomUUID(),
      schemaVersion: 1,
      baseVersion: '0',
      payload: {
        kind: 'expense',
        accountId: crypto.randomUUID(),
        categoryId: crypto.randomUUID(),
        amountMinor: '30',
        currency: 'PEN',
        businessDate: '2026-09-08',
        timezone: 'America/Lima',
      },
    },
  };
}
it('normalizes exact corrections and serializes stable ids, financial dates and explicit decision', () => {
  const normalized = normalizeCorrection(fixture(), clock);
  expect(normalized.reason).toBe('Synthetic correction');
  expect(normalizeCorrection(JSON.parse(canonical(normalized)), clock)).toEqual(normalized);
  if (normalized.action !== 'replace') throw new Error();
  expect(Money.fromJSON(normalized.replacement.payload).minorUnits).toBe(30n);
  expect(normalized.businessDate).toBe('2026-09-09');
  expect(normalized.replacement.payload.businessDate).toBe('2026-09-08');
});
it('requires version, reason, separate posting identifiers and explicit reversal date/timezone', () => {
  const f = fixture();
  for (const input of [
    { ...f, expectedVersion: '0' },
    { ...f, expectedVersion: 1 },
    { ...f, reason: '' },
    { ...f, businessDate: undefined },
    { ...f, timezone: undefined },
    { ...f, reversalId: f.rootId },
    { ...f, reversalOperationId: f.operationId },
    { ...f, replacement: { ...f.replacement, deviceId: crypto.randomUUID() } },
    { ...f, user_id: crypto.randomUUID() },
    {
      ...f,
      replacement: { ...f.replacement, payload: { ...f.replacement.payload, amountMinor: 0.3 } },
    },
  ])
    expect(() => normalizeCorrection(input, clock)).toThrow();
});
it('keep-server requires a conflict reference and cannot carry hidden financial changes', () => {
  const f = fixture();
  const keep = {
    operationId: f.operationId,
    deviceId: f.deviceId,
    schemaVersion: 1,
    rootId: f.rootId,
    expectedVersion: '2',
    reason: 'Synthetic review',
    action: 'keep_server',
    resolves: crypto.randomUUID(),
  };
  expect(normalizeCorrection(keep, clock)).toEqual(keep);
  expect(() => normalizeCorrection({ ...keep, resolves: undefined }, clock)).toThrow();
  expect(() => normalizeCorrection({ ...keep, resolves: keep.operationId }, clock)).toThrow();
  expect(() => normalizeCorrection({ ...keep, replacement: f.replacement }, clock)).toThrow();
});
it('differences report exact monetary and temporal fields without recalculating ledger rules', () => {
  const f = normalizeCorrection(fixture(), clock);
  if (f.action !== 'replace') throw new Error();
  const p = f.replacement.payload;
  expect(
    differingMovementFields(p, { ...p, amountMinor: '31', businessDate: '2026-09-07' }),
  ).toEqual(['amountMinor', 'businessDate']);
  expect(differingMovementFields(p, { ...p })).toEqual([]);
});
