import { describe, it, expect } from 'vitest';
import {
  DEMO_TRANSACTIONS,
  rangeDates,
  filterDemo,
  demoTotals,
  parseDemoAmount,
  formatMinor,
} from '../packages/shared/src/demo';
describe('DEMO periods and currency boundary', () => {
  it('keeps USD separate and does not count card payment as another expense', () => {
    const rows = filterDemo(DEMO_TRANSACTIONS, 'PEN', rangeDates('Este mes'));
    expect(demoTotals(rows)).toEqual({ income: 620000n, expense: 38600n, balance: 581400n });
    expect(() => demoTotals(DEMO_TRANSACTIONS)).toThrow();
  });
  it('validates calendar and custom ranges', () => {
    expect(rangeDates('7 días')).toEqual(['2026-08-31', '2026-09-06']);
    expect(rangeDates('Mes anterior')).toEqual(['2026-08-01', '2026-08-31']);
    expect(() => rangeDates('Personalizado', '2026-02-30', '2026-03-03')).toThrow();
    expect(() => rangeDates('Personalizado', '2026-09-06', '2026-09-01')).toThrow();
  });
  it('formats without floating point and validates demo input', () => {
    expect(parseDemoAmount('0,10')).toBe('10');
    expect(
      formatMinor(BigInt(parseDemoAmount('0.10')) + BigInt(parseDemoAmount('0.20')), 'PEN'),
    ).toBe('S/ 0.30');
    expect(() => parseDemoAmount('1.234')).toThrow();
    expect(() => parseDemoAmount('-1')).toThrow();
  });
});
