import { closed, identifier, canonical } from '../ledger';
import { DomainError } from '../money';
import { financialDate, type Clock, type FinancialDate } from '../dates';
import { normalizeManual, type ManualCommand, type ManualPayload } from '../manual-movements';

interface CorrectionBase {
  operationId: string;
  deviceId: string;
  schemaVersion: 1;
  rootId: string;
  expectedVersion: string;
  reason: string;
}
export type ManualCorrection = CorrectionBase &
  (
    | { action: 'keep_server'; resolves: string }
    | (FinancialDate & {
        action: 'replace';
        resolves?: string;
        replacement: ManualCommand;
        reversalId: string;
        reversalOperationId: string;
      })
  );
export interface MovementVersion {
  rootId: string;
  version: string;
  movementId: string;
  payload: ManualPayload;
}
export type CorrectionResult = {
  operationId: string;
  payloadHash: string;
  server: MovementVersion;
} & (
  | { status: 'applied'; action: 'replace' | 'keep_server' }
  | { status: 'conflict'; local: ManualCorrection; differentFields: string[] }
);
export function normalizeCorrection(input: unknown, clock: Clock): ManualCorrection {
  closed(input, [
    'operationId',
    'deviceId',
    'schemaVersion',
    'rootId',
    'expectedVersion',
    'reason',
    'action',
    'resolves',
    'replacement',
    'reversalId',
    'reversalOperationId',
    'businessDate',
    'timezone',
    'occurredAt',
  ]);
  if (
    input['schemaVersion'] !== 1 ||
    typeof input['expectedVersion'] !== 'string' ||
    !/^[1-9]\d{0,17}$/.test(input['expectedVersion'])
  )
    throw new DomainError('INVALID_VERSION');
  if (typeof input['reason'] !== 'string') throw new DomainError('CORRECTION_REASON_REQUIRED');
  const reason = input['reason'].normalize('NFC').trim();
  if (!reason || [...reason].length > 240 || /[\p{Cc}\p{Cf}]/u.test(reason))
    throw new DomainError('CORRECTION_REASON_REQUIRED');
  const base: CorrectionBase = {
    operationId: identifier(input['operationId'] as string),
    deviceId: identifier(input['deviceId'] as string),
    schemaVersion: 1,
    rootId: identifier(input['rootId'] as string),
    expectedVersion: input['expectedVersion'],
    reason,
  };
  const resolves =
    input['resolves'] === undefined ? undefined : identifier(input['resolves'] as string);
  if (resolves === base.operationId) throw new DomainError('INVALID_RESOLUTION');
  if (input['action'] === 'keep_server') {
    closed(input, [
      'operationId',
      'deviceId',
      'schemaVersion',
      'rootId',
      'expectedVersion',
      'reason',
      'action',
      'resolves',
    ]);
    if (!resolves) throw new DomainError('INVALID_RESOLUTION');
    return { ...base, action: 'keep_server', resolves };
  }
  if (input['action'] !== 'replace') throw new DomainError('INVALID_COMMAND');
  if (typeof input['businessDate'] !== 'string' || typeof input['timezone'] !== 'string')
    throw new DomainError('REQUIRED_FINANCIAL_DATE');
  const date = financialDate(
    {
      businessDate: input['businessDate'],
      timezone: input['timezone'],
      ...(input['occurredAt'] === undefined ? {} : { occurredAt: input['occurredAt'] as string }),
    },
    clock,
  );
  const replacement = normalizeManual(input['replacement'], clock);
  const reversalId = identifier(input['reversalId'] as string);
  const reversalOperationId = identifier(input['reversalOperationId'] as string);
  const ids = [
    base.operationId,
    base.rootId,
    replacement.operationId,
    replacement.movementId,
    reversalId,
    reversalOperationId,
  ];
  if (new Set(ids).size !== ids.length || replacement.deviceId !== base.deviceId)
    throw new DomainError('CORRECTION_ID_COLLISION');
  return {
    ...base,
    action: 'replace',
    ...date,
    replacement,
    reversalId,
    reversalOperationId,
    ...(resolves ? { resolves } : {}),
  };
}
/** Presentation comparison only. Posting and Money remain owned by P06. */
export function differingMovementFields(local: ManualPayload, server: ManualPayload): string[] {
  return [
    'kind',
    'accountId',
    'categoryId',
    'currency',
    'amountMinor',
    'businessDate',
    'timezone',
    'occurredAt',
    'note',
  ].filter(
    (key) =>
      canonical(local[key as keyof ManualPayload] ?? null) !==
      canonical(server[key as keyof ManualPayload] ?? null),
  );
}
