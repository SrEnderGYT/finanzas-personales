import { Pool } from 'pg';
import { EmailOutbox } from './email-outbox';
import { EmailAuth } from './email-auth';

async function deliver() {
  const required = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error('Missing configuration');
    return value;
  };
  const target = new URL(required('AUTH_MAIL_WEBHOOK'));
  if (target.protocol !== 'https:' || target.username || target.password)
    throw new Error('HTTPS mail transport required');
  const authorization = required('AUTH_MAIL_WEBHOOK_TOKEN');
  const outbox = new EmailOutbox(Buffer.from(required('AUTH_MAIL_KEY'), 'base64'));
  const pool = new Pool({
    connectionString: required('AUTH_DATABASE_URL'),
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    await new EmailAuth(pool, outbox).assertRole();
    let count = 0;
    while (
      count < 25 &&
      (await outbox.deliverOne(pool, async (mail) => {
        const response = await fetch(target, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
          headers: { Authorization: 'Bearer ' + authorization, 'Content-Type': 'application/json' },
          body: JSON.stringify(mail),
        });
        if (!response.ok) throw new Error('Transport failed');
        await response.body?.cancel();
      }))
    )
      count++;
    process.stdout.write(JSON.stringify({ delivered: count }) + '\n');
  } finally {
    await pool.end();
  }
}
void deliver().catch(() => {
  process.stderr.write('Mail worker failed; sensitive details suppressed\n');
  process.exitCode = 1;
});
