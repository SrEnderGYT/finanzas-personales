import { Money, DomainError, type Currency } from '../money';
import { financialDate, type Clock, type FinancialDate } from '../dates';
import { closed, identifier } from '../ledger';
export interface ManualPayload extends FinancialDate {
  kind: 'expense' | 'income';
  accountId: string;
  categoryId: string;
  currency: Currency;
  amountMinor: string;
  note?: string;
}
export interface ManualCommand {
  operationId: string;
  deviceId: string;
  movementId: string;
  schemaVersion: 1;
  baseVersion: '0';
  payload: ManualPayload;
}
export interface ManualAccount {
  version?: string;
  id: string;
  name: string;
  currency: Currency;
  state: 'active' | 'inactive';
}
export interface ManualCategory {
  version?: string;
  id: string;
  name: string;
  kind: 'expense' | 'income';
  state: 'active' | 'archived';
}
export interface ManualCatalog {
  accounts: ManualAccount[];
  categories: ManualCategory[];
  downloadedAt: string;
}
export function normalizeManual(input: unknown, clock: Clock): ManualCommand {
  closed(input, [
    'operationId',
    'deviceId',
    'movementId',
    'schemaVersion',
    'baseVersion',
    'payload',
  ]);
  if (input['schemaVersion'] !== 1 || input['baseVersion'] !== '0')
    throw new DomainError('INVALID_VERSION');
  const p = input['payload'];
  closed(p, [
    'kind',
    'accountId',
    'categoryId',
    'currency',
    'amountMinor',
    'businessDate',
    'timezone',
    'occurredAt',
    'note',
  ]);
  if (p['kind'] !== 'expense' && p['kind'] !== 'income') throw new DomainError('INVALID_KIND');
  // Mandatory even when the caller knows the local day or timezone. Never infer either.
  if (typeof p['businessDate'] !== 'string' || typeof p['timezone'] !== 'string')
    throw new DomainError('REQUIRED_FINANCIAL_DATE');
  const dates = financialDate(
    {
      businessDate: p['businessDate'],
      timezone: p['timezone'],
      ...(p['occurredAt'] === undefined ? {} : { occurredAt: p['occurredAt'] as string }),
    },
    clock,
  );
  const money = Money.fromJSON({
    currency: p['currency'] as Currency,
    amountMinor: p['amountMinor'] as string,
  });
  if (money.minorUnits <= 0n) throw new DomainError('POSITIVE_AMOUNT_REQUIRED');
  let note: string | undefined;
  if (p['note'] !== undefined) {
    if (typeof p['note'] !== 'string') throw new DomainError('INVALID_NOTE');
    note = p['note'].normalize('NFC').trim();
    if ([...note].length > 500 || /[\p{Cc}\p{Cf}]/u.test(note))
      throw new DomainError('INVALID_NOTE');
  }
  return {
    operationId: identifier(input['operationId'] as string),
    deviceId: identifier(input['deviceId'] as string),
    movementId: identifier(input['movementId'] as string),
    schemaVersion: 1,
    baseVersion: '0',
    payload: {
      kind: p['kind'],
      accountId: identifier(p['accountId'] as string),
      categoryId: identifier(p['categoryId'] as string),
      ...money.toJSON(),
      ...dates,
      ...(note ? { note } : {}),
    },
  };
}
export function validateManualReferences(command: ManualCommand, catalog: ManualCatalog): void {
  const p = command.payload,
    a = catalog.accounts.find((a) => a.id === p.accountId),
    c = catalog.categories.find((c) => c.id === p.categoryId);
  if (!a || !c) throw new DomainError('REFERENCE_NOT_FOUND');
  if (a.state !== 'active' || c.state !== 'active') throw new DomainError('REFERENCE_INACTIVE');
  if (a.currency !== p.currency) throw new DomainError('CURRENCY_MISMATCH');
  if (c.kind !== p.kind) throw new DomainError('CATEGORY_MISMATCH');
}
export function manualAmount(text: string, unit: Currency): Money {
  if (!/^(0|[1-9]\d*)([.,]\d{1,2})?$/.test(text)) throw new DomainError('INVALID_AMOUNT');
  const value = Money.decimal(text.replace(',', '.'), unit);
  if (value.minorUnits <= 0n) throw new DomainError('POSITIVE_AMOUNT_REQUIRED');
  return value;
}
