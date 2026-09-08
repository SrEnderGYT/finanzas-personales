import { Pool } from 'pg';
import { createApp } from './app';
import { denyIdentity } from './auth';
import { UserDatabase } from './database';
import { SessionAuthority } from './sessions';
import { EmailAuth } from './email-auth';
import { EmailOutbox } from './email-outbox';
import { GoogleAuth } from './google-auth';
import { LiveGoogleProvider } from './google-provider';
import { MfaLogin } from './mfa-login';
import { MfaStore } from './mfa-store';
import { MfaSecrets } from './mfa-secrets';
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
  const authPool = new Pool({
    connectionString: required('AUTH_DATABASE_URL'),
    max: 5,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  });
  authPool.on('error', () => process.stderr.write('Authentication database unavailable\n'));
  try {
    const database = new UserDatabase(pool);
    await database.assertRuntimeRole();
    // Legacy JWT exchange is disabled in the real server. Email/Google login issue sessions internally.
    const sessions = new SessionAuthority(database, denyIdentity);
    const emailAuth = new EmailAuth(
      authPool,
      new EmailOutbox(Buffer.from(required('AUTH_MAIL_KEY'), 'base64')),
    );
    await emailAuth.assertRole();
    const googleAuth = process.env['GOOGLE_CLIENT_ID']
      ? new GoogleAuth(
          authPool,
          sessions,
          new LiveGoogleProvider(
            required('GOOGLE_CLIENT_ID'),
            required('GOOGLE_CLIENT_SECRET'),
            required('GOOGLE_REDIRECT_URI'),
          ),
          Buffer.from(required('GOOGLE_FLOW_KEY'), 'base64'),
          new URL(required('GOOGLE_REDIRECT_URI')).origin,
        )
      : undefined;
    const nativeGoogleAuth = process.env['NATIVE_GOOGLE_CLIENT_ID']
      ? new GoogleAuth(
          authPool,
          sessions,
          new LiveGoogleProvider(
            required('NATIVE_GOOGLE_CLIENT_ID'),
            required('NATIVE_GOOGLE_CLIENT_SECRET'),
            required('NATIVE_GOOGLE_REDIRECT_URI'),
          ),
          Buffer.from(required('NATIVE_GOOGLE_FLOW_KEY'), 'base64'),
          new URL(required('NATIVE_GOOGLE_REDIRECT_URI')).origin,
        )
      : undefined;
    const app = await createApp({
      database,
      identity: sessions,
      sessions,
      emailAuth,
      googleAuth,
      nativeGoogleAuth,
      mfaLogin: process.env['MFA_ENCRYPTION_KEY']
        ? new MfaLogin(
            authPool,
            new MfaStore(
              authPool,
              new MfaSecrets(Buffer.from(required('MFA_ENCRYPTION_KEY'), 'base64')),
            ),
          )
        : undefined,
      log: (event) => process.stdout.write(JSON.stringify(event) + '\n'),
    });
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => {
        void app.close().then(() => Promise.all([pool.end(), authPool.end()]));
      });
    }
    await app.listen(Number(process.env['PORT'] ?? 3000), process.env['HOST'] ?? '127.0.0.1');
  } catch {
    await pool.end();
    await authPool.end();
    throw new Error('Server startup failed; check secure configuration');
  }
}
void main().catch(() => {
  process.stderr.write('Server startup failed; check secure configuration\n');
  process.exitCode = 1;
});
