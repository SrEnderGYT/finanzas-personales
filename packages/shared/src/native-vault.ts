import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { SecureStorage, KeychainAccess } from '@aparajita/capacitor-secure-storage';
import { BiometricAuth, AndroidBiometryStrength } from '@aparajita/capacitor-biometric-auth';
import type { VaultStore } from './vault';

export async function nativePepper(): Promise<string> {
  if (!Capacitor.isNativePlatform())
    throw new Error('El almacén seguro nativo no está disponible en navegador.');
  if (!(await BiometricAuth.checkBiometry()).deviceIsSecure)
    throw new Error('Configura primero el bloqueo del dispositivo.');
  const key = 'finanzas-prototype-device-pepper-v1';
  const found = await SecureStorage.get(key, false, false);
  if (typeof found === 'string') return found;
  if (found !== null) throw new Error('Clave de dispositivo inválida.');
  const value = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  await SecureStorage.set(key, value, false, false, KeychainAccess.whenPasscodeSetThisDeviceOnly);
  return value;
}
export async function verifyNativeBiometry(): Promise<string> {
  if (!Capacitor.isNativePlatform())
    throw new Error('Face ID, Touch ID y biometría requieren la app nativa instalada.');
  const status = await BiometricAuth.checkBiometry();
  if (!status.strongBiometryIsAvailable)
    throw new Error('No hay biometría fuerte inscrita y disponible en este dispositivo.');
  await BiometricAuth.authenticate({
    reason: 'Verificar biometría del prototipo Finanzas DEMO',
    androidTitle: 'Finanzas DEMO',
    androidBiometryStrength: AndroidBiometryStrength.strong,
    allowDeviceCredential: false,
    cancelTitle: 'Cancelar',
  });
  return 'Biometría verificada. El PIN local sigue siendo necesario para descifrar la bóveda.';
}
export class NativeVaultStore implements VaultStore {
  private constructor(
    private readonly connection: SQLiteConnection,
    private readonly db: SQLiteDBConnection,
    private readonly name = 'finanzas_prototype',
  ) {}
  static async open(name = 'finanzas_prototype'): Promise<NativeVaultStore> {
    if (!/^finanzas_[a-z0-9_]{1,90}$/.test(name)) throw new Error('Nombre de bóveda inválido.');
    if (!Capacitor.isNativePlatform())
      throw new Error('SQLite cifrada sólo se utiliza en la aplicación nativa.');
    const connection = new SQLiteConnection(CapacitorSQLite);
    if (!(await connection.isSecretStored()).result) {
      let databases: string[];
      try {
        databases = (await connection.getDatabaseList()).values ?? [];
      } catch (error) {
        // Android plugin 8.1.1 signals a fresh empty installation with this exact error.
        // Other failures are not evidence that it is safe to create a new key.
        if (
          !(error instanceof Error) ||
          error.message.trim() !== 'getDatabaseList: No databases available'
        )
          throw error;
        databases = [];
      }
      if (databases.length)
        throw new Error('Falta la clave de cifrado de una base existente. No se recreó.');
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
        n.toString(16).padStart(2, '0'),
      ).join('');
      await connection.setEncryptionSecret(secret);
    }
    const db = await connection.createConnection(name, true, 'secret', 1, false);
    await db.open();
    // Local prototype migration v1; deliberately separate from future PostgreSQL migrations.
    await db.execute(
      'CREATE TABLE IF NOT EXISTS prototype_v1 (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);',
    );
    if (!(await connection.isDatabaseEncrypted(name)).result) {
      await connection.closeConnection(name, false);
      throw new Error('La base nativa no confirmó cifrado. No se admiten escrituras.');
    }
    return new NativeVaultStore(connection, db, name);
  }
  async get(key: string): Promise<string | undefined> {
    const result = await this.db.query('SELECT value FROM prototype_v1 WHERE key = ?;', [key]);
    const row = result.values?.[0] as { value?: unknown } | undefined;
    return typeof row?.value === 'string' ? row.value : undefined;
  }
  async insert(key: string, value: string): Promise<boolean> {
    const result = await this.db.run(
      'INSERT INTO prototype_v1 (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING;',
      [key, value],
    );
    return result.changes?.changes === 1;
  }
  async entries(): Promise<Array<{ key: string; value: string }>> {
    const result = await this.db.query('SELECT key,value FROM prototype_v1;');
    return (result.values ?? []) as Array<{ key: string; value: string }>;
  }
  async close() {
    await this.connection.closeConnection(this.name, false);
  }
  async compareAndSwap(key: string, expected: string, value: string): Promise<boolean> {
    const result = await this.db.run('UPDATE prototype_v1 SET value=? WHERE key=? AND value=?;', [
      value,
      key,
      expected,
    ]);
    return result.changes?.changes === 1;
  }
}
