import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL, URL } from 'node:url';
import process from 'node:process';
import pg from 'pg';

export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(7040401)');
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query('REVOKE ALL ON public.schema_migrations FROM PUBLIC');
    const directory = new URL('../backend/api/migrations/', import.meta.url);
    const names = (await readdir(directory))
      .filter((name) => /^\d{3}_[a-z_]+\.sql$/.test(name))
      .sort();
    const applied = await client.query(
      'SELECT name, checksum FROM public.schema_migrations ORDER BY name',
    );
    const role = await client.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user');
    if (applied.rows.some((row) => !names.includes(row.name)))
      throw new Error('Unknown migration history');
    for (const name of names) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.rows.find((row) => row.name === name);
      if (previous) {
        if (previous.checksum !== checksum) throw new Error('Applied migration changed');
        continue;
      }
      if (applied.rows.some((row) => row.name > name)) throw new Error('Out-of-order migration');
      await client.query('BEGIN');
      try {
        // PostgreSQL managed owners are not superusers. Transferring the narrowly
        // scoped SECURITY DEFINER function needs SET ROLE and CREATE on its schema
        // during the transfer only. Preserve the immutable migration/checksum and
        // revoke both temporary privileges before this transaction can commit.
        let execution = sql;
        if (name === '002_sessions.sql' && role.rows[0]?.rolsuper === false) {
          const transfer =
            'ALTER FUNCTION app.resolve_session(text) OWNER TO finanzas_session_lookup;';
          if (sql.split(transfer).length !== 2)
            throw new Error('Unexpected session migration contract');
          execution = sql.replace(
            transfer,
            `
GRANT finanzas_session_lookup TO CURRENT_USER WITH SET TRUE;
GRANT CREATE ON SCHEMA app TO finanzas_session_lookup;
${transfer}
REVOKE CREATE ON SCHEMA app FROM finanzas_session_lookup;
GRANT finanzas_session_lookup TO CURRENT_USER WITH SET FALSE;
`,
          );
        }
        await client.query(execution);
        await client.query(
          'INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)',
          [name, checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        // Structural diagnostics only: never include SQL, parameters or connection data.
        error.migrationName = name;
        throw error;
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(7040401)');
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL required');
  const pool = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    await migrate(pool);
    process.stdout.write('Migrations applied\n');
  } catch {
    process.stderr.write('Migration failed; no credentials or SQL details logged\n');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
