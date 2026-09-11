import { createServer, request } from 'node:http';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';
import { migrate } from './migrate.mjs';
import { stagingConfig } from './staging-config.mjs';
const load = createRequire(import.meta.url);
const mode = process.env.STAGING_MODE;
const port = Number(process.env.PORT ?? 10000);
const header = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};
async function bootstrap(config) {
  if (!process.env.STAGING_ADMIN_URL)
    throw new Error('Bootstrap requires private administrator configuration');
  const url = new URL(process.env.STAGING_ADMIN_URL);
  if (
    url.hostname !== process.env.STAGING_DATABASE_HOST ||
    url.pathname !== '/' + process.env.STAGING_DATABASE_NAME
  )
    throw new Error('Bootstrap database mismatch');
  const admin = new pg.Pool({ connectionString: url.href, max: 1, connectionTimeoutMillis: 5000 });
  try {
    await migrate(admin);
    for (const { role, group, password } of config.roles) {
      const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
      // Role names are constants and generated passwords are hexadecimal. Never
      // rotate existing credentials implicitly on a cold start or redeployment.
      if (!exists.rowCount)
        await admin.query(
          `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}' IN ROLE ${group}`,
        );
    }
  } finally {
    await admin.end();
  }
  const { UserDatabase } = load('../dist/api/database.js');
  const { EmailAuth } = load('../dist/api/email-auth.js');
  const { EmailOutbox } = load('../dist/api/email-outbox.js');
  const runtime = new pg.Pool({ connectionString: config.runtime.DATABASE_URL, max: 1 });
  const authPool = new pg.Pool({ connectionString: config.runtime.AUTH_DATABASE_URL, max: 2 });
  try {
    await new UserDatabase(runtime).assertRuntimeRole();
    const outbox = new EmailOutbox(Buffer.from(config.runtime.AUTH_MAIL_KEY, 'base64'));
    const auth = new EmailAuth(authPool, outbox);
    await auth.assertRole();
    const email = 'reviewer@example.test';
    const existing = (
      await authPool.query('SELECT verified FROM app.credentials WHERE email=$1', [email])
    ).rows[0];
    if (!existing?.verified) {
      const password = process.env.STAGING_TEST_PASSWORD;
      if (!password || password.length < 15 || password.length > 128)
        throw new Error('Private test password required');
      await auth.request({ email }, 'staging-bootstrap', 'verify');
      let token;
      await outbox.deliverOne(authPool, async (mail) => {
        if (mail.recipient !== email || mail.kind !== 'verify')
          throw new Error('Unexpected staging invitation');
        token = mail.token;
      });
      if (!token) throw new Error('Private invitation unavailable');
      await auth.complete({ token, password }, 'staging-bootstrap', 'verify');
    }
  } finally {
    await runtime.end();
    await authPool.end();
  }
  // No financial API runs while administrator/bootstrap credentials are present.
  createServer((_req, res) =>
    res.writeHead(200, { ...header, 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        status: 'bootstrap-ready',
        next: 'Remove bootstrap credentials and select runtime mode',
      }),
    ),
  ).listen(port, '0.0.0.0');
}
async function serve(config) {
  if (process.env.STAGING_ADMIN_URL || process.env.STAGING_TEST_PASSWORD)
    throw new Error('Remove bootstrap credentials before serving the application');
  Object.assign(process.env, config.runtime);
  const { startApi } = load('../dist/api/main.js');
  const api = await startApi(0, '127.0.0.1');
  const upstream = new URL(await api.getUrl());
  const root = resolve('dist/web/browser');
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (
      [
        '/v1/auth/register',
        '/v1/auth/forgot-password',
        '/v1/auth/verify-email',
        '/v1/auth/reset-password',
      ].includes(url.pathname)
    ) {
      res
        .writeHead(403, { ...header, 'Content-Type': 'application/json' })
        .end('{"error":"PRIVATE_STAGING_INVITATION_REQUIRED"}');
      return;
    }
    if (
      url.pathname.startsWith('/v1/') ||
      ['/health', '/v1', '/openapi.json'].includes(url.pathname)
    ) {
      const headers = { ...req.headers };
      delete headers['x-forwarded-for'];
      delete headers['x-real-ip'];
      const proxy = request(
        {
          hostname: '127.0.0.1',
          port: upstream.port,
          path: url.pathname + url.search,
          method: req.method,
          headers,
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      proxy.on('error', () => {
        if (!res.headersSent) res.writeHead(502, header);
        res.end();
      });
      req.on('aborted', () => proxy.destroy());
      req.pipe(proxy);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, header).end();
      return;
    }
    try {
      let file = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403, header).end();
        return;
      }
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      if (!(extname(file) in mime)) {
        res.writeHead(404, header).end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        ...header,
        'Content-Type': mime[extname(file)],
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, header).end();
    }
  });
  server.listen(port, '0.0.0.0');
  process.once('SIGTERM', () => server.close());
}
try {
  const config = stagingConfig(process.env);
  if (mode === 'bootstrap') await bootstrap(config);
  else if (mode === 'runtime') await serve(config);
  else throw new Error('Explicit staging mode required');
} catch (error) {
  const sqlState = /^[A-Z0-9]{5}$/.test(error?.code ?? '') ? error.code : undefined;
  const migration = /^\d{3}_[a-z_]+\.sql$/.test(error?.migrationName ?? '')
    ? error.migrationName
    : undefined;
  process.stderr.write(
    JSON.stringify({ status: 'staging-start-failed', sqlState, migration }) + '\n',
  );
  process.exitCode = 1;
}
