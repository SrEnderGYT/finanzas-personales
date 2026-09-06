export interface CipherEnvelope {
  iv: string;
  cipher: string;
}
export interface PrototypeOperation {
  id: string;
  demo: true;
  minor: string;
  currency: 'PEN' | 'USD';
  kind: 'expense';
  status: 'pending';
}
export interface VaultStore {
  get(key: string): Promise<string | undefined>;
  insert(key: string, value: string): Promise<boolean>;
  entries(): Promise<Array<{ key: string; value: string }>>;
  close(): Promise<void>;
}
const encoder = new TextEncoder();
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function decode(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array([...atob(text)].map((c) => c.charCodeAt(0)));
}
function aad(id: string) {
  return encoder.encode(`finanzas-prototype:v1:${id}`);
}
export async function deriveVaultKey(passphrase: string, salt: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: decode(salt), iterations: 600000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function seal(key: CryptoKey, id: string, value: string): Promise<CipherEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(id) },
    key,
    encoder.encode(value),
  );
  return { iv: encode(iv), cipher: encode(new Uint8Array(cipher)) };
}
export async function unseal(
  key: CryptoKey,
  id: string,
  envelope: CipherEnvelope,
): Promise<string> {
  const bytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decode(envelope.iv), additionalData: aad(id) },
    key,
    decode(envelope.cipher),
  );
  return new TextDecoder().decode(bytes);
}
export class PrototypeVault {
  private key: CryptoKey | undefined;
  private generation = 0;
  constructor(private readonly store: VaultStore) {}
  get unlocked() {
    return this.key !== undefined;
  }
  async exists() {
    return (await this.store.get('metadata')) !== undefined;
  }
  async create(credential: string) {
    const generation = this.generation;
    if (await this.exists())
      throw new Error('La bóveda ya existe. Desbloquéala sin sobrescribir datos.');
    const salt = encode(crypto.getRandomValues(new Uint8Array(16)));
    const key = await deriveVaultKey(credential, salt);
    const verifier = await seal(key, 'metadata', 'synthetic-prototype-v1');
    if (!(await this.store.insert('metadata', JSON.stringify({ version: 1, salt, verifier }))))
      throw new Error('Otra ventana ya creó la bóveda. Vuelve a desbloquear.');
    if (generation !== this.generation)
      throw new Error('Bóveda creada y bloqueada al cambiar de aplicación.');
    this.key = key;
  }
  async unlock(credential: string) {
    this.lock();
    const generation = this.generation;
    const raw = await this.store.get('metadata');
    if (!raw) throw new Error('Primero crea la bóveda de prueba.');
    const metadata = JSON.parse(raw) as { version: number; salt: string; verifier: CipherEnvelope };
    if (metadata.version !== 1)
      throw new Error('Versión no compatible. No se modificaron los datos.');
    const key = await deriveVaultKey(credential, metadata.salt);
    if ((await unseal(key, 'metadata', metadata.verifier)) !== 'synthetic-prototype-v1')
      throw new Error('No se pudo desbloquear.');
    if (generation !== this.generation)
      throw new Error('La aplicación se bloqueó durante el desbloqueo.');
    this.key = key;
  }
  lock() {
    this.key = undefined;
    this.generation++;
  }
  async append(operation: PrototypeOperation) {
    const key = this.key;
    if (!key) throw new Error('Bóveda bloqueada.');
    if (
      operation.demo !== true ||
      !/^\d+$/.test(operation.minor) ||
      BigInt(operation.minor) <= 0n ||
      !['PEN', 'USD'].includes(operation.currency) ||
      operation.kind !== 'expense' ||
      operation.status !== 'pending' ||
      !operation.id
    )
      throw new Error('Sólo se admiten comandos DEMO válidos.');
    const id = `operation:${operation.id}`;
    const json = JSON.stringify(operation);
    const sealed = await seal(key, id, json);
    if (!(await this.store.insert(id, JSON.stringify(sealed)))) {
      const old = await this.store.get(id);
      if (!old || (await unseal(key, id, JSON.parse(old) as CipherEnvelope)) !== json)
        throw new Error('Conflicto: mismo ID con datos distintos. No se sobrescribió dinero.');
    }
  }
  async operations(): Promise<PrototypeOperation[]> {
    const key = this.key;
    const generation = this.generation;
    if (!key) throw new Error('Bóveda bloqueada.');
    const values = await this.store.entries();
    const rows: PrototypeOperation[] = [];
    for (const item of values)
      if (item.key.startsWith('operation:'))
        rows.push(
          JSON.parse(
            await unseal(key, item.key, JSON.parse(item.value) as CipherEnvelope),
          ) as PrototypeOperation,
        );
    if (generation !== this.generation) throw new Error('Bóveda bloqueada.');
    return rows;
  }
  async close() {
    this.lock();
    await this.store.close();
  }
}
