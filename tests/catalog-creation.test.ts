import 'fake-indexeddb/auto';
import { it, expect } from 'vitest';
import { normalizeCatalog } from '../packages/domain/src';
import { IndexedVaultStore } from '../packages/shared/src/indexed-vault';
import { ProductVault } from '../packages/shared/src/product-vault';
import { CatalogCreation } from '../packages/shared/src/catalog-creation';

it('preserves encrypted catalog intent across reopen and five retries without changing its identity', async () => {
  const name = crypto.randomUUID();
  const profile = {
    ownerId: crypto.randomUUID(),
    mode: 'product' as const,
    environment: 'synthetic',
  };
  const store = await IndexedVaultStore.open(name);
  const vault = new ProductVault(store, profile);
  await vault.create('synthetic local phrase');
  const command = normalizeCatalog({
    operationId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    schemaVersion: 1,
    baseVersion: '0',
    command: {
      type: 'account.create',
      id: crypto.randomUUID(),
      payload: {
        name: 'Synthetic private account',
        type: 'cash',
        currency: 'USD',
        state: 'active',
        position: 0,
      },
    },
  });
  const queue = new CatalogCreation(vault);
  for (let i = 0; i < 5; i++) expect(await queue.prepare(command)).toEqual(command);
  expect(JSON.stringify(await store.entries())).not.toContain('Synthetic private account');
  await expect(queue.prepare({ ...command, operationId: crypto.randomUUID() })).rejects.toThrow(
    'CATALOG_INTENT_PENDING',
  );
  await vault.close();
  const reopened = new ProductVault(await IndexedVaultStore.open(name), profile);
  await reopened.unlock('synthetic local phrase');
  const resumed = new CatalogCreation(reopened);
  expect((await resumed.read())?.value).toEqual({ command, completed: false });
  await resumed.complete(command);
  expect((await resumed.read())?.value.completed).toBe(true);
  await resumed.prepare({ ...command, operationId: crypto.randomUUID() });
  expect((await resumed.read())?.value.completed).toBe(false);
  await reopened.close();
});
