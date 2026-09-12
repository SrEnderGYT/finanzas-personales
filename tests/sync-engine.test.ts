import 'fake-indexeddb/auto';
import { it, expect, vi } from 'vitest';
import { canonical } from '../packages/domain/src';
import { IndexedVaultStore } from '../packages/shared/src/indexed-vault';
import { ProductVault, digest } from '../packages/shared/src/product-vault';
import { ManualOutbox } from '../packages/shared/src/manual-outbox';
import {
  SyncEngine,
  movementVersion,
  SyncHttpError,
  type SyncApi,
  type SyncChange,
  type SyncSnapshot,
} from '../packages/shared/src/sync-engine';
const profile = () => ({
  ownerId: crypto.randomUUID(),
  environment: 'synthetic',
  mode: 'product' as const,
});
async function fixture() {
  const p = profile(),
    name = crypto.randomUUID(),
    vault = new ProductVault(await IndexedVaultStore.open(name), p);
  await vault.create('synthetic sync phrase');
  const accountId = crypto.randomUUID(),
    categoryId = crypto.randomUUID();
  const catalog = {
    accounts: [
      { id: accountId, name: 'Synthetic', currency: 'PEN' as const, state: 'active' as const },
    ],
    categories: [
      { id: categoryId, name: 'Synthetic', kind: 'expense' as const, state: 'active' as const },
    ],
    downloadedAt: '2026-01-01T00:00:00.000Z',
  };
  const command = () => ({
    operationId: crypto.randomUUID(),
    movementId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    schemaVersion: 1,
    baseVersion: '0',
    payload: {
      kind: 'expense',
      accountId,
      categoryId,
      currency: 'PEN',
      amountMinor: '10',
      businessDate: '2026-01-01',
      timezone: 'America/Lima',
    },
  });
  const first = await new ManualOutbox(vault).enqueue(command(), catalog);
  return { p, name, vault, catalog, command, first };
}
async function recoveryFixture() {
  const f = await fixture();
  const change: SyncChange = {
    sequence: '1',
    movement: {
      ...f.first.command.payload,
      id: f.first.command.movementId,
      operationId: f.first.command.operationId,
    },
    receipt: {
      operationId: f.first.command.operationId,
      movementId: f.first.command.movementId,
      payloadHash: f.first.hash,
      recordedAt: '2026-01-02T00:00:00.000Z',
    },
  };
  const checkpoint: SyncSnapshot = {
    version: 1,
    cursor: 'invalidatedCursor',
    generation: crypto.randomUUID(),
    movements: { [change.movement.id]: change },
    retries: {},
    failures: {},
  };
  await f.vault.insert('sync:v1', checkpoint);
  const original = (await f.vault.read('sync:v1'))!.raw;
  const send = vi.fn<SyncApi['send']>();
  const generation = crypto.randomUUID();
  const api: SyncApi = {
    send,
    pull: vi.fn(async () => ({
      changes: [change],
      nextCursor: 'newCursor',
      hasMore: false,
      cursorGeneration: generation,
    })),
  };
  return { ...f, change, original, send, generation, api };
}
it('a correction projection separates movement identity from its closed financial payload', async () => {
  const f = await recoveryFixture();
  const head = movementVersion(f.change);
  expect(head.payload).toEqual(f.first.command.payload);
  expect(head.payload).not.toHaveProperty('id');
  expect(head.payload).not.toHaveProperty('operationId');
  expect(head.movementId).toBe(f.first.command.movementId);
  await f.vault.close();
});
it('explicit checkpoint repair retains encrypted evidence and exactly one untouched pending after reopen', async () => {
  const f = await recoveryFixture();
  const before = await new ManualOutbox(f.vault).list();
  expect(await new SyncEngine(f.vault, f.api).recoverCheckpoint()).toBe('idle');
  expect(f.api.pull).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
  expect(f.send).not.toHaveBeenCalled();
  const evidence = await f.vault.ids('sync-evidence:');
  expect(evidence).toHaveLength(1);
  expect(
    (await f.vault.read<{ previousCiphertext: string }>(evidence[0]!))!.value.previousCiphertext,
  ).toBe(f.original);
  expect(JSON.stringify(await f.vault.store.entries())).not.toContain('America/Lima');
  await f.vault.close();
  const reopened = new ProductVault(await IndexedVaultStore.open(f.name), f.p);
  await reopened.unlock('synthetic sync phrase');
  const engine = new SyncEngine(reopened, f.api);
  expect(await engine.outbox.list()).toEqual(before);
  expect((await engine.snapshot()).generation).toBe(f.generation);
  expect((await engine.snapshot()).cursor).toBe('newCursor');
  await reopened.close();
});
it('repair refuses missing or rewritten immutable server history and retains the original checkpoint', async () => {
  const f = await recoveryFixture();
  for (const changes of [
    [],
    [{ ...f.change, movement: { ...f.change.movement, amountMinor: '20' } }],
  ]) {
    f.api.pull = async () => ({
      changes,
      nextCursor: 'newCursor',
      hasMore: false,
      cursorGeneration: f.generation,
    });
    await expect(new SyncEngine(f.vault, f.api).recoverCheckpoint()).rejects.toMatchObject({
      code: changes.length ? 'IMMUTABLE_CHANGE_CONFLICT' : 'RECOVERY_HISTORY_MISSING',
    });
    expect((await f.vault.read('sync:v1'))!.raw).toBe(f.original);
  }
  expect((await new ManualOutbox(f.vault).list())[0]!.state).toBe('pending');
  await f.vault.close();
});
it('interrupted or revoked repair never checkpoints a partial download', async () => {
  const f = await recoveryFixture();
  for (const failure of [new Error('Synthetic network loss'), new SyncHttpError(401)]) {
    f.api.pull = async (cursor) => {
      if (cursor) throw failure;
      return {
        changes: [f.change],
        nextCursor: 'page1',
        hasMore: true,
        cursorGeneration: f.generation,
      };
    };
    await expect(new SyncEngine(f.vault, f.api).recoverCheckpoint()).rejects.toBe(failure);
    expect((await f.vault.read('sync:v1'))!.raw).toBe(f.original);
  }
  expect(f.send).not.toHaveBeenCalled();
  await f.vault.close();
});
it('repair cannot overwrite a concurrent checkpoint or recreate corrupted ciphertext', async () => {
  const f = await recoveryFixture();
  const next = (await f.vault.read<SyncSnapshot>('sync:v1'))!.value;
  f.api.pull = async () => {
    await f.vault.replace('sync:v1', f.original, { ...next, cursor: 'concurrentCursor' });
    return {
      changes: [f.change],
      nextCursor: 'newCursor',
      hasMore: false,
      cursorGeneration: f.generation,
    };
  };
  const engine = new SyncEngine(f.vault, f.api);
  await expect(engine.recoverCheckpoint()).rejects.toMatchObject({
    code: 'SYNC_CHECKPOINT_CONFLICT',
  });
  expect((await engine.snapshot()).cursor).toBe('concurrentCursor');
  const raw = (await f.vault.read('sync:v1'))!.raw;
  await f.vault.store.compareAndSwap('sync:v1', raw, '{"damaged":true}');
  await expect(engine.recoverCheckpoint()).rejects.toThrow();
  expect(await f.vault.store.get('sync:v1')).toBe('{"damaged":true}');
  expect((await engine.outbox.list())[0]!.state).toBe('pending');
  await f.vault.close();
});
it('recovers a lost response through authenticated pull and reopens one confirmed operation', async () => {
  const f = await fixture(),
    generation = crypto.randomUUID();
  let remote: SyncChange | undefined;
  const send = vi.fn<SyncApi['send']>(async () => {
    remote = {
      sequence: '1',
      movement: {
        ...f.first.command.payload,
        id: f.first.command.movementId,
        operationId: f.first.command.operationId,
      },
      receipt: {
        operationId: f.first.command.operationId,
        movementId: f.first.command.movementId,
        payloadHash: f.first.hash,
        recordedAt: new Date().toISOString(),
      },
    };
    throw new Error('Synthetic response loss after commit');
  });
  const api: SyncApi = {
    send,
    pull: async () => ({
      changes: remote ? [remote] : [],
      nextCursor: 'cursor1',
      hasMore: false,
      cursorGeneration: generation,
    }),
  };
  const engine = new SyncEngine(f.vault, api);
  expect(await Promise.all(Array.from({ length: 5 }, () => engine.run()))).toEqual(
    Array(5).fill('idle'),
  );
  expect(send).toHaveBeenCalledTimes(1);
  expect((await engine.outbox.list())[0]?.state).toBe('confirmed');
  await f.vault.close();
  const reopened = new ProductVault(await IndexedVaultStore.open(f.name), f.p);
  await reopened.unlock('synthetic sync phrase');
  const next = new SyncEngine(reopened, api);
  await next.run();
  expect(Object.keys((await next.snapshot()).movements)).toHaveLength(1);
  expect(await next.outbox.list()).toHaveLength(1);
  expect(send).toHaveBeenCalledTimes(1);
  await reopened.close();
});

it('stops on a rejected cursor and never silently replaces a malformed encrypted checkpoint', async () => {
  const f = await fixture();
  const api: SyncApi = {
    send: async () => {
      throw new SyncHttpError(422, 'INVALID_COMMAND');
    },
    pull: async () => {
      throw new SyncHttpError(422, 'INVALID_CURSOR');
    },
  };
  const engine = new SyncEngine(f.vault, api);
  expect(await engine.run()).toBe('invalid');
  const saved = (await f.vault.read('sync:v1'))!;
  expect(
    await f.vault.replace('sync:v1', saved.raw, {
      version: 1,
      movements: {},
      retries: [],
      failures: {},
    }),
  ).toBe(true);
  await expect(engine.snapshot()).rejects.toMatchObject({ code: 'SYNC_STORAGE_DAMAGED' });
  expect((await f.vault.read<{ retries: unknown }>('sync:v1'))?.value.retries).toEqual([]);
  await f.vault.close();
});
it('keeps 422 visible without infinite retries and stops all uploads on session revocation', async () => {
  const f = await fixture();
  const send = vi
    .fn<SyncApi['send']>()
    .mockRejectedValue(new SyncHttpError(422, 'REFERENCE_INACTIVE'));
  const api: SyncApi = {
    send,
    pull: async () => ({
      changes: [],
      nextCursor: 'empty',
      hasMore: false,
      cursorGeneration: f.p.ownerId,
    }),
  };
  const engine = new SyncEngine(f.vault, api);
  await engine.run();
  await engine.run();
  expect(send).toHaveBeenCalledTimes(1);
  expect((await engine.snapshot()).failures[f.first.command.operationId]?.status).toBe(422);
  expect((await engine.outbox.list())[0]?.state).toBe('failed');
  await engine.outbox.enqueue(f.command(), f.catalog);
  await engine.outbox.enqueue(f.command(), f.catalog);
  send.mockRejectedValue(new SyncHttpError(401, 'SESSION_REVOKED'));
  expect(await engine.run()).toBe('session_required');
  expect(send).toHaveBeenCalledTimes(2);
  expect((await engine.outbox.list()).filter((r) => r.state === 'pending')).toHaveLength(1);
  await f.vault.close();
});
it('durably checkpoints each page and resumes without duplication after interrupted pull', async () => {
  const f = await fixture(),
    generation = crypto.randomUUID();
  const rows: SyncChange[] = [];
  for (let i = 0; i < 3; i++) {
    const c = f.command();
    rows.push({
      sequence: String(i + 1),
      movement: { ...f.first.command.payload, id: c.movementId, operationId: c.operationId },
      receipt: {
        operationId: c.operationId,
        movementId: c.movementId,
        payloadHash: await digest(canonical(c)),
        recordedAt: new Date().toISOString(),
      },
    });
  }
  const send: SyncApi['send'] = async () => {
    throw new SyncHttpError(422, 'INVALID_SYNTHETIC');
  };
  let interrupted = true;
  const api: SyncApi = {
    send,
    pull: async (cursor) => {
      const index = cursor ? Number(cursor.slice(1)) : 0;
      if (index === 1 && interrupted) throw new Error('Synthetic pull interruption');
      return {
        changes: rows.slice(index, index + 1),
        nextCursor: 'p' + Math.min(index + 1, 3),
        hasMore: index < 2,
        cursorGeneration: generation,
      };
    },
  };
  const engine = new SyncEngine(f.vault, api);
  expect(await engine.run()).toBe('retryable');
  expect((await engine.snapshot()).cursor).toBe('p1');
  expect(Object.keys((await engine.snapshot()).movements)).toHaveLength(1);
  interrupted = false;
  await f.vault.close();
  const vault = new ProductVault(await IndexedVaultStore.open(f.name), f.p);
  await vault.unlock('synthetic sync phrase');
  const resumed = new SyncEngine(vault, api);
  await resumed.run();
  await resumed.run();
  expect(Object.keys((await resumed.snapshot()).movements)).toHaveLength(3);
  expect((await resumed.snapshot()).cursor).toBe('p3');
  await vault.close();
});
