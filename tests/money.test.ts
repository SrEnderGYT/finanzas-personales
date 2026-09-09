import { expect, it } from 'vitest';
import { Money, MAX_MINOR } from '../packages/domain/src';
it('keeps cents and JSON exact beyond Number precision', () => {
  expect(Money.decimal('0.10', 'PEN').add(Money.decimal('0.20', 'PEN')).minorUnits).toBe(30n);
  const money = Money.minor(MAX_MINOR, 'USD');
  expect(Money.fromJSON(JSON.parse(JSON.stringify(money)))).toEqual(money);
  expect(() => money.add(Money.minor(1n, 'USD'))).toThrow('MONEY_RANGE');
  expect(() => Money.minor(-MAX_MINOR - 1n, 'PEN')).toThrow();
  expect(() => money.compare(Money.minor(1n, 'PEN'))).toThrow('CURRENCY_MISMATCH');
});
it('rejects noncanonical decimal inputs without rounding', () => {
  for (const value of ['1.001', '1e3', '1,00', ' 1', '01', 'NaN', 'Infinity', '+1', 'S/1'])
    expect(() => Money.decimal(value, 'PEN')).toThrow();
  expect(Money.decimal('-0.01', 'USD').minorUnits).toBe(-1n);
});
it('rounds signed rational values only with an explicit policy', () => {
  for (const sign of [1n, -1n]) {
    expect(Money.minor(sign * 5n, 'PEN').ratio(1n, 2n, 'HALF_EVEN').minorUnits).toBe(sign * 2n);
    expect(Money.minor(sign * 7n, 'PEN').ratio(1n, 2n, 'HALF_EVEN').minorUnits).toBe(sign * 4n);
    expect(Money.minor(sign * 5n, 'PEN').ratio(1n, 2n, 'HALF_AWAY_FROM_ZERO').minorUnits).toBe(
      sign * 3n,
    );
    expect(Money.minor(sign * 5n, 'PEN').ratio(1n, 2n, 'TRUNCATE').minorUnits).toBe(sign * 2n);
  }
  expect(() => Money.minor(1n, 'PEN').ratio(1n, 0n, 'TRUNCATE')).toThrow();
});
