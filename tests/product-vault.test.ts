import 'fake-indexeddb/auto';
import { it, expect } from 'vitest';
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
