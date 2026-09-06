import type { VaultStore } from './vault';
export class IndexedVaultStore implements VaultStore {
  private constructor(private readonly db: IDBDatabase) {}
  static open(name = 'finanzas-demo-vault'): Promise<IndexedVaultStore> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('vault', { keyPath: 'key' });
      request.onerror = () => reject(new Error('No se pudo abrir el almacenamiento local.'));
      request.onblocked = () =>
        reject(new Error('Cierra otras ventanas del preview y vuelve a intentar.'));
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(new IndexedVaultStore(request.result));
      };
    });
  }
  async get(key: string): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('vault', 'readonly');
      const request = tx.objectStore('vault').get(key);
      let value: string | undefined;
      request.onsuccess = () => {
        value = (request.result as { value: string } | undefined)?.value;
      };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(new Error('Lectura local interrumpida.'));
    });
  }
  async insert(key: string, value: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('vault', 'readwrite');
      const request = tx.objectStore('vault').add({ key, value });
      let duplicate = false;
      request.onerror = (e) => {
        if (request.error?.name === 'ConstraintError') {
          duplicate = true;
          e.preventDefault();
          e.stopPropagation();
        }
      };
      tx.oncomplete = () => resolve(!duplicate);
      tx.onabort = () => reject(new Error('No se guardó el comando local.'));
    });
  }
  async entries(): Promise<Array<{ key: string; value: string }>> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('vault', 'readonly');
      const request = tx.objectStore('vault').getAll();
      let entries: Array<{ key: string; value: string }> = [];
      request.onsuccess = () => {
        entries = request.result as Array<{ key: string; value: string }>;
      };
      tx.oncomplete = () => resolve(entries);
      tx.onabort = () => reject(new Error('Lectura local interrumpida.'));
    });
  }
  async close() {
    this.db.close();
  }
}
