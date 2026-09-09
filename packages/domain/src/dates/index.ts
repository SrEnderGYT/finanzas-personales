import { DomainError } from '../money';
export interface Clock { now(): Date; }
export interface FinancialDate { businessDate: string; timezone: string; occurredAt?: string; }
export function civil(value: string): string {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.slice(0,4) === '0000') throw new DomainError('INVALID_DATE');
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) throw new DomainError('INVALID_DATE');
  return value;
}
export function zone(value: string): string {
  if (typeof value !== 'string' || value.length > 80 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) throw new DomainError('INVALID_ZONE');
  try { return new Intl.DateTimeFormat('en', {timeZone:value}).resolvedOptions().timeZone; }
  catch { throw new DomainError('INVALID_ZONE'); }
}
export function instant(value: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(value)) throw new DomainError('INVALID_INSTANT');
  civil(value.slice(0,10));
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().length !== 24) throw new DomainError('INVALID_INSTANT');
  return parsed.toISOString();
}
export function localDate(time: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {timeZone:zone(timezone), year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(time);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return civil(`${part('year').padStart(4,'0')}-${part('month')}-${part('day')}`);
}
export function financialDate(value: FinancialDate, clock: Clock): FinancialDate {
  const businessDate = civil(value.businessDate);
  const timezone = zone(value.timezone);
  const occurredAt = value.occurredAt === undefined ? undefined : instant(value.occurredAt);
  if (occurredAt && localDate(new Date(occurredAt),timezone) !== businessDate) throw new DomainError('DATE_MISMATCH');
  if (businessDate > localDate(clock.now(),timezone)) throw new DomainError('FUTURE_DATE');
  return {businessDate,timezone,...(occurredAt ? {occurredAt} : {})};
}
export function inPeriod(date: string, start: string, endExclusive: string): boolean {
  civil(date); civil(start); civil(endExclusive);
  if (start >= endExclusive) throw new DomainError('INVALID_PERIOD');
  return date >= start && date < endExclusive;
}
