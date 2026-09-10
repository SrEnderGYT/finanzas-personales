import {
  canonical,
  closed,
  DomainError,
  identifier,
  instant,
  normalizeCorrection,
  normalizeMovementVersion,
  differingMovementFields,
  type Clock,
  type ManualCorrection,
  type CorrectionResult,
  type MovementVersion,
} from '../../domain/src';
import { ProductVault, digest } from './product-vault';

export interface CorrectionApi {
  current(rootId: string, signal: AbortSignal): Promise<MovementVersion>;
  execute(command: ManualCorrection, signal: AbortSignal): Promise<unknown>;
}
export interface CorrectionRecord {
  version: 1;
  command: ManualCorrection;
  hash: string;
  state: 'pending' | 'sending' | 'retryable' | 'requires_review' | 'applied';
  attempt?: { id: string; expiresAt: string };
  result?: CorrectionResult;
}
export function correctionResult(
  input: unknown,
  command: ManualCorrection,
  hash: string,
  clock: Clock,
): CorrectionResult {
  closed(input, [
    'status',
    'operationId',
    'payloadHash',
    'server',
    'action',
    'local',
    'differentFields',
  ]);
  if (input['operationId'] !== command.operationId || input['payloadHash'] !== hash)
    throw new DomainError('ACK_MISMATCH');
  const server = normalizeMovementVersion(input['server'], clock);
  if (server.rootId !== command.rootId) throw new DomainError('ACK_MISMATCH');
  const base = { operationId: command.operationId, payloadHash: hash, server };
  if (input['status'] === 'applied') {
    closed(input, ['status', 'operationId', 'payloadHash', 'server', 'action']);
    const version = (
      BigInt(command.expectedVersion) + (command.action === 'replace' ? 1n : 0n)
    ).toString();
    if (
      input['action'] !== command.action ||
      server.version !== version ||
      (command.action === 'replace' &&
        (server.movementId !== command.replacement.movementId ||
          canonical(server.payload) !== canonical(command.replacement.payload)))
    )
      throw new DomainError('ACK_MISMATCH');
    return { ...base, status: 'applied', action: command.action };
  }
  if (input['status'] !== 'conflict') throw new DomainError('INVALID_CORRECTION_RESPONSE');
  closed(input, ['status', 'operationId', 'payloadHash', 'server', 'local', 'differentFields']);
  const local = normalizeCorrection(input['local'], clock);
  const differentFields =
    command.action === 'replace'
      ? differingMovementFields(command.replacement.payload, server.payload)
      : [];
  if (
    canonical(local) !== canonical(command) ||
    server.version === command.expectedVersion ||
    canonical(differentFields) !== canonical(input['differentFields'])
  )
    throw new DomainError('ACK_MISMATCH');
  return { ...base, status: 'conflict', local, differentFields };
}
/** Durable explicit correction attempts; no automatic financial conflict resolution. */
export class CorrectionQueue {
  constructor(
    readonly vault: ProductVault,
    readonly clock: Clock = { now: () => new Date() },
  ) {}
  private key(id: string) {
    return 'correction:v1:' + identifier(id);
  }
  private async checked(value: unknown): Promise<CorrectionRecord> {
    closed(value, ['version', 'command', 'hash', 'state', 'attempt', 'result']);
    const command = normalizeCorrection(value['command'], this.clock);
    const hash = await digest(canonical(command));
    if (
      value['version'] !== 1 ||
      value['hash'] !== hash ||
      !['pending', 'sending', 'retryable', 'requires_review', 'applied'].includes(
        value['state'] as string,
      )
    )
      throw new DomainError('CORRECTION_STORAGE_DAMAGED');
    const state = value['state'] as CorrectionRecord['state'];
    let attempt: CorrectionRecord['attempt'];
    if (state === 'sending') {
      const a = value['attempt'];
      closed(a, ['id', 'expiresAt']);
      attempt = { id: identifier(a['id'] as string), expiresAt: instant(a['expiresAt'] as string) };
    } else if (value['attempt'] !== undefined) throw new DomainError('CORRECTION_STORAGE_DAMAGED');
    const result =
      value['result'] === undefined
        ? undefined
        : correctionResult(value['result'], command, hash, this.clock);
    if (
      (state === 'requires_review') !== (result?.status === 'conflict') ||
      (state === 'applied') !== (result?.status === 'applied')
    )
      throw new DomainError('CORRECTION_STORAGE_DAMAGED');
    return {
      version: 1,
      command,
      hash,
      state,
      ...(attempt ? { attempt } : {}),
      ...(result ? { result } : {}),
    };
  }
  async enqueue(input: unknown) {
    if (this.vault.profile.mode !== 'product') throw new DomainError('DEMO_SYNC_FORBIDDEN');
    const command = normalizeCorrection(input, this.clock);
    const hash = await digest(canonical(command));
    const record: CorrectionRecord = { version: 1, command, hash, state: 'pending' };
    await this.vault.insert(this.key(command.operationId), record);
    const saved = (await this.vault.read(this.key(command.operationId)))!;
    const checked = await this.checked(saved.value);
    if (checked.hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
    return checked;
  }
  async list() {
    const rows: CorrectionRecord[] = [];
    for (const id of await this.vault.ids('correction:v1:')) {
      const row = await this.vault.read(id);
      if (!row) throw new DomainError('CORRECTION_STORAGE_DAMAGED');
      const checked = await this.checked(row.value);
      if (this.key(checked.command.operationId) !== id)
        throw new DomainError('CORRECTION_STORAGE_DAMAGED');
      rows.push(checked);
    }
    return rows;
  }
  async send(id: string, api: CorrectionApi, signal: AbortSignal) {
    if (this.vault.profile.mode !== 'product') throw new DomainError('DEMO_SYNC_FORBIDDEN');
    const key = this.key(id),
      saved = await this.vault.read(key);
    if (!saved) throw new DomainError('CORRECTION_NOT_FOUND');
    const row = await this.checked(saved.value);
    if (row.state === 'applied' || row.state === 'requires_review') return row;
    if (row.attempt && row.attempt.expiresAt > this.clock.now().toISOString())
      throw new DomainError('CORRECTION_BUSY');
    const claimed: CorrectionRecord = {
      ...row,
      state: 'sending',
      attempt: {
        id: crypto.randomUUID(),
        expiresAt: new Date(this.clock.now().getTime() + 60000).toISOString(),
      },
    };
    if (signal.aborted) throw new DomainError('CORRECTION_INTERRUPTED');
    if (!(await this.vault.replace(key, saved.raw, claimed)))
      throw new DomainError('CORRECTION_BUSY');
    const active = await this.vault.read<CorrectionRecord>(key);
    if (!active || active.value.attempt?.id !== claimed.attempt!.id)
      throw new DomainError('CORRECTION_BUSY');
    let result: CorrectionResult;
    try {
      result = correctionResult(
        await api.execute(row.command, signal),
        row.command,
        row.hash,
        this.clock,
      );
    } catch (error) {
      if (this.vault.unlocked && !signal.aborted) {
        const { attempt: _attempt, ...rest } = row;
        void _attempt;
        await this.vault.replace(key, active.raw, { ...rest, state: 'retryable' });
      }
      throw error;
    }
    if (signal.aborted) throw new DomainError('CORRECTION_INTERRUPTED');
    const next: CorrectionRecord = {
      version: 1,
      command: row.command,
      hash: row.hash,
      state: result.status === 'conflict' ? 'requires_review' : 'applied',
      result,
    };
    if (!(await this.vault.replace(key, active.raw, next)))
      throw new DomainError('CORRECTION_BUSY');
    return next;
  }
}
