import {
  canonical,
  closed,
  DomainError,
  financialDate,
  identifier,
  instant,
  Money,
  type ManualPayload,
} from '../../domain/src';
import { ManualOutbox, type ManualReceipt } from './manual-outbox';
import { ProductVault } from './product-vault';
export interface ConfirmedMovement extends ManualPayload {
  id: string;
  operationId: string;
}
export interface SyncChange {
  sequence: string;
  movement: ConfirmedMovement;
  receipt: ManualReceipt;
}
export interface ChangePage {
  changes: SyncChange[];
  nextCursor: string;
  hasMore: boolean;
  cursorGeneration: string;
}
export interface SyncApi {
  send(
    command: unknown,
    signal: AbortSignal,
  ): Promise<{ status: 'applied' | 'already_applied'; receipt: ManualReceipt }>;
  pull(cursor: string | undefined, signal: AbortSignal): Promise<ChangePage>;
}
export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code = 'REQUEST_FAILED',
  ) {
    super(code);
  }
}
export interface SyncSnapshot {
  version: 1;
  cursor?: string;
  generation?: string;
  lastSync?: string;
  movements: Record<string, SyncChange>;
  retries: Record<string, { count: number; nextAt: string }>;
  failures: Record<string, { status: number; code: string }>;
}
const empty = (): SyncSnapshot => ({ version: 1, movements: {}, retries: {}, failures: {} });
export type SyncState =
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'session_required'
  | 'forbidden'
  | 'retryable'
  | 'locked'
  | 'invalid';
export class SyncEngine {
  private running: Promise<SyncState> | undefined;
  private aborter: AbortController | undefined;
  readonly outbox: ManualOutbox;
  constructor(
    readonly vault: ProductVault,
    readonly api: SyncApi,
    readonly changed: () => Promise<void> = async () => {},
    readonly now: () => Date = () => new Date(),
    readonly jitter: () => number = () => Math.random(),
  ) {
    this.outbox = new ManualOutbox(vault, { now });
  }
  stop() {
    this.aborter?.abort();
  }
  async snapshot(): Promise<SyncSnapshot> {
    const record = await this.vault.read<SyncSnapshot>('sync:v1');
    return record ? validateSnapshot(record.value) : empty();
  }
  private async update(change: (state: SyncSnapshot) => SyncSnapshot) {
    for (let i = 0; i < 5; i++) {
      const old = await this.vault.read<SyncSnapshot>('sync:v1');
      const next = validateSnapshot(change(old ? validateSnapshot(old.value) : empty()));
      if (
        old
          ? await this.vault.replace('sync:v1', old.raw, next)
          : await this.vault.insert('sync:v1', next)
      )
        return;
    }
    throw new DomainError('SYNC_CHECKPOINT_CONFLICT');
  }
  run(): Promise<SyncState> {
    if (this.running) return this.running;
    this.aborter = new AbortController();
    this.running = this.perform(this.aborter.signal).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async perform(signal: AbortSignal): Promise<SyncState> {
    if (this.vault.profile.mode !== 'product') throw new DomainError('DEMO_SYNC_FORBIDDEN');
    try {
      for (let row of await this.outbox.list()) {
        if (signal.aborted) return 'locked';
        if (row.state === 'sending') {
          if (row.attempt!.expiresAt > this.now().toISOString()) continue;
          row = await this.outbox.recoverExpired(row.command.operationId);
        }
        if (row.state !== 'pending' && row.state !== 'retryable') continue;
        const retry = (await this.snapshot()).retries[row.command.operationId];
        if (retry && retry.nextAt > this.now().toISOString()) {
          continue;
        }
        const attempt = crypto.randomUUID();
        try {
          await this.outbox.claim(row.command.operationId, attempt);
        } catch (error) {
          if (
            error instanceof DomainError &&
            ['OUTBOX_CONFLICT', 'INVALID_OUTBOX_STATE'].includes(error.code)
          )
            continue;
          throw error;
        }
        await this.changed();
        try {
          const response = await this.api.send(row.command, signal);
          if (signal.aborted) return 'locked';
          if (response.status !== 'applied' && response.status !== 'already_applied')
            throw new DomainError('INVALID_SYNC_RESPONSE');
          await this.outbox.finish(
            row.command.operationId,
            attempt,
            this.vault.profile.ownerId,
            response.receipt,
          );
          await this.update((s) => {
            delete s.retries[row.command.operationId];
            delete s.failures[row.command.operationId];
            return s;
          });
        } catch (error) {
          if (signal.aborted || !this.vault.unlocked) return 'locked';
          const status = error instanceof SyncHttpError ? error.status : 0;
          const code = error instanceof SyncHttpError ? error.code : 'NETWORK_OR_RESPONSE_ERROR';
          if (status === 409 || status === 422 || status === 403) {
            await this.outbox.finish(
              row.command.operationId,
              attempt,
              this.vault.profile.ownerId,
              status === 409 ? 'conflict' : 'rejected',
            );
            await this.update((s) => {
              s.failures[row.command.operationId] = { status, code };
              return s;
            });
            await this.changed();
            if (status === 403) return 'forbidden';
          } else {
            await this.outbox.finish(
              row.command.operationId,
              attempt,
              this.vault.profile.ownerId,
              'transient',
            );
            await this.changed();
            if (status === 401) return 'session_required';
            await this.update((s) => {
              const count = (s.retries[row.command.operationId]?.count ?? 0) + 1;
              s.retries[row.command.operationId] = {
                count,
                nextAt: new Date(
                  this.now().getTime() +
                    Math.min(60000, 1000 * 2 ** Math.min(count - 1, 6)) +
                    Math.floor(this.jitter() * 250),
                ).toISOString(),
              };
              return s;
            });
          }
        }
        await this.changed();
      }
      let more = true;
      while (more && !signal.aborted) {
        const before = await this.snapshot();
        const page = validatePage(await this.api.pull(before.cursor, signal));
        if (signal.aborted) return 'locked';
        if (before.generation && before.generation !== page.cursorGeneration)
          throw new DomainError('CURSOR_GENERATION_CHANGED');
        if (page.hasMore && page.nextCursor === before.cursor)
          throw new DomainError('CURSOR_NOT_ADVANCING');
        const local = await this.outbox.list();
        for (const change of page.changes) {
          let row = local.find((r) => r.command.operationId === change.receipt.operationId);
          if (!row || row.hash !== change.receipt.payloadHash) continue;
          if (row.state === 'sending' && row.attempt!.expiresAt <= this.now().toISOString())
            row = await this.outbox.recoverExpired(row.command.operationId);
          if (row.state === 'pending' || row.state === 'retryable') {
            const attempt = crypto.randomUUID();
            await this.outbox.claim(row.command.operationId, attempt);
            await this.outbox.finish(
              row.command.operationId,
              attempt,
              this.vault.profile.ownerId,
              change.receipt,
            );
          }
        }
        await this.update((s) => {
          // Another tab's committed page cannot be overwritten by a stale cursor.
          if (s.cursor !== before.cursor) throw new DomainError('SYNC_CHECKPOINT_CONFLICT');
          for (const change of page.changes) {
            const old = s.movements[change.movement.id];
            if (old && canonical(old) !== canonical(change))
              throw new DomainError('IMMUTABLE_CHANGE_CONFLICT');
            s.movements[change.movement.id] = change;
            delete s.retries[change.receipt.operationId];
          }
          s.cursor = page.nextCursor;
          s.generation = page.cursorGeneration;
          if (!page.hasMore) s.lastSync = this.now().toISOString();
          return s;
        });
        await this.changed();
        more = page.hasMore;
      }
      return signal.aborted
        ? 'locked'
        : (await this.outbox.list()).some((row) => row.state === 'retryable')
          ? 'retryable'
          : 'idle';
    } catch (error) {
      if (signal.aborted || !this.vault.unlocked) return 'locked';
      if (error instanceof SyncHttpError && error.status === 401) return 'session_required';
      if (error instanceof SyncHttpError && error.status === 403) return 'forbidden';
      if (error instanceof SyncHttpError && (error.status === 422 || error.status === 409))
        return 'invalid';
      if (error instanceof DomainError) throw error;
      return 'retryable';
    }
  }
}
export function validatePage(input: unknown): ChangePage {
  closed(input, ['changes', 'nextCursor', 'hasMore', 'cursorGeneration']);
  if (
    !Array.isArray(input['changes']) ||
    input['changes'].length > 200 ||
    typeof input['nextCursor'] !== 'string' ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(input['nextCursor']) ||
    typeof input['hasMore'] !== 'boolean' ||
    (input['hasMore'] === true && input['changes'].length === 0)
  )
    throw new DomainError('INVALID_CHANGE_PAGE');
  const changes: SyncChange[] = input['changes'].map((raw) => {
    closed(raw, ['sequence', 'movement', 'receipt']);
    if (typeof raw['sequence'] !== 'string' || !/^[1-9]\d{0,18}$/.test(raw['sequence']))
      throw new DomainError('INVALID_CHANGE_SEQUENCE');
    const m = raw['movement'],
      r = raw['receipt'];
    closed(m, [
      'id',
      'operationId',
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
    closed(r, ['operationId', 'movementId', 'payloadHash', 'recordedAt']);
    const id = identifier(m['id'] as string),
      operationId = identifier(m['operationId'] as string);
    if (m['kind'] !== 'expense' && m['kind'] !== 'income') throw new DomainError('INVALID_KIND');
    if (typeof m['businessDate'] !== 'string' || typeof m['timezone'] !== 'string')
      throw new DomainError('REQUIRED_FINANCIAL_DATE');
    const money = Money.fromJSON({
      currency: m['currency'] as 'PEN' | 'USD',
      amountMinor: m['amountMinor'] as string,
    });
    if (money.minorUnits <= 0n) throw new DomainError('POSITIVE_AMOUNT_REQUIRED');
    if (
      m['note'] !== null &&
      m['note'] !== undefined &&
      (typeof m['note'] !== 'string' ||
        [...m['note']].length > 500 ||
        /[\p{Cc}\p{Cf}]/u.test(m['note']))
    )
      throw new DomainError('INVALID_NOTE');
    if (
      r['operationId'] !== operationId ||
      r['movementId'] !== id ||
      typeof r['payloadHash'] !== 'string' ||
      !/^[0-9a-f]{64}$/.test(r['payloadHash'])
    )
      throw new DomainError('ACK_MISMATCH');
    return {
      sequence: raw['sequence'],
      movement: {
        id,
        operationId,
        kind: m['kind'],
        accountId: identifier(m['accountId'] as string),
        categoryId: identifier(m['categoryId'] as string),
        ...money.toJSON(),
        ...financialDate(
          {
            businessDate: m['businessDate'],
            timezone: m['timezone'],
            ...(m['occurredAt'] ? { occurredAt: m['occurredAt'] as string } : {}),
          },
          { now: () => new Date() },
        ),
        ...(m['note'] ? { note: m['note'] as string } : {}),
      },
      receipt: {
        operationId,
        movementId: id,
        payloadHash: r['payloadHash'],
        recordedAt: instant(r['recordedAt'] as string),
      },
    };
  });
  for (let i = 1; i < changes.length; i++)
    if (BigInt(changes[i]!.sequence) <= BigInt(changes[i - 1]!.sequence))
      throw new DomainError('INVALID_CHANGE_SEQUENCE');
  return {
    changes,
    nextCursor: input['nextCursor'],
    hasMore: input['hasMore'],
    cursorGeneration: identifier(input['cursorGeneration'] as string),
  };
}

function validateSnapshot(input: unknown): SyncSnapshot {
  closed(input, [
    'version',
    'cursor',
    'generation',
    'lastSync',
    'movements',
    'retries',
    'failures',
  ]);
  if (input['version'] !== 1) throw new DomainError('SYNC_STORAGE_DAMAGED');
  const cursor = input['cursor'],
    generation = input['generation'];
  if (
    (cursor === undefined) !== (generation === undefined) ||
    (cursor !== undefined && (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(cursor)))
  )
    throw new DomainError('SYNC_STORAGE_DAMAGED');
  if (generation !== undefined) identifier(generation as string);
  if (input['lastSync'] !== undefined) instant(input['lastSync'] as string);
  for (const key of ['movements', 'retries', 'failures']) {
    const map = input[key];
    if (!map || typeof map !== 'object' || Array.isArray(map))
      throw new DomainError('SYNC_STORAGE_DAMAGED');
  }
  for (const [id, change] of Object.entries(input['movements'] as Record<string, unknown>)) {
    if (generation === undefined) throw new DomainError('SYNC_STORAGE_DAMAGED');
    const parsed = validatePage({
      changes: [change],
      nextCursor: cursor,
      hasMore: false,
      cursorGeneration: generation,
    }).changes[0]!;
    if (parsed.movement.id !== id) throw new DomainError('SYNC_STORAGE_DAMAGED');
  }
  for (const [id, retry] of Object.entries(input['retries'] as Record<string, unknown>)) {
    identifier(id);
    closed(retry, ['count', 'nextAt']);
    if (!Number.isSafeInteger(retry['count']) || (retry['count'] as number) < 1)
      throw new DomainError('SYNC_STORAGE_DAMAGED');
    instant(retry['nextAt'] as string);
  }
  for (const [id, failure] of Object.entries(input['failures'] as Record<string, unknown>)) {
    identifier(id);
    closed(failure, ['status', 'code']);
    if (
      ![403, 409, 422].includes(failure['status'] as number) ||
      typeof failure['code'] !== 'string' ||
      !/^[A-Z0-9_]{1,80}$/.test(failure['code'])
    )
      throw new DomainError('SYNC_STORAGE_DAMAGED');
  }
  return input as unknown as SyncSnapshot;
}
