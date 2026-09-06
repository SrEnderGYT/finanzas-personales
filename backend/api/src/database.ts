import { Pool, type PoolClient } from 'pg';
import { UUID } from './auth';
export class UserDatabase {
  constructor(readonly pool: Pool) {}
  async assertRuntimeRole(): Promise<void> {
    const result = await this.pool.query<{ unsafe: boolean }>(`
      SELECT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb
        OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE n.nspname='app' AND pg_has_role(current_user, c.relowner, 'MEMBER'))
        OR has_schema_privilege(current_user, 'app', 'CREATE')
        OR NOT pg_has_role(current_user, 'finanzas_runtime', 'MEMBER')) AS unsafe
      FROM pg_roles r WHERE r.rolname=current_user`);
    if (result.rows[0]?.unsafe !== false) throw new Error('Unsafe database runtime role');
  }
  async asUser<T>(userId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!UUID.test(userId)) throw new Error('Invalid identity');
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      // Transaction-local identity is cleared on commit/rollback and pooled reuse.
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }
}
