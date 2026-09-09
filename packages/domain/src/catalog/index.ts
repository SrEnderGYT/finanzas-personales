import { DomainError, Money, type Currency } from '../money';
import { closed, identifier } from '../ledger';

export const accountTypes = [
  'savings',
  'current',
  'cash',
  'wallet',
  'investment',
  'other',
] as const;
export type AccountType = (typeof accountTypes)[number];
export type CategoryKind = 'expense' | 'income';
export interface AccountFields {
  name: string;
  type: AccountType;
  currency: Currency;
  state: 'active' | 'inactive';
  position: number;
}
export interface CategoryFields {
  name: string;
  kind: CategoryKind;
  state: 'active' | 'archived';
  position: number;
}
export type CatalogCommand =
  | { type: 'account.create'; id: string; payload: AccountFields }
  | { type: 'account.update'; id: string; payload: Partial<Omit<AccountFields, 'currency'>> }
  | { type: 'category.create'; id: string; payload: CategoryFields }
  | { type: 'category.update'; id: string; payload: Partial<Omit<CategoryFields, 'kind'>> }
  | { type: 'category.initialize' };
export interface CatalogEnvelope {
  operationId: string;
  deviceId: string;
  schemaVersion: 1;
  baseVersion: string;
  command: CatalogCommand;
}
export function catalogName(value: unknown): string {
  if (typeof value !== 'string') throw new DomainError('INVALID_NAME');
  const name = value.normalize('NFC').trim();
  if (!name || [...name].length > 80 || /[\p{Cc}\p{Cf}]/u.test(name))
    throw new DomainError('INVALID_NAME');
  return name;
}
function choice(value: unknown, choices: readonly string[]): string {
  if (typeof value !== 'string' || !choices.includes(value)) throw new DomainError('INVALID_FIELD');
  return value;
}
export function normalizeCatalog(input: unknown): CatalogEnvelope {
  closed(input, ['operationId', 'deviceId', 'schemaVersion', 'baseVersion', 'command']);
  const operationId = identifier(input['operationId'] as string);
  const deviceId = identifier(input['deviceId'] as string);
  const baseVersion = input['baseVersion'];
  if (
    input['schemaVersion'] !== 1 ||
    typeof baseVersion !== 'string' ||
    !/^(0|[1-9]\d{0,18})$/.test(baseVersion) ||
    BigInt(baseVersion) > 9223372036854775807n
  )
    throw new DomainError('INVALID_VERSION');
  const c = input['command'];
  closed(c, ['type', 'id', 'payload']);
  const type = choice(c['type'], [
    'account.create',
    'account.update',
    'category.create',
    'category.update',
    'category.initialize',
  ]) as CatalogCommand['type'];
  if (type === 'category.initialize') {
    closed(c, ['type']);
    if (baseVersion !== '0') throw new DomainError('INVALID_VERSION');
    return { operationId, deviceId, schemaVersion: 1, baseVersion, command: { type } };
  }
  const id = identifier(c['id'] as string);
  const account = type.startsWith('account.');
  const create = type.endsWith('.create');
  if (create ? baseVersion !== '0' : baseVersion === '0') throw new DomainError('INVALID_VERSION');
  const p = c['payload'];
  closed(p, [
    'name',
    ...(account ? ['type'] : []),
    'state',
    'position',
    ...(create ? [account ? 'currency' : 'kind'] : []),
  ]);
  if (!Object.keys(p).length) throw new DomainError('EMPTY_UPDATE');
  const payload: Record<string, unknown> = {};
  if (create || 'name' in p) payload['name'] = catalogName(p['name']);
  if (account && (create || 'type' in p)) payload['type'] = choice(p['type'], accountTypes);
  if (create || 'state' in p)
    payload['state'] = choice(
      p['state'],
      account ? ['active', 'inactive'] : ['active', 'archived'],
    );
  if (create || 'position' in p) {
    const position = p['position'];
    if (
      typeof position !== 'number' ||
      !Number.isInteger(position) ||
      position < 0 ||
      position > 2147483647
    )
      throw new DomainError('INVALID_POSITION');
    payload['position'] = position;
  }
  if (create && payload['state'] !== 'active') throw new DomainError('INVALID_STATE');
  if (create && account)
    payload['currency'] = Money.minor(
      0n,
      choice(p['currency'], ['PEN', 'USD']) as Currency,
    ).currency;
  if (create && !account) payload['kind'] = choice(p['kind'], ['expense', 'income']);
  return {
    operationId,
    deviceId,
    schemaVersion: 1,
    baseVersion,
    command: { type, id, payload } as CatalogCommand,
  };
}
