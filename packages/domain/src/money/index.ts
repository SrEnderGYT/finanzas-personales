export type Currency = 'PEN' | 'USD';
export type Rounding = 'HALF_EVEN' | 'HALF_AWAY_FROM_ZERO' | 'TRUNCATE';
export const MAX_MINOR = 9_223_372_036_854_775_807n;
export class DomainError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function currency(value: unknown): Currency {
  if (value !== 'PEN' && value !== 'USD') throw new DomainError('INVALID_CURRENCY');
  return value;
}
export class Money {
  private constructor(
    readonly currency: Currency,
    readonly minorUnits: bigint,
  ) {
    Object.freeze(this);
  }
  static minor(value: bigint, unit: Currency): Money {
    currency(unit);
    if (typeof value !== 'bigint' || value > MAX_MINOR || value < -MAX_MINOR)
      throw new DomainError('MONEY_RANGE');
    return new Money(unit, value);
  }
  static fromJSON(value: { currency: Currency; amountMinor: string }): Money {
    if (
      typeof value.amountMinor !== 'string' ||
      value.amountMinor.length > 20 ||
      !/^(0|-?[1-9][0-9]*)$/.test(value.amountMinor)
    )
      throw new DomainError('INVALID_MINOR');
    return Money.minor(BigInt(value.amountMinor), value.currency);
  }
  static decimal(value: string, unit: Currency): Money {
    if (
      typeof value !== 'string' ||
      value.length > 24 ||
      !/^-?(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value)
    )
      throw new DomainError('INVALID_DECIMAL');
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
    return Money.minor(
      (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))) * (negative ? -1n : 1n),
      unit,
    );
  }
  private same(other: Money) {
    if (this.currency !== other.currency) throw new DomainError('CURRENCY_MISMATCH');
  }
  add(other: Money) {
    this.same(other);
    return Money.minor(this.minorUnits + other.minorUnits, this.currency);
  }
  subtract(other: Money) {
    this.same(other);
    return Money.minor(this.minorUnits - other.minorUnits, this.currency);
  }
  compare(other: Money): -1 | 0 | 1 {
    this.same(other);
    return this.minorUnits < other.minorUnits ? -1 : this.minorUnits > other.minorUnits ? 1 : 0;
  }
  ratio(numerator: bigint, denominator: bigint, mode: Rounding): Money {
    if (
      typeof numerator !== 'bigint' ||
      typeof denominator !== 'bigint' ||
      denominator <= 0n ||
      !['HALF_EVEN', 'HALF_AWAY_FROM_ZERO', 'TRUNCATE'].includes(mode)
    )
      throw new DomainError('INVALID_ROUNDING');
    const raw = this.minorUnits * numerator;
    const sign = raw < 0n ? -1n : 1n;
    const abs = raw * sign;
    let quotient = abs / denominator;
    const remainder = abs % denominator;
    if (
      mode !== 'TRUNCATE' &&
      (remainder * 2n > denominator ||
        (remainder * 2n === denominator &&
          (mode === 'HALF_AWAY_FROM_ZERO' || quotient % 2n !== 0n)))
    )
      quotient++;
    return Money.minor(sign * quotient, this.currency);
  }
  toJSON() {
    return { currency: this.currency, amountMinor: this.minorUnits.toString() };
  }
}
