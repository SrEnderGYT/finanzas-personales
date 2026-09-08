import { issueEnrollmentGrant } from './reauth-grants';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { SessionAuthority, tokenHash } from './sessions';
import { primaryLogin } from './mfa-login';
import { type GoogleProvider } from './google-provider';
import { authFields } from './email-auth';
interface Flow {
  nonce: string;
  verifier: string;
  link?: { user_id: string; session_id: string };
  reauth?: { user_id: string; session_id: string };
}
interface Envelope {
  iv: string;
  data: string;
  tag: string;
}
export const GOOGLE_COOKIE = '__Host-finanzas_oidc';
export class GoogleAuth {
  constructor(
    private readonly pool: Pool,
    private readonly sessions: SessionAuthority,
    private readonly provider: GoogleProvider,
    private readonly key: Buffer,
    readonly origin: string,
  ) {
    if (key.length !== 32 || new URL(origin).origin !== origin || !origin.startsWith('https://'))
      throw new Error('Invalid OIDC configuration');
  }
  private assertOrigin(origin: string | undefined) {
    if (origin !== this.origin) throw new ForbiddenException();
  }
  private async limit(ip: string) {
    const row = await this.pool.query<{ hits: number }>(
      `INSERT INTO app.auth_rate_limits(key_hash,bucket)
      VALUES($1,floor(extract(epoch FROM clock_timestamp())/900)::bigint)
      ON CONFLICT(key_hash,bucket) DO UPDATE SET hits=app.auth_rate_limits.hits+1 RETURNING hits`,
      [tokenHash('google-ip:' + ip)],
    );
    if ((row.rows[0]?.hits ?? 31) > 30) throw new HttpException('Rate limit exceeded', 429);
  }
  async start(
    body: unknown,
    authorization: string | undefined,
    origin: string | undefined,
    ip: string,
  ) {
    this.assertOrigin(origin);
    await this.limit(ip);
    const mode = authFields(body, ['mode'])['mode'];
    if (mode !== 'login' && mode !== 'link' && mode !== 'reauthenticate')
      throw new BadRequestException();
    const flow: Flow = {
      nonce: randomBytes(32).toString('base64url'),
      verifier: randomBytes(32).toString('base64url'),
    };
    if (mode === 'link') flow.link = await this.sessions.resolve(authorization);
    if (mode === 'reauthenticate') flow.reauth = await this.sessions.resolve(authorization);
    const state = randomBytes(32).toString('base64url');
    const binding = randomBytes(32).toString('base64url');
    const stateHash = tokenHash(state);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(stateHash));
    const data = Buffer.concat([cipher.update(JSON.stringify(flow), 'utf8'), cipher.final()]);
    const envelope: Envelope = {
      iv: iv.toString('hex'),
      data: data.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
    };
    await this.pool.query(
      'INSERT INTO app.oidc_flows(state_hash,binding_hash,envelope) VALUES($1,$2,$3)',
      [stateHash, tokenHash(binding), envelope],
    );
    return {
      binding,
      authorizationUrl: this.provider.authorization({
        state,
        ...(flow.reauth ? { reauthenticate: true } : {}),
        nonce: flow.nonce,
        challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
      }),
    };
  }
  async complete(
    body: unknown,
    cookie: string | undefined,
    origin: string | undefined,
    ip: string,
  ) {
    this.assertOrigin(origin);
    await this.limit(ip);
    const fields = authFields(body, ['state', 'code']);
    const state = fields['state']!;
    const code = fields['code']!;
    const bindings =
      cookie
        ?.split(';')
        .map((part) => part.trim())
        .filter((part) => part.startsWith(GOOGLE_COOKIE + '=')) ?? [];
    const binding = bindings[0]?.slice(GOOGLE_COOKIE.length + 1);
    if (
      bindings.length !== 1 ||
      !binding ||
      !/^[A-Za-z0-9_-]{43}$/.test(binding) ||
      !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      !code ||
      code.length > 4096
    )
      throw new UnauthorizedException();
    // Consume atomically before token exchange. A failed exchange requires a fresh login.
    const result = await this.pool.query<{ envelope: Envelope }>(
      `UPDATE app.oidc_flows SET consumed_at=now()
      WHERE state_hash=$1 AND binding_hash=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING envelope`,
      [tokenHash(state), tokenHash(binding)],
    );
    const envelope = result.rows[0]?.envelope;
    if (!envelope) throw new UnauthorizedException();
    let flow: Flow;
    try {
      const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'hex'));
      cipher.setAAD(Buffer.from(tokenHash(state)));
      cipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
      flow = JSON.parse(
        Buffer.concat([cipher.update(Buffer.from(envelope.data, 'hex')), cipher.final()]).toString(
          'utf8',
        ),
      ) as Flow;
    } catch {
      throw new UnauthorizedException();
    }
    const identity = await this.provider.exchange(
      code,
      flow.verifier,
      flow.nonce,
      flow.reauth ? Math.floor(Date.now() / 1000) - 300 : undefined,
    );
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,2))', [
        identity.subject,
      ]);
      const existing = (
        await client.query<{ user_id: string }>(
          'SELECT user_id FROM app.google_identities WHERE subject=$1',
          [identity.subject],
        )
      ).rows[0];
      if (flow.reauth) {
        if (!existing || existing.user_id !== flow.reauth.user_id)
          throw new UnauthorizedException();
        await client.query("SELECT set_config('app.user_id',$1,true)", [flow.reauth.user_id]);
        return {
          reauthenticated: true as const,
          ...(await issueEnrollmentGrant(client, flow.reauth.user_id, flow.reauth.session_id)),
        };
      }
      let userId: string;
      if (flow.link) {
        userId = flow.link.user_id;
        await client.query("SELECT set_config('app.user_id',$1,true)", [userId]);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,5))', [userId]);
        const valid = await client.query(
          `SELECT id FROM app.sessions WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL
          AND expires_at>now() AND last_seen_at>now()-interval '30 minutes' FOR UPDATE`,
          [userId, flow.link.session_id],
        );
        if (!valid.rowCount) throw new UnauthorizedException();
        if (existing && existing.user_id !== userId) throw new ConflictException();
      } else if (existing) userId = existing.user_id;
      else {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [
          identity.email,
        ]);
        if (
          (
            await client.query('SELECT user_id FROM app.credentials WHERE email=$1', [
              identity.email,
            ])
          ).rowCount
        )
          throw new ConflictException('Explicit linking required');
        userId = randomUUID();
        await client.query('INSERT INTO app.users(id) VALUES($1)', [userId]);
      }
      if (!existing) {
        const linked = await client.query(
          'SELECT subject FROM app.google_identities WHERE user_id=$1',
          [userId],
        );
        if (linked.rowCount) throw new ConflictException();
        await client.query('INSERT INTO app.google_identities(subject,user_id) VALUES($1,$2)', [
          identity.subject,
          userId,
        ]);
      }
      await client.query("SELECT set_config('app.user_id',$1,true)", [userId]);
      return primaryLogin(client, userId);
    });
  }
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
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
