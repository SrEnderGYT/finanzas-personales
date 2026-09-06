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
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)',
          [name, checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
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
