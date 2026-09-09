import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  post,
  reverse,
  balances,
  normalizeEnvelope,
  canonical,
  type LedgerAccount,
  type Posting,
  type Envelope,
} from '../packages/domain/src';
const clock = { now: () => new Date('2026-09-09T12:00:00Z') };
const date = { businessDate: '2026-08-01', timezone: 'America/Lima' };
const accounts: LedgerAccount[] = [
  'asset',
  'asset',
  'liability',
  'expense',
  'income',
  'equity',
].map((nature) => ({
  id: randomUUID(),
  currency: 'PEN',
  nature: nature as LedgerAccount['nature'],
}));
const id = (i: number) => accounts[i]!.id;
const payload = (kind: Posting['kind'], d: number, c: number): Posting =>
  ({
    ...date,
    kind,
    currency: 'PEN',
    amountMinor: '10000',
    debitAccountId: id(d),
    creditAccountId: id(c),
    ...(kind === 'adjustment' ? { reason: 'Synthetic opening' } : {}),
    ...(kind === 'refund' ? { originalId: randomUUID() } : {}),
  }) as Posting;
it('posts every financial kind and counts card expense only once', () => {
  const journals = [
    post(randomUUID(), payload('expense', 3, 2), accounts, clock),
    post(randomUUID(), payload('payment', 2, 0), accounts, clock),
  ];
  expect(balances(journals).get(id(3))!.minorUnits).toBe(10000n);
  expect(balances(journals).get(id(2))!.minorUnits).toBe(0n);
  for (const p of [
    payload('income', 0, 4),
    payload('transfer', 1, 0),
    payload('refund', 2, 3),
    payload('adjustment', 0, 5),
    payload('adjustment', 5, 2),
  ]) {
    const j = post(randomUUID(), p, accounts, clock);
    expect(
      j.entries.reduce((sum, e) => sum + BigInt(e.debitMinor) - BigInt(e.creditMinor), 0n),
    ).toBe(0n);
  }
  expect(() => post(randomUUID(), payload('payment', 3, 0), accounts, clock)).toThrow(
    'INVALID_POSTING',
  );
  expect(() =>
    post(randomUUID(), { ...payload('transfer', 1, 0), currency: 'USD' }, accounts, clock),
  ).toThrow('CURRENCY_MISMATCH');
});
it('reverses exactly and keeps refunds in their effective period', () => {
  const purchase = post(randomUUID(), payload('expense', 3, 2), accounts, clock);
  const undo = reverse(randomUUID(), purchase, { ...date, businessDate: '2026-09-01' }, clock);
  expect([...balances([purchase, undo]).values()].every((m) => m.minorUnits === 0n)).toBe(true);
  expect(() => reverse(randomUUID(), undo, date, clock)).toThrow('REVERSE_REVERSAL');
  expect(
    post(randomUUID(), { ...payload('refund', 0, 3), businessDate: '2026-09-02' }, accounts, clock)
      .businessDate,
  ).toBe('2026-09-02');
});
it('serializes versioned offline commands and canonicalizes key order', () => {
  const command: Envelope = {
    operationId: randomUUID(),
    deviceId: randomUUID(),
    schemaVersion: 1,
    entityId: randomUUID(),
    baseVersion: '0',
    command: { type: 'post', payload: payload('expense', 3, 0) },
  };
  expect(normalizeEnvelope(JSON.parse(JSON.stringify(command)), clock)).toEqual(command);
  expect(canonical({ b: '2', a: '1' })).toBe(canonical({ a: '1', b: '2' }));
  expect(() =>
    normalizeEnvelope({ ...command, userId: randomUUID() } as Envelope, clock),
  ).toThrow();
});
