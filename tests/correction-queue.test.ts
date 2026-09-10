import 'fake-indexeddb/auto';
import { it, expect, vi } from 'vitest';
import { normalizeCorrection } from '../packages/domain/src';
import { IndexedVaultStore } from '../packages/shared/src/indexed-vault';
import { ProductVault } from '../packages/shared/src/product-vault';
import { CorrectionQueue, type CorrectionApi } from '../packages/shared/src/correction-queue';
async function fixture() {
  const profile = {
    ownerId: crypto.randomUUID(),
    environment: 'synthetic',
    mode: 'product' as const,
  };
  const name = crypto.randomUUID(),
    deviceId = crypto.randomUUID();
  const vault = new ProductVault(await IndexedVaultStore.open(name), profile);
  await vault.create('synthetic correction phrase');
  const queue = new CorrectionQueue(vault);
  const command = normalizeCorrection(
    {
      operationId: crypto.randomUUID(),
      deviceId,
      schemaVersion: 1,
      rootId: crypto.randomUUID(),
      expectedVersion: '1',
      reason: 'Synthetic correction',
      action: 'replace',
      reversalId: crypto.randomUUID(),
      reversalOperationId: crypto.randomUUID(),
      businessDate: '2026-01-02',
      timezone: 'America/Lima',
      replacement: {
        operationId: crypto.randomUUID(),
        deviceId,
        movementId: crypto.randomUUID(),
        schemaVersion: 1,
        baseVersion: '0',
        payload: {
          kind: 'expense',
          accountId: crypto.randomUUID(),
          categoryId: crypto.randomUUID(),
          amountMinor: '30',
          currency: 'PEN',
          businessDate: '2026-01-01',
          timezone: 'America/Lima',
        },
      },
    },
    { now: () => new Date() },
  );
  const row = await queue.enqueue(command);
  if (command.action !== 'replace') throw new Error();
  const server = {
    rootId: command.rootId,
    version: '2',
    movementId: command.replacement.movementId,
    payload: command.replacement.payload,
  };
  const result = {
    status: 'applied',
    action: 'replace',
    operationId: command.operationId,
    payloadHash: row.hash,
    server,
  };
  const api: CorrectionApi = { current: async () => server, execute: vi.fn(async () => result) };
  return { profile, name, vault, queue, command, row, server, result, api };
}
it('lost response followed by reopen and five retries uses one durable correction identity', async () => {
  const f = await fixture();
  const execute = vi
    .fn()
    .mockRejectedValueOnce(new Error('Synthetic response lost after commit'))
    .mockResolvedValue(f.result);
  f.api.execute = execute;
  await expect(
    f.queue.send(f.command.operationId, f.api, new AbortController().signal),
  ).rejects.toThrow();
  expect((await f.queue.list())[0]!.state).toBe('retryable');
  await f.vault.close();
  const vault = new ProductVault(await IndexedVaultStore.open(f.name), f.profile);
  await vault.unlock('synthetic correction phrase');
  const queue = new CorrectionQueue(vault);
  for (let i = 0; i < 5; i++)
    expect(
      (await queue.send(f.command.operationId, f.api, new AbortController().signal)).state,
    ).toBe('applied');
  expect(execute).toHaveBeenCalledTimes(2);
  expect(
    execute.mock.calls.every(([command]) => command.operationId === f.command.operationId),
  ).toBe(true);
  expect(await queue.list()).toHaveLength(1);
  expect(JSON.stringify(await vault.store.entries())).not.toContain('amountMinor');
  await vault.close();
});
it('five concurrent sends acquire one lease, and changed payload with the same id is rejected', async () => {
  const f = await fixture();
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      f.queue.send(f.command.operationId, f.api, new AbortController().signal),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(f.api.execute).toHaveBeenCalledTimes(1);
  await expect(f.queue.enqueue({ ...f.command, reason: 'Changed intent' })).rejects.toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  expect((await f.queue.list())[0]!.command).toEqual(f.command);
  await f.vault.close();
});
it('conflict preserves both versions and explicit state after reopening; mismatched acknowledgements never apply', async () => {
  const f = await fixture();
  f.api.execute = async () => ({
    ...f.result,
    server: { ...f.server, payload: { ...f.server.payload, amountMinor: '999' } },
  });
  await expect(
    f.queue.send(f.command.operationId, f.api, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'ACK_MISMATCH' });
  expect((await f.queue.list())[0]!.state).toBe('retryable');
  const conflict = {
    status: 'conflict',
    operationId: f.command.operationId,
    payloadHash: f.row.hash,
    server: { ...f.server, payload: { ...f.server.payload, amountMinor: '20' } },
    local: f.command,
    differentFields: ['amountMinor'],
  };
  f.api.execute = async () => conflict;
  await f.queue.send(f.command.operationId, f.api, new AbortController().signal);
  await f.vault.close();
  const reopened = new ProductVault(await IndexedVaultStore.open(f.name), f.profile);
  await reopened.unlock('synthetic correction phrase');
  expect((await new CorrectionQueue(reopened).list())[0]).toMatchObject({
    state: 'requires_review',
    result: conflict,
  });
  await reopened.close();
});
it('locking during a response preserves a recoverable lease and prevents decrypted state from returning', async () => {
  const f = await fixture();
  f.api.execute = async () => {
    f.vault.lock();
    return f.result;
  };
  await expect(
    f.queue.send(f.command.operationId, f.api, new AbortController().signal),
  ).rejects.toThrow();
  await f.vault.unlock('synthetic correction phrase');
  expect((await f.queue.list())[0]!.state).toBe('sending');
  const later = new CorrectionQueue(f.vault, { now: () => new Date(Date.now() + 61000) });
  f.api.execute = async () => f.result;
  expect((await later.send(f.command.operationId, f.api, new AbortController().signal)).state).toBe(
    'applied',
  );
  await f.vault.close();
});
