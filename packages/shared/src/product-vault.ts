import { canonical, identifier, DomainError } from '../../domain/src';
import { deriveVaultKey, seal, unseal, type CipherEnvelope, type MutableVaultStore } from './vault';
export interface LocalProfile {
  ownerId: string;
  environment: string;
  mode: 'demo' | 'product';
}
export async function digest(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export class ProductVault {
  private key: CryptoKey | undefined;
  private generation = 0;
  readonly scope: string;
  readonly profile: Readonly<LocalProfile>;
  constructor(
    readonly store: MutableVaultStore,
    profile: LocalProfile,
  ) {
    identifier(profile.ownerId);
    if (
      !['demo', 'product'].includes(profile.mode) ||
      !profile.environment ||
      profile.environment.length > 200
    )
      throw new DomainError('INVALID_PROFILE');
    this.profile = Object.freeze({ ...profile });
    this.scope = canonical({ ...this.profile, version: 1 });
  }
  get unlocked() {
    return this.key !== undefined;
  }
  async exists() {
    return (await this.store.get('metadata')) !== undefined;
  }
  async create(credential: string) {
    if (credential.length < 12) throw new DomainError('WEAK_LOCAL_CREDENTIAL');
    if ((await this.store.entries()).length) throw new DomainError('VAULT_EXISTS_OR_DAMAGED');
    const generation = this.generation,
      salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))),
      key = await deriveVaultKey(credential, salt);
    const verifier = await seal(key, this.scope + ':metadata', this.scope);
    if (!(await this.store.insert('metadata', JSON.stringify({ version: 1, salt, verifier }))))
      throw new DomainError('VAULT_EXISTS');
    if (generation !== this.generation) throw new DomainError('VAULT_LOCKED');
    this.key = key;
  }
  async unlock(credential: string) {
    this.lock();
    const generation = this.generation,
      raw = await this.store.get('metadata');
    if (!raw) throw new DomainError('VAULT_MISSING');
    const m = JSON.parse(raw) as { version: number; salt: string; verifier: CipherEnvelope };
    if (m.version !== 1) throw new DomainError('VAULT_VERSION');
    const key = await deriveVaultKey(credential, m.salt);
    if ((await unseal(key, this.scope + ':metadata', m.verifier)) !== this.scope)
      throw new DomainError('PROFILE_MISMATCH');
    if (generation !== this.generation) throw new DomainError('VAULT_LOCKED');
    this.key = key;
  }
  lock() {
    this.key = undefined;
    this.generation++;
  }
  private active() {
    if (!this.key) throw new DomainError('VAULT_LOCKED');
    return { key: this.key, generation: this.generation };
  }
  async read<T>(id: string): Promise<{ raw: string; value: T } | undefined> {
    const active = this.active(),
      raw = await this.store.get(id);
    if (!raw) return undefined;
    const value = JSON.parse(
      await unseal(active.key, this.scope + ':' + id, JSON.parse(raw) as CipherEnvelope),
    ) as T;
    if (active.generation !== this.generation) throw new DomainError('VAULT_LOCKED');
    return { raw, value };
  }
  async insert(id: string, value: unknown) {
    const active = this.active(),
      cipher = await seal(active.key, this.scope + ':' + id, canonical(value));
    if (active.generation !== this.generation) throw new DomainError('VAULT_LOCKED');
    return this.store.insert(id, JSON.stringify(cipher));
  }
  async replace(id: string, raw: string, value: unknown) {
    const active = this.active(),
      cipher = await seal(active.key, this.scope + ':' + id, canonical(value));
    if (active.generation !== this.generation) throw new DomainError('VAULT_LOCKED');
    return this.store.compareAndSwap(id, raw, JSON.stringify(cipher));
  }
  async ids(prefix: string) {
    const active = this.active(),
      rows = await this.store.entries();
    if (active.generation !== this.generation) throw new DomainError('VAULT_LOCKED');
    return rows.filter((r) => r.key.startsWith(prefix)).map((r) => r.key);
  }
  async close() {
    this.lock();
    await this.store.close();
  }
}
