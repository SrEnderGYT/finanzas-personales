import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { IndexedVaultStore } from '../packages/shared/src/indexed-vault';
import { PrototypeVault, deriveVaultKey, seal, unseal } from '../packages/shared/src/vault';

describe('encrypted prototype storage', () => {
  it('persists ciphertext, locks, reopens, and keeps five retries as one pending command', async () => {
    const name = crypto.randomUUID(),
      store = await IndexedVaultStore.open(name),
      vault = new PrototypeVault(store);
    await vault.create('synthetic test passphrase');
    const op = {
      id: crypto.randomUUID(),
      demo: true as const,
      minor: '12345',
      currency: 'PEN' as const,
      kind: 'expense' as const,
      status: 'pending' as const,
    };
    await Promise.all(Array.from({ length: 5 }, () => vault.append(op)));
    expect((await vault.operations()).length).toBe(1);
    expect(JSON.stringify(await store.entries())).not.toContain('12345');
    expect(JSON.stringify(await store.entries())).not.toContain('synthetic test passphrase');
    await expect(vault.append({ ...op, minor: '22222' })).rejects.toThrow('Conflicto');
    vault.lock();
    await expect(vault.operations()).rejects.toThrow('bloqueada');
    await vault.close();
    const reopened = new PrototypeVault(await IndexedVaultStore.open(name));
    await expect(reopened.unlock('wrong passphrase')).rejects.toThrow();
    expect(reopened.unlocked).toBe(false);
    await reopened.unlock('synthetic test passphrase');
    expect(await reopened.operations()).toEqual([op]);
    await reopened.close();
  });
  it('rejects modified ciphertext and moving a ciphertext to a different ID', async () => {
    const salt = btoa('1234567890123456');
    const key = await deriveVaultKey('test only synthetic', salt);
    const encrypted = await seal(key, 'id-one', 'DEMO');
    await expect(unseal(key, 'id-two', encrypted)).rejects.toThrow();
    const altered = {
      ...encrypted,
      cipher: (encrypted.cipher[0] === 'A' ? 'B' : 'A') + encrypted.cipher.slice(1),
    };
    await expect(unseal(key, 'id-one', altered)).rejects.toThrow();
    expect(key.extractable).toBe(false);
  });
});
