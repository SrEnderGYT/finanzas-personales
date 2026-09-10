import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { IndexedVaultStore } from '../packages/shared/src/indexed-vault';
import { ProductVault } from '../packages/shared/src/product-vault';
import { ManualOutbox } from '../packages/shared/src/manual-outbox';
const fixture = () => {
  const id = crypto.randomUUID(),
    accountId = crypto.randomUUID(),
    categoryId = crypto.randomUUID();
  return {
    command: {
      operationId: id,
      movementId: id,
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
    },
    catalog: {
      accounts: [
        { id: accountId, name: 'DEMO', currency: 'PEN' as const, state: 'active' as const },
      ],
      categories: [
        { id: categoryId, name: 'DEMO', kind: 'expense' as const, state: 'active' as const },
      ],
      downloadedAt: '2026-01-01T12:00:00Z',
    },
  };
};
it('reopens exactly one encrypted pending with mandatory financial dates after five retries', async () => {
  const name = crypto.randomUUID(),
    profile = { ownerId: crypto.randomUUID(), mode: 'demo' as const, environment: 'test' },
    vault = new ProductVault(await IndexedVaultStore.open(name), profile);
  await vault.create('synthetic passphrase');
  const outbox = new ManualOutbox(vault),
    f = fixture();
  await Promise.all(Array.from({ length: 5 }, () => outbox.enqueue(f.command, f.catalog)));
  await expect(
    outbox.enqueue(
      { ...f.command, payload: { ...f.command.payload, businessDate: '2026-01-02' } },
      f.catalog,
    ),
  ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  await vault.close();
  const reopened = new ProductVault(await IndexedVaultStore.open(name), profile);
  await reopened.unlock('synthetic passphrase');
  const rows = await new ManualOutbox(reopened).list();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    state: 'pending',
    command: { payload: { businessDate: '2026-01-01', timezone: 'America/Lima' } },
  });
  await reopened.close();
});
it('recovers expired leases without changing IDs and requires a matching real-result contract', async () => {
  const profile = { ownerId: crypto.randomUUID(), mode: 'demo' as const, environment: 'test' },
    vault = new ProductVault(await IndexedVaultStore.open(crypto.randomUUID()), profile);
  await vault.create('synthetic passphrase');
  let time = new Date('2026-09-09T12:00:00Z');
  const outbox = new ManualOutbox(vault, { now: () => time }),
    f = fixture(),
    row = await outbox.enqueue(f.command, f.catalog),
    attempt = crypto.randomUUID();
  await outbox.claim(f.command.operationId, attempt);
  await expect(outbox.claim(f.command.operationId, crypto.randomUUID())).rejects.toThrow();
  time = new Date(time.getTime() + 60001);
  await outbox.recoverExpired(f.command.operationId);
  const next = crypto.randomUUID();
  await outbox.claim(f.command.operationId, next);
  await expect(
    outbox.finish(f.command.operationId, attempt, profile.ownerId, 'transient'),
  ).rejects.toThrow('STALE_ATTEMPT');
  await expect(
    outbox.finish(f.command.operationId, next, crypto.randomUUID(), 'transient'),
  ).rejects.toThrow('PROFILE_MISMATCH');
  await expect(
    outbox.finish(f.command.operationId, next, profile.ownerId, {
      operationId: f.command.operationId,
      movementId: f.command.movementId,
      payloadHash: 'bad',
      recordedAt: time.toISOString(),
    }),
  ).rejects.toThrow('ACK_MISMATCH');
  await outbox.finish(f.command.operationId, next, profile.ownerId, {
    operationId: f.command.operationId,
    movementId: f.command.movementId,
    payloadHash: row.hash,
    recordedAt: time.toISOString(),
  });
  expect((await outbox.list())[0]?.state).toBe('confirmed');
  await expect(outbox.claim(f.command.operationId, crypto.randomUUID())).rejects.toThrow();
  await vault.close();
});
