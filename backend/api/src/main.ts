import { Pool } from 'pg';
import { createApp } from './app';
import { JwtIdentityVerifier } from './auth';
import { UserDatabase } from './database';
async function main() {
  const required = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error('Missing server configuration');
    return value;
  };
  const pool = new Pool({
    connectionString: required('DATABASE_URL'),
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    idle_in_transaction_session_timeout: 5000,
  });
  pool.on('error', () => process.stderr.write('Database connection unavailable\n'));
  try {
    const database = new UserDatabase(pool);
    await database.assertRuntimeRole();
    const identity = new JwtIdentityVerifier(
      JSON.parse(required('AUTH_PUBLIC_JWKS')),
      required('AUTH_ISSUER'),
      required('AUTH_AUDIENCE'),
    );
    const app = await createApp({
      database,
      identity,
      log: (event) => process.stdout.write(JSON.stringify(event) + '\n'),
    });
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => {
        void app.close().then(() => pool.end());
      });
    }
    await app.listen(Number(process.env['PORT'] ?? 3000), process.env['HOST'] ?? '127.0.0.1');
  } catch {
    await pool.end();
    throw new Error('Server startup failed; check secure configuration');
  }
}
void main().catch(() => {
  process.stderr.write('Server startup failed; check secure configuration\n');
  process.exitCode = 1;
});
