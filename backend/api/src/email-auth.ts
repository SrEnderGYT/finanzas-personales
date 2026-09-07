import { randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { hashPassword, verifyPassword } from './passwords';
import { tokenHash } from './sessions';
import { primaryLogin } from './mfa-login';
import { EmailOutbox } from './email-outbox';

interface Credential {
  user_id: string;
  email: string;
  password_hash: string | null;
  verified: boolean;
}
export function authFields(body: unknown, fields: string[]): Record<string, string> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException();
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).length !== fields.length ||
    fields.some((key) => typeof value[key] !== 'string')
  )
    throw new BadRequestException();
  return value as Record<string, string>;
}
function normalizeEmail(email: string) {
  const result = email.trim().toLowerCase();
  if (
    result.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(result)
  )
    throw new BadRequestException();
  return result;
}
export class EmailAuth {
  constructor(
    readonly pool: Pool,
    private readonly mail: EmailOutbox,
  ) {}
  async assertRole() {
    const result = await this.pool.query<{
      safe: boolean;
    }>(`SELECT (NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb
      AND pg_has_role(current_user,'finanzas_auth_runtime','MEMBER')
      AND NOT pg_has_role(current_user,'finanzas_runtime','MEMBER')
      AND NOT has_schema_privilege(current_user,'app','CREATE')
      AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='app' AND pg_has_role(current_user,c.relowner,'MEMBER'))) AS safe
      FROM pg_roles WHERE rolname=current_user`);
    if (result.rows[0]?.safe !== true) throw new Error('Unsafe authentication database role');
  }
  private async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      const result = await callback(client);
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
  private async limit(key: string, max: number) {
    const result = await this.pool.query<{ hits: number }>(
      `INSERT INTO app.auth_rate_limits(key_hash,bucket)
      VALUES($1,floor(extract(epoch FROM clock_timestamp())/900)::bigint)
      ON CONFLICT(key_hash,bucket) DO UPDATE SET hits=app.auth_rate_limits.hits+1 RETURNING hits`,
      [tokenHash(key)],
    );
    if ((result.rows[0]?.hits ?? max + 1) > max)
      throw new HttpException('Rate limit exceeded', 429);
  }
  private async limits(ip: string, email?: string) {
    await this.limit('ip:' + ip, 30);
    if (email) await this.limit('email:' + email, 10);
  }
  async request(body: unknown, ip: string, kind: 'verify' | 'reset') {
    const email = normalizeEmail(authFields(body, ['email'])['email']!);
    await this.limits(ip, email);
    await this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [email]);
      let row = (
        await client.query<Credential>('SELECT * FROM app.credentials WHERE email=$1 FOR UPDATE', [
          email,
        ])
      ).rows[0];
      if (!row && kind === 'verify') {
        const id = randomUUID();
        await client.query('INSERT INTO app.users(id) VALUES($1)', [id]);
        await client.query('INSERT INTO app.credentials(user_id,email) VALUES($1,$2)', [id, email]);
        row = { user_id: id, email, password_hash: null, verified: false };
      }
      if (!row || (kind === 'verify' && row.verified) || (kind === 'reset' && !row.verified))
        return;
      await client.query(
        'UPDATE app.email_challenges SET used_at=now() WHERE user_id=$1 AND kind=$2 AND used_at IS NULL',
        [row.user_id, kind],
      );
      const token = randomBytes(32).toString('base64url');
      await client.query(
        'INSERT INTO app.email_challenges(token_hash,user_id,kind) VALUES($1,$2,$3)',
        [tokenHash(token), row.user_id, kind],
      );
      await this.mail.enqueue(client, { recipient: email, kind, token });
    });
    return { status: 'accepted' };
  }
  async complete(body: unknown, ip: string, kind: 'verify' | 'reset') {
    const fields = authFields(body, ['token', 'password']);
    await this.limits(ip);
    const token = fields['token']!;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException();
    const hash = await hashPassword(fields['password']);
    await this.transaction(async (client) => {
      const found = (
        await client.query<{ user_id: string }>(
          'SELECT user_id FROM app.email_challenges WHERE token_hash=$1 AND kind=$2',
          [tokenHash(token), kind],
        )
      ).rows[0];
      if (!found) throw new UnauthorizedException();
      const credential = (
        await client.query<Credential>(
          'SELECT * FROM app.credentials WHERE user_id=$1 FOR UPDATE',
          [found.user_id],
        )
      ).rows[0];
      if (
        !credential ||
        (kind === 'verify' && credential.verified) ||
        (kind === 'reset' && !credential.verified)
      )
        throw new UnauthorizedException();
      const consumed = await client.query(
        'UPDATE app.email_challenges SET used_at=now() WHERE token_hash=$1 AND kind=$2 AND used_at IS NULL AND expires_at>now()',
        [tokenHash(token), kind],
      );
      if (consumed.rowCount !== 1) throw new UnauthorizedException();
      await client.query(
        'UPDATE app.credentials SET password_hash=$1,verified=true WHERE user_id=$2',
        [hash, found.user_id],
      );
      await client.query(
        'UPDATE app.email_challenges SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
        [found.user_id],
      );
      await client.query("SELECT set_config('app.user_id',$1,true)", [found.user_id]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,5))', [found.user_id]);
      await client.query(
        'UPDATE app.mfa_challenges SET consumed_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL',
        [found.user_id],
      );
      await client.query(
        'UPDATE app.sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1',
        [found.user_id],
      );
    });
    return { status: 'completed' };
  }
  async login(body: unknown, ip: string) {
    const fields = authFields(body, ['email', 'password']);
    const email = normalizeEmail(fields['email']!);
    await this.limits(ip, email);
    const observed = (
      await this.pool.query<Credential>('SELECT * FROM app.credentials WHERE email=$1', [email])
    ).rows[0];
    const valid = await verifyPassword(fields['password'], observed?.password_hash ?? undefined);
    if (!valid || !observed?.verified) throw new UnauthorizedException();
    return this.transaction(async (client) => {
      const current = (
        await client.query<Credential>(
          'SELECT * FROM app.credentials WHERE user_id=$1 FOR UPDATE',
          [observed.user_id],
        )
      ).rows[0];
      if (!current?.verified || current.password_hash !== observed.password_hash)
        throw new UnauthorizedException();
      // Issuance and credential lock share one transaction: a reset cannot miss this session.
      await client.query("SELECT set_config('app.user_id',$1,true)", [current.user_id]);
      return primaryLogin(client, current.user_id);
    });
  }
}
