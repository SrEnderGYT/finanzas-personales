import {
  canonical,
  DomainError,
  identifier,
  instant,
  normalizeManual,
  validateManualReferences,
  type ManualCommand,
  type ManualCatalog,
  type Clock,
} from '../../domain/src';
import { ProductVault, digest } from './product-vault';
export type OutboxState = 'pending' | 'sending' | 'retryable' | 'failed' | 'confirmed';
export interface ManualReceipt {
  operationId: string;
  movementId: string;
  payloadHash: string;
  recordedAt: string;
}
export interface OutboxRecord {
  version: 1;
  revision: number;
  command: ManualCommand;
  hash: string;
  state: OutboxState;
  createdAt: string;
  updatedAt: string;
  attempt?: { id: string; expiresAt: string };
  receipt?: ManualReceipt;
  error?: 'transient' | 'rejected' | 'conflict';
}
export class ManualOutbox {
  constructor(
    readonly vault: ProductVault,
    readonly clock: Clock = { now: () => new Date() },
  ) {}
  private key(id: string) {
    return 'outbox:' + identifier(id);
  }
  private async checked(row: OutboxRecord): Promise<OutboxRecord> {
    if (
      row.version !== 1 ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1 ||
      !['pending', 'sending', 'retryable', 'failed', 'confirmed'].includes(row.state)
    )
      throw new DomainError('OUTBOX_DAMAGED');
    const command = normalizeManual(row.command, this.clock);
    if ((await digest(canonical(command))) !== row.hash) throw new DomainError('OUTBOX_DAMAGED');
    instant(row.createdAt);
    instant(row.updatedAt);
    if (
      (row.state === 'sending') !== !!row.attempt ||
      (row.state === 'confirmed') !== !!row.receipt
    )
      throw new DomainError('OUTBOX_DAMAGED');
    if (row.attempt) {
      identifier(row.attempt.id);
      instant(row.attempt.expiresAt);
    }
    if (row.receipt) this.verifyReceipt(row, row.receipt);
    return row;
  }
  private verifyReceipt(row: OutboxRecord, r: ManualReceipt) {
    if (
      r.operationId !== row.command.operationId ||
      r.movementId !== row.command.movementId ||
      r.payloadHash !== row.hash
    )
      throw new DomainError('ACK_MISMATCH');
    instant(r.recordedAt);
  }
  async enqueue(input: unknown, catalog: ManualCatalog): Promise<OutboxRecord> {
    const command = normalizeManual(input, this.clock),
      hash = await digest(canonical(command)),
      key = this.key(command.operationId);
    const old = await this.vault.read<OutboxRecord>(key);
    if (old) {
      const row = await this.checked(old.value);
      if (row.hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
      return row;
    }
    validateManualReferences(command, catalog);
    const now = this.clock.now().toISOString(),
      row: OutboxRecord = {
        version: 1,
        revision: 1,
        command,
        hash,
        state: 'pending',
        createdAt: now,
        updatedAt: now,
      };
    if (!(await this.vault.insert(key, row))) return this.enqueue(command, catalog);
    return row;
  }
  async list() {
    const rows: OutboxRecord[] = [];
    for (const id of await this.vault.ids('outbox:')) {
      const record = await this.vault.read<OutboxRecord>(id);
      if (!record || id !== this.key(record.value.command.operationId))
        throw new DomainError('OUTBOX_DAMAGED');
      rows.push(await this.checked(record.value));
    }
    return rows.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        a.command.operationId.localeCompare(b.command.operationId),
    );
  }
  /** P09 internal adapter contract only. No P08 UI calls this method. */
  async claim(id: string, attemptId: string) {
    identifier(attemptId);
    return this.change(id, (row) => {
      const now = this.clock.now();
      if (row.state !== 'pending' && row.state !== 'retryable')
        throw new DomainError('INVALID_OUTBOX_STATE');
      return {
        ...row,
        state: 'sending',
        error: undefined,
        attempt: { id: attemptId, expiresAt: new Date(now.getTime() + 60000).toISOString() },
      };
    });
  }
  async recoverExpired(id: string) {
    return this.change(id, (row) => {
      if (
        row.state !== 'sending' ||
        !row.attempt ||
        row.attempt.expiresAt > this.clock.now().toISOString()
      )
        throw new DomainError('LEASE_NOT_EXPIRED');
      return { ...row, state: 'retryable', attempt: undefined, error: 'transient' };
    });
  }
  /** Caller is the future authenticated transport, never a button or optimistic UI. */
  async finish(
    id: string,
    attemptId: string,
    ownerId: string,
    result: ManualReceipt | 'transient' | 'rejected' | 'conflict',
  ) {
    if (ownerId !== this.vault.profile.ownerId) throw new DomainError('PROFILE_MISMATCH');
    return this.change(id, (row) => {
      if (
        row.state !== 'sending' ||
        row.attempt?.id !== attemptId ||
        row.attempt.expiresAt <= this.clock.now().toISOString()
      )
        throw new DomainError('STALE_ATTEMPT');
      if (typeof result === 'string')
        return {
          ...row,
          state: result === 'transient' ? 'retryable' : 'failed',
          attempt: undefined,
          error: result,
        };
      this.verifyReceipt(row, result);
      return { ...row, state: 'confirmed', attempt: undefined, error: undefined, receipt: result };
    });
  }
  private async change(id: string, reduce: (row: OutboxRecord) => OutboxRecord) {
    const key = this.key(id),
      found = await this.vault.read<OutboxRecord>(key);
    if (!found) throw new DomainError('NOT_FOUND');
    const row = await this.checked(found.value),
      next = {
        ...reduce(row),
        revision: row.revision + 1,
        updatedAt: this.clock.now().toISOString(),
      };
    await this.checked(next);
    if (!(await this.vault.replace(key, found.raw, next))) throw new DomainError('OUTBOX_CONFLICT');
    return next;
  }
}
