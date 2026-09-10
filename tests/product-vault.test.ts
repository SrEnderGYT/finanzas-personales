import 'fake-indexeddb/auto';
import { it, expect, vi } from 'vitest';
import { IndexedVaultStore } from '../packages/shared/src/indexed-vault';
import { ProductVault } from '../packages/shared/src/product-vault';
it('isolates profiles, detects damage and commits one CAS winner', async () => {
  const name = crypto.randomUUID(),
    profile = { ownerId: crypto.randomUUID(), mode: 'demo' as const, environment: 'test' },
    store = await IndexedVaultStore.open(name),
    vault = new ProductVault(store, profile);
  await vault.create('synthetic passphrase');
  await vault.insert('record', { note: 'sensitive synthetic', version: 1 });
  expect(JSON.stringify(await store.entries())).not.toContain('sensitive synthetic');
  const old = (await vault.read<{ version: number }>('record'))!;
  expect(
    (
      await Promise.all([
        vault.replace('record', old.raw, { version: 2 }),
        vault.replace('record', old.raw, { version: 3 }),
      ])
    ).filter(Boolean),
  ).toHaveLength(1);
  const foreign = new ProductVault(store, { ...profile, ownerId: crypto.randomUUID() });
  await expect(foreign.unlock('synthetic passphrase')).rejects.toThrow();
  await vault.close();
  const reopened = new ProductVault(await IndexedVaultStore.open(name), profile);
  await reopened.unlock('synthetic passphrase');
  expect(await reopened.read('record')).toBeDefined();
  const current = (await reopened.read('record'))!;
  await reopened.store.compareAndSwap('record', current.raw, '{"iv":"AAAA","cipher":"AAAA"}');
  await expect(reopened.read('record')).rejects.toThrow();
  await reopened.close();
});
it('preserves data after quota errors and never restores decrypted data after locking', async () => {
  const store = await IndexedVaultStore.open(crypto.randomUUID());
  const profile = { ownerId: crypto.randomUUID(), mode: 'demo' as const, environment: 'test' };
  const vault = new ProductVault(store, profile);
  await vault.create('synthetic passphrase');
  await vault.insert('record', { value: 'synthetic' });
  const before = await store.entries();
  vi.spyOn(store, 'insert').mockRejectedValueOnce(
    new DOMException('Synthetic quota', 'QuotaExceededError'),
  );
  await expect(vault.insert('second', { value: 'synthetic' })).rejects.toThrow();
  expect(await store.entries()).toEqual(before);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const get = store.get.bind(store);
  vi.spyOn(store, 'get').mockImplementationOnce(async (id) => {
    await gate;
    return get(id);
  });
  const read = vault.read('record');
  vault.lock();
  release();
  await expect(read).rejects.toThrow('VAULT_LOCKED');
  await expect(vault.unlock('wrong synthetic phrase')).rejects.toThrow();
  expect(vault.unlocked).toBe(false);
  expect(await store.entries()).toEqual(before);
  await vault.close();
});
