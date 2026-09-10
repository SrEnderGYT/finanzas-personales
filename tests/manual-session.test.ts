import 'fake-indexeddb/auto';
import { it, expect, vi, afterEach } from 'vitest';
import { ManualSession, demoManualCatalog } from '../packages/shared/src/manual-session';
afterEach(() => vi.unstubAllGlobals());
it('keeps profiles isolated and refuses to recreate a known missing vault', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  });
  const a = { ownerId: crypto.randomUUID(), environment: 'synthetic', mode: 'product' as const };
  const b = { ...a, ownerId: crypto.randomUUID() };
  const first = await ManualSession.open(a);
  await first.create('synthetic passphrase');
  await first.saveCatalog(demoManualCatalog());
  const other = await ManualSession.open(b);
  await other.create('other synthetic passphrase');
  expect(await other.catalog()).toBeUndefined();
  await other.vault.close();
  await first.vault.close();
  const reopened = await ManualSession.open(a);
  await reopened.unlock('synthetic passphrase');
  expect((await reopened.catalog())?.accounts).toHaveLength(2);
  await reopened.vault.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('finanzas_manual_' + first.locator);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  await expect(ManualSession.open(a)).rejects.toThrow('VAULT_MISSING');
  expect(ManualSession.profiles()).toHaveLength(2);
});
