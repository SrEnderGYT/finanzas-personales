import { randomBytes } from 'node:crypto';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { createSession, tokenHash } from './sessions';
import { MfaStore } from './mfa-store';
import { consumeRecoveryCode } from './mfa-recovery';

/** Called only after primary identity verification, within its transaction. */
export async function primaryLogin(client: PoolClient, userId: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,5))', [
    userId.toLowerCase(),
  ]);
  const factor = (
    await client.query<{ active: boolean }>('SELECT active FROM app.mfa_factors WHERE user_id=$1', [
      userId,
    ])
  ).rows[0];
  if (!factor?.active) return createSession(client, userId);
  const pending = await client.query<{ count: string }>(
    `SELECT count(*) FROM app.mfa_challenges
    WHERE user_id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() AND attempts<5`,
    [userId],
  );
  if (Number(pending.rows[0]?.count) >= 5)
    throw new HttpException('Too many pending challenges', 429);
  const challenge = 'fpm_' + randomBytes(32).toString('base64url');
  const inserted = await client.query<{ expires_at: Date }>(
    'INSERT INTO app.mfa_challenges(token_hash,user_id) VALUES($1,$2) RETURNING expires_at',
    [tokenHash(challenge), userId],
  );
  return {
    mfaRequired: true as const,
    challenge,
    expiresAt: inserted.rows[0]!.expires_at.toISOString(),
  };
}

export class MfaLogin {
  constructor(
    private readonly pool: Pool,
    private readonly store: MfaStore,
  ) {}
  beginEnrollment(userId: string, sessionId: string, grant: unknown) {
    return this.store.beginAuthorized(userId, sessionId, grant);
  }
  confirmEnrollment(userId: string, sessionId: string, code: unknown) {
    return this.store.confirmAuthorized(userId, sessionId, code);
  }
  async complete(body: unknown, ip: string, recovery = false) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new UnauthorizedException();
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 2 ||
      typeof fields['challenge'] !== 'string' ||
      !/^fpm_[A-Za-z0-9_-]{43}$/.test(fields['challenge']) ||
      typeof fields['code'] !== 'string'
    )
      throw new UnauthorizedException();
    const hits = await this.pool.query<{ hits: number }>(
      `INSERT INTO app.auth_rate_limits(key_hash,bucket)
      VALUES($1,floor(extract(epoch FROM clock_timestamp())/900)::bigint)
      ON CONFLICT(key_hash,bucket) DO UPDATE SET hits=app.auth_rate_limits.hits+1 RETURNING hits`,
      [tokenHash('mfa-ip:' + ip)],
    );
    if ((hits.rows[0]?.hits ?? 31) > 30) throw new HttpException('Rate limit exceeded', 429);
    const client = await this.pool.connect();
    let discard = false;
    let result: Awaited<ReturnType<typeof createSession>> | undefined;
    try {
      await client.query('BEGIN');
      const hash = tokenHash(fields['challenge']);
      const owner = (
        await client.query<{ user_id: string }>(
          'SELECT user_id FROM app.mfa_challenges WHERE token_hash=$1',
          [hash],
        )
      ).rows[0];
      if (owner) {
        await client.query("SELECT set_config('app.user_id',$1,true)", [owner.user_id]);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,5))', [owner.user_id]);
        const challenge = await client.query(
          `UPDATE app.mfa_challenges SET attempts=attempts+1
          WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() AND attempts<5 RETURNING user_id`,
          [hash],
        );
        if (
          challenge.rowCount === 1 &&
          (recovery
            ? await consumeRecoveryCode(client, owner.user_id, fields['code'])
            : await this.store.consumeInTransaction(client, owner.user_id, fields['code']))
        ) {
          await client.query(
            'UPDATE app.mfa_challenges SET consumed_at=clock_timestamp() WHERE token_hash=$1',
            [hash],
          );
          result = await createSession(client, owner.user_id, true);
        }
      }
      // Failed attempts and factor lockout must survive the unauthorized response.
      await client.query('COMMIT');
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
    if (!result) throw new UnauthorizedException();
    return result;
  }
}
