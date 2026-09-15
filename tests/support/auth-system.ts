import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer, request } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Pool } from 'pg';
import type { AuthMail } from '../../backend/api/src/email-outbox';
import { totpAt } from '../../backend/api/src/totp';

import { replaceRecoveryCodes } from '../../backend/api/src/mfa-recovery';

// Load the same compiled Nest application shipped by build:backend.
const load = createRequire(resolve('package.json'));
const { createApp } = load('./dist/api/app.js') as typeof import('../../backend/api/src/app');
const { denyIdentity } = load('./dist/api/auth.js') as typeof import('../../backend/api/src/auth');
const { UserDatabase } = load(
  './dist/api/database.js',
) as typeof import('../../backend/api/src/database');
const { SessionAuthority } = load(
  './dist/api/sessions.js',
) as typeof import('../../backend/api/src/sessions');
const { EmailAuth } = load(
  './dist/api/email-auth.js',
) as typeof import('../../backend/api/src/email-auth');
const { EmailOutbox } = load(
  './dist/api/email-outbox.js',
) as typeof import('../../backend/api/src/email-outbox');
const { MfaStore } = load(
  './dist/api/mfa-store.js',
) as typeof import('../../backend/api/src/mfa-store');
const { MfaSecrets } = load(
  './dist/api/mfa-secrets.js',
) as typeof import('../../backend/api/src/mfa-secrets');
const { MfaLogin } = load(
  './dist/api/mfa-login.js',
) as typeof import('../../backend/api/src/mfa-login');

export async function authSystem() {
  for (const key of ['P04_TEST_DATABASE_URL', 'P05_TEST_AUTH_URL', 'P04_TEST_ADMIN_URL']) {
    const value = process.env[key];
    if (
      !value ||
      new URL(value).hostname !== '127.0.0.1' ||
      new URL(value).pathname !== '/finanzas_test'
    )
      throw new Error('Use the disposable database runner for auth system tests.');
  }
  const runtime = new Pool({ connectionString: process.env['P04_TEST_DATABASE_URL'] });
  const authPool = new Pool({ connectionString: process.env['P05_TEST_AUTH_URL'] });
  const admin = new Pool({ connectionString: process.env['P04_TEST_ADMIN_URL'] });
  const outbox = new EmailOutbox(randomBytes(32));
  const emailAuth = new EmailAuth(authPool, outbox);
  const database = new UserDatabase(runtime);
  const sessions = new SessionAuthority(database, denyIdentity);
  const factors = new MfaStore(authPool, new MfaSecrets(randomBytes(32)));
  const logs: unknown[] = [];
  await database.assertRuntimeRole();
  await emailAuth.assertRole();
  const app = await createApp({
    database,
    sessions,
    identity: sessions,
    emailAuth,
    mfaLogin: new MfaLogin(authPool, factors),
    log: (event) => logs.push(event),
  });
  await app.listen(0, '127.0.0.1');
  const api = new URL(await app.getUrl());
  const root = resolve('dist/web/browser');
  const index = (await readFile(resolve(root, 'index.html'), 'utf8')).replace(
    'content="disabled"',
    'content="same-origin"',
  );
  const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.webmanifest': 'application/manifest+json',
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/v1/')) {
      const upstream = request(
        {
          hostname: '127.0.0.1',
          port: api.port,
          path: url.pathname + url.search,
          method: req.method,
          headers: req.headers,
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        res.writeHead(502).end();
      });
      req.pipe(upstream);
      return;
    }
    try {
      let path = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (path !== root && !path.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
      const bytes = await readFile(path);
      res.writeHead(200, {
        'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(extname(path) === '.html' ? index : bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return {
    url: `http://127.0.0.1:${address.port}`,
    logs,
    admin,
    async seedRecovery(email: string) {
      const id = (await admin.query('SELECT user_id FROM app.credentials WHERE email=$1', [email]))
        .rows[0].user_id as string;
      const client = await authPool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.user_id',$1,true)", [id]);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,5))', [id]);
        const codes = await replaceRecoveryCodes(client, id);
        await client.query('COMMIT');
        return codes;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async seedFactor(email: string) {
      const id = (
        await admin.query<{ user_id: string }>(
          'SELECT user_id FROM app.credentials WHERE email=$1',
          [email],
        )
      ).rows[0]!.user_id;
      const enrollment = await factors.beginEnrollment(id);
      const time = Number(
        (await admin.query('SELECT floor(extract(epoch FROM clock_timestamp())) AS seconds'))
          .rows[0].seconds,
      );
      if (!(await factors.confirmEnrollment(id, totpAt(enrollment.secret, time - 30))))
        throw new Error('Synthetic factor setup failed');
      return () => totpAt(enrollment.secret, Math.floor(Date.now() / 1000));
    },
    async mail(recipient: string, kind: 'verify' | 'reset') {
      const messages: AuthMail[] = [];
      // The actual encrypted outbox is decrypted by its real delivery method;
      // the only simulated boundary is external email transport.
      while (
        await outbox.deliverOne(authPool, async (message) => {
          messages.push(message);
        })
      ) {
        /* drain */
      }
      const found = messages
        .reverse()
        .find((message) => message.recipient === recipient && message.kind === kind);
      if (!found) throw new Error('Expected synthetic email was not queued');
      return found.token;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      await app.close();
      await Promise.all([runtime.end(), authPool.end(), admin.end()]);
    },
  };
}
