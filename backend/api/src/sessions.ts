import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { type IdentityVerifier, UUID } from './auth';
import { UserDatabase } from './database';
import { type PoolClient } from 'pg';

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
/** Internal only: caller must authenticate and establish transaction-local user context. */
export async function createSession(client: PoolClient, userId: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
  const count = await client.query<{ count: string }>(
    `SELECT count(*) FROM app.sessions WHERE user_id=$1
    AND revoked_at IS NULL AND expires_at>now() AND last_seen_at>now()-interval '30 minutes'`,
    [userId],
  );
  if (Number(count.rows[0]?.count) >= 10) throw new HttpException('Session limit reached', 429);
  const token = 'fp_' + randomBytes(32).toString('base64url');
  const sessionId = randomUUID();
  const result = await client.query<{ expires_at: Date }>(
    `INSERT INTO app.sessions(user_id,id,token_hash)
    VALUES($1,$2,$3) RETURNING expires_at`,
    [userId, sessionId, tokenHash(token)],
  );
  return {
    token,
    sessionId,
    expiresAt: result.rows[0]!.expires_at.toISOString(),
    tokenType: 'Bearer' as const,
  };
}
export class SessionAuthority implements IdentityVerifier {
  constructor(
    private readonly database: UserDatabase,
    private readonly loginProof: IdentityVerifier,
  ) {}

  async issue(authorization: string | undefined) {
    const userId = await this.loginProof.verify(authorization);
    if (!authorization) throw new UnauthorizedException();
    return this.database.asUser(userId, async (client) => {
      if (!(await client.query('SELECT id FROM app.users WHERE id=$1', [userId])).rowCount)
        throw new UnauthorizedException();
      const receipt = await client.query(
        `INSERT INTO app.login_receipts(proof_hash,user_id)
        VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [tokenHash(authorization), userId],
      );
      if (receipt.rowCount !== 1) throw new UnauthorizedException();
      return createSession(client, userId);
    });
  }
  async resolve(authorization: string | undefined) {
    if (!authorization || !/^Bearer fp_[A-Za-z0-9_-]{43}$/.test(authorization))
      throw new UnauthorizedException();
    const result = await this.database.pool.query<{ user_id: string; session_id: string }>(
      'SELECT * FROM app.resolve_session($1)',
      [tokenHash(authorization.slice(7))],
    );
    if (!result.rows[0]) throw new UnauthorizedException();
    return result.rows[0];
  }
  async verify(authorization: string | undefined) {
    return (await this.resolve(authorization)).user_id;
  }
  async list(authorization: string | undefined) {
    const current = await this.resolve(authorization);
    return this.database.asUser(current.user_id, async (client) => {
      const rows = await client.query<{
        id: string;
        created_at: Date;
        last_seen_at: Date;
        expires_at: Date;
      }>(
        `
        SELECT id,created_at,last_seen_at,expires_at FROM app.sessions WHERE user_id=$1
        AND revoked_at IS NULL AND expires_at>now() AND last_seen_at>now()-interval '30 minutes'
        ORDER BY created_at DESC LIMIT 10`,
        [current.user_id],
      );
      return rows.rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        current: row.id === current.session_id,
      }));
    });
  }
  async revoke(authorization: string | undefined, id: string) {
    const current = await this.resolve(authorization);
    if (!UUID.test(id)) throw new NotFoundException();
    await this.database.asUser(current.user_id, async (client) => {
      const result = await client.query(
        'UPDATE app.sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1 AND id=$2',
        [current.user_id, id],
      );
      if (!result.rowCount) throw new NotFoundException();
    });
  }
  async logout(authorization: string | undefined, all = false) {
    const current = await this.resolve(authorization);
    await this.database.asUser(current.user_id, (client) =>
      client.query(
        'UPDATE app.sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1 AND ($2::uuid IS NULL OR id=$2)',
        [current.user_id, all ? null : current.session_id],
      ),
    );
  }
}
