import { canonical, closed, normalizeCatalog, type CatalogEnvelope } from '../../domain/src';
import { ProductVault } from './product-vault';

/** One encrypted catalog creation intent per profile; retries preserve the P07 envelope. */
export class CatalogCreation {
  constructor(private readonly vault: ProductVault) {
    if (vault.profile.mode !== 'product') throw new Error('PRODUCT_PROFILE_REQUIRED');
  }
  async read() {
    const row = await this.vault.read<{ command: CatalogEnvelope; completed: boolean }>(
      'catalog:create:v1',
    );
    if (!row) return undefined;
    closed(row.value, ['command', 'completed']);
    if (typeof row.value.completed !== 'boolean') throw new Error('INVALID_CATALOG_INTENT');
    const command = normalizeCatalog(row.value.command);
    if (!['account.create', 'category.create'].includes(command.command.type))
      throw new Error('INVALID_CATALOG_INTENT');
    return { ...row, value: { command, completed: row.value.completed } };
  }
  async prepare(input: CatalogEnvelope) {
    const command = normalizeCatalog(input);
    if (!['account.create', 'category.create'].includes(command.command.type))
      throw new Error('INVALID_CATALOG_INTENT');
    const old = await this.read();
    if (old && !old.value.completed) {
      if (canonical(old.value.command) !== canonical(command))
        throw new Error('CATALOG_INTENT_PENDING');
      return old.value.command;
    }
    const value = { command, completed: false };
    const saved = old
      ? await this.vault.replace('catalog:create:v1', old.raw, value)
      : await this.vault.insert('catalog:create:v1', value);
    if (!saved) throw new Error('CATALOG_INTENT_CONFLICT');
    return command;
  }
  async complete(command: CatalogEnvelope) {
    const old = await this.read();
    if (!old || canonical(old.value.command) !== canonical(command))
      throw new Error('CATALOG_INTENT_CONFLICT');
    if (old.value.completed) return;
    if (!(await this.vault.replace('catalog:create:v1', old.raw, { command, completed: true })))
      throw new Error('CATALOG_INTENT_CONFLICT');
  }
}
