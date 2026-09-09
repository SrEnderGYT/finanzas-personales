import { expect, it } from 'vitest';
import { civil, instant, financialDate, localDate, inPeriod } from '../packages/domain/src';
const clock = { now: () => new Date('2026-09-09T12:00:00Z') };
it('validates dates without silently normalizing calendar errors', () => {
  expect(civil('2024-02-29')).toBe('2024-02-29');
  for (const date of ['2025-02-29', '2026-04-31', '0000-01-01', '2026-1-01'])
    expect(() => civil(date)).toThrow();
  expect(() => instant('2026-09-09T12:00:00')).toThrow();
  expect(() => instant('2026-02-30T12:00:00Z')).toThrow();
});
it('preserves known precision and separates UTC from business date', () => {
  const value = financialDate(
    { businessDate: '2026-09-08', timezone: 'America/Lima', occurredAt: '2026-09-09T02:00:00Z' },
    clock,
  );
  expect(value.businessDate).toBe('2026-09-08');
  expect(
    financialDate({ businessDate: '2026-09-08', timezone: 'America/Lima' }, clock).occurredAt,
  ).toBeUndefined();
  expect(() => financialDate({ ...value, businessDate: '2026-09-09' }, clock)).toThrow(
    'DATE_MISMATCH',
  );
  expect(() =>
    financialDate({ businessDate: '2026-09-10', timezone: 'America/Lima' }, clock),
  ).toThrow('FUTURE_DATE');
});
it('uses explicit zones across DST and half-open month boundaries', () => {
  for (const time of ['2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00'])
    expect(localDate(new Date(instant(time)), 'America/New_York')).toBe('2026-11-01');
  expect(inPeriod('2026-08-31', '2026-08-01', '2026-09-01')).toBe(true);
  expect(inPeriod('2026-09-01', '2026-08-01', '2026-09-01')).toBe(false);
});
