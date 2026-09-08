import { randomBytes } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { tokenHash } from './sessions';

/** Caller owns the transaction and verified user context. Lock ordering is user then session. */
export async function lockLiveSession(client: PoolClient, userId: string, sessionId: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,5))', [
    userId.toLowerCase(),
  ]);
  await client.query('SELECT id FROM app.sessions WHERE user_id=$1 AND id=$2 FOR UPDATE', [
    userId,
    sessionId,
  ]);
  const row = await client.query(
    `SELECT id FROM app.sessions WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL
     AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '30 minutes'`,
    [userId, sessionId],
  );
  if (row.rowCount !== 1) throw new UnauthorizedException();
}

/** Only invoke after a fresh primary proof has been verified in this transaction.
 * A live session alone is NOT proof of reauthentication. No public endpoint yet.
 */
export async function issueEnrollmentGrant(client: PoolClient, userId: string, sessionId: string) {
  await lockLiveSession(client, userId, sessionId);
  await client.query(
    'UPDATE app.reauth_grants SET consumed_at=clock_timestamp() WHERE user_id=$1 AND session_id=$2 AND consumed_at IS NULL',
    [userId, sessionId],
  );
  const grant = 'fpr_' + randomBytes(32).toString('base64url');
  const result = await client.query<{ expires_at: Date }>(
    `INSERT INTO app.reauth_grants(token_hash,user_id,session_id,purpose)
     VALUES($1,$2,$3,'mfa-enroll') RETURNING expires_at`,
    [tokenHash(grant), userId, sessionId],
  );
  return { grant, expiresAt: result.rows[0]!.expires_at.toISOString() };
}

/** Consume with the enrollment mutation; rollback leaves both unchanged. */
export async function consumeEnrollmentGrant(
  client: PoolClient,
  userId: string,
  sessionId: string,
  grant: unknown,
) {
  if (typeof grant !== 'string' || !/^fpr_[A-Za-z0-9_-]{43}$/.test(grant)) return false;
  await lockLiveSession(client, userId, sessionId);
  const result = await client.query(
    `UPDATE app.reauth_grants SET consumed_at=clock_timestamp()
     WHERE token_hash=$1 AND user_id=$2 AND session_id=$3 AND purpose='mfa-enroll'
     AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING user_id`,
    [tokenHash(grant), userId, sessionId],
  );
  return result.rowCount === 1;
}
