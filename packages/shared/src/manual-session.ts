import { Capacitor } from '@capacitor/core';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { SecureStorage, KeychainAccess } from '@aparajita/capacitor-secure-storage';
import { ProductVault, digest, type LocalProfile } from './product-vault';
import { IndexedVaultStore } from './indexed-vault';
import { NativeVaultStore } from './native-vault';
import { ManualOutbox } from './manual-outbox';
import { DomainError, identifier, canonical, type ManualCatalog } from '../../domain/src';
export const DEMO_PROFILE: LocalProfile = {
  ownerId: '00000000-0000-4000-8000-000000000008',
  environment: 'p08-preview',
  mode: 'demo',
};
export function demoManualCatalog(): ManualCatalog {
  return {
    accounts: [
      {
        id: '00000000-0000-4000-8000-000000000081',
        name: 'Efectivo DEMO',
        currency: 'PEN',
        state: 'active',
      },
      {
        id: '00000000-0000-4000-8000-000000000082',
        name: 'Cuenta USD DEMO',
        currency: 'USD',
        state: 'active',
      },
    ],
    categories: [
      {
        id: '00000000-0000-4000-8000-000000000083',
        name: 'Alimentación DEMO',
        kind: 'expense',
        state: 'active',
      },
      {
        id: '00000000-0000-4000-8000-000000000084',
        name: 'Sueldo DEMO',
        kind: 'income',
        state: 'active',
      },
    ],
    downloadedAt: new Date().toISOString(),
  };
}
export class ManualSession {
  private constructor(
    readonly vault: ProductVault,
    readonly locator: string,
  ) {}
  get outbox() {
    return new ManualOutbox(this.vault);
  }
  static profiles(): LocalProfile[] {
    try {
      const values = JSON.parse(
        localStorage.getItem('finanzas-manual-profiles-v1') ?? '[]',
      ) as unknown;
      if (!Array.isArray(values) || values.length > 100) throw new Error();
      return values.map((v) => {
        if (
          !v ||
          typeof v !== 'object' ||
          typeof v.environment !== 'string' ||
          !v.environment ||
          v.environment.length > 200 ||
          !['demo', 'product'].includes(v.mode) ||
          Object.keys(v).sort().join(',') !== 'environment,mode,ownerId'
        )
          throw new Error();
        identifier(v.ownerId);
        return v as LocalProfile;
      });
    } catch {
      throw new DomainError('PROFILE_REGISTRY_DAMAGED');
    }
  }
  static async open(profile: LocalProfile) {
    const locator = await digest(canonical(profile)),
      name = 'finanzas_manual_' + locator;
    const store = Capacitor.isNativePlatform()
      ? await NativeVaultStore.open(name)
      : await IndexedVaultStore.open(name);
    const vault = new ProductVault(store, profile);
    const known = this.profiles().some(
      (p) =>
        p.ownerId === profile.ownerId &&
        p.environment === profile.environment &&
        p.mode === profile.mode,
    );
    if (known && !(await vault.exists())) {
      await vault.close();
      throw new DomainError('VAULT_MISSING');
    }
    return new ManualSession(vault, locator);
  }
  private async credential(value: string, creating: boolean) {
    if (!Capacitor.isNativePlatform()) {
      if (value.length < 12) throw new DomainError('WEAK_LOCAL_CREDENTIAL');
      return value;
    }
    if (!/^\d{6,12}$/.test(value)) throw new DomainError('INVALID_LOCAL_PIN');
    if (!(await BiometricAuth.checkBiometry()).deviceIsSecure)
      throw new DomainError('DEVICE_LOCK_REQUIRED');
    const key = 'manual-pepper-' + this.locator;
    let pepper = await SecureStorage.get(key, false, false);
    if (pepper === null) {
      if (!creating || (await this.vault.exists())) throw new DomainError('DEVICE_KEY_MISSING');
      pepper = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
        v.toString(16).padStart(2, '0'),
      ).join('');
      await SecureStorage.set(
        key,
        pepper,
        false,
        false,
        KeychainAccess.whenPasscodeSetThisDeviceOnly,
      );
    }
    if (typeof pepper !== 'string') throw new DomainError('DEVICE_KEY_MISSING');
    return value + ':' + pepper;
  }
  async unlock(value: string) {
    await this.vault.unlock(await this.credential(value, false));
  }
  async create(value: string) {
    await this.vault.create(await this.credential(value, true));
    const profiles = ManualSession.profiles();
    if (
      !profiles.some(
        (p) =>
          p.ownerId === this.vault.profile.ownerId &&
          p.environment === this.vault.profile.environment &&
          p.mode === this.vault.profile.mode,
      )
    ) {
      try {
        localStorage.setItem(
          'finanzas-manual-profiles-v1',
          JSON.stringify([...profiles, this.vault.profile]),
        );
      } catch {
        this.vault.lock();
        throw new DomainError('PROFILE_REGISTRY_UNAVAILABLE');
      }
    }
  }
  async catalog() {
    return (await this.vault.read<ManualCatalog>('catalog'))?.value;
  }
  async saveCatalog(catalog: ManualCatalog) {
    const old = await this.vault.read('catalog');
    const saved = old
      ? await this.vault.replace('catalog', old.raw, catalog)
      : await this.vault.insert('catalog', catalog);
    if (!saved) throw new DomainError('CATALOG_CONFLICT');
  }
}
