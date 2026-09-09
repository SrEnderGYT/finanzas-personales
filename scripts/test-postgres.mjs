import { randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';
import { execFileSync, spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { migrate } from './migrate.mjs';

// Isolated disposable database. Never uses an existing DATABASE_URL or real user data.
const name = `finanzas-p04-${randomUUID()}`;
const password = randomBytes(32).toString('hex');
const runtimePassword = randomBytes(32).toString('hex');
const authPassword = randomBytes(32).toString('hex');
const browserMode = process.argv.includes('--browser');
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, POSTGRES_PASSWORD: password },
  }).trim();
let started = false;
let pool;
try {
  docker('info', '--format', '{{.ServerVersion}}');
  docker(
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--label',
    'app=finanzas-p04-tests',
    '--env',
    'POSTGRES_PASSWORD',
    '--env',
    'POSTGRES_DB=finanzas_test',
    '--publish',
    '127.0.0.1::5432',
    'postgres:17.11-bookworm',
  );
  started = true;
  const port = docker('port', name, '5432/tcp').split(':').at(-1);
  const adminUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/finanzas_test`;
  pool = new pg.Pool({ connectionString: adminUrl, connectionTimeoutMillis: 2000 });
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    try {
      await pool.query('SELECT 1');
      ready = true;
      break;
    } catch {
      await setTimeout(1000);
    }
  }
  if (!ready) throw new Error('PostgreSQL unavailable');
  await migrate(pool);
  await migrate(pool);
  // Random hexadecimal secret, never persisted or printed. Role provisioning is infrastructure.
  await pool.query(
    `CREATE ROLE finanzas_api LOGIN PASSWORD '${runtimePassword}' IN ROLE finanzas_runtime`,
  );
  await pool.query(
    `CREATE ROLE finanzas_auth_api LOGIN PASSWORD '${authPassword}' IN ROLE finanzas_auth_runtime`,
  );
  const result = spawnSync(
    process.execPath,
    browserMode
      ? ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.auth.config.ts']
      : [
          'node_modules/vitest/vitest.mjs',
          'run',
          'tests/postgres.integration.test.ts',
          'tests/ledger.integration.test.ts',
          'tests/catalog.integration.test.ts',
          'tests/catalog-api.integration.test.ts',
          'tests/sessions.integration.test.ts',
          'tests/email-auth.integration.test.ts',
          'tests/google-auth.integration.test.ts',
          'tests/mfa-store.integration.test.ts',
          'tests/mfa-login.integration.test.ts',
        ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        P04_TEST_ADMIN_URL: adminUrl,
        P04_TEST_DATABASE_URL: `postgresql://finanzas_api:${runtimePassword}@127.0.0.1:${port}/finanzas_test`,
        P05_TEST_AUTH_URL: `postgresql://finanzas_auth_api:${authPassword}@127.0.0.1:${port}/finanzas_test`,
      },
    },
  );
  process.exitCode = result.status ?? 1;
} catch (error) {
  const diagnostic = {
    migration: /^\d{3}_[a-z_]+\.sql$/.test(error?.migrationName ?? '')
      ? error.migrationName
      : undefined,
    sqlState: /^[A-Z0-9]{5}$/.test(error?.code ?? '') ? error.code : undefined,
    position: /^\d+$/.test(error?.position ?? '') ? error.position : undefined,
  };
  process.stderr.write(JSON.stringify(diagnostic) + '\n');
  process.stderr.write(
    'PostgreSQL integration failed. Requires Docker and the pinned image; connection secrets suppressed.\n',
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
  if (started) docker('stop', name);
}
