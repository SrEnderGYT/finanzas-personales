import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { MFA_USER_ID } from './mfa-secrets';

/** 128 random bits per code. Plaintext is returned once, never persisted. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () =>
    randomBytes(16).toString('hex').match(/.{8}/g)!.join('-'),
  );
}

export function recoveryHash(userId: string, candidate: unknown): string | null {
  if (!MFA_USER_ID.test(userId)) throw new Error('Invalid MFA user');
  if (typeof candidate !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{8}){3}$/i.test(candidate))
    return null;
  return createHash('sha256')
    .update(`finanzas:mfa-recovery:v1:${userId.toLowerCase()}:${candidate.toLowerCase()}`)
    .digest('hex');
}

/** Internal only: caller must verify recent primary authentication and factor possession.
 * Caller owns the user-context transaction and per-user lock, committing with activation.
 */
export async function replaceRecoveryCodes(client: PoolClient, userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  const hashes = codes.map((code) => recoveryHash(userId, code)!);
  const factor = await client.query(
    'SELECT active FROM app.mfa_factors WHERE user_id=$1 FOR UPDATE',
    [userId],
  );
  if (factor.rows[0]?.active !== true) throw new Error('Active MFA required');
  await client.query('DELETE FROM app.mfa_recovery_codes WHERE user_id=$1', [userId]);
  await client.query(
    'INSERT INTO app.mfa_recovery_codes(user_id,code_hash) SELECT $1,unnest($2::text[])',
    [userId, hashes],
  );
  return codes;
}

/** Must run inside the bounded MFA challenge transaction, together with session issuance.
 * Atomic conditional update prevents concurrent reuse; rollback preserves the code on failure.
 * This method alone does not authorize a user or disable their authenticator.
 */
export async function consumeRecoveryCode(client: PoolClient, userId: string, candidate: unknown) {
  const hash = recoveryHash(userId, candidate);
  if (!hash) return false;
  const result = await client.query(
    `UPDATE app.mfa_recovery_codes SET consumed_at=clock_timestamp()
     WHERE user_id=$1 AND code_hash=$2 AND consumed_at IS NULL
     AND EXISTS(SELECT 1 FROM app.mfa_factors WHERE user_id=$1 AND active)
     RETURNING user_id`,
    [userId, hash],
  );
  return result.rowCount === 1;
}
