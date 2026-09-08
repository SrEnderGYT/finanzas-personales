import { replaceRecoveryCodes } from './mfa-recovery';
import { ConflictException } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { MfaSecrets, MFA_USER_ID } from './mfa-secrets';
import { matchTotp, newTotpSecret, totpProvisioningUri } from './totp';

/** Internal store only. The future API must derive userId from verified identity,
 * enforce recent primary reauthentication, and issue sessions in the consuming transaction.
 * No endpoint exposes these methods until that integration is complete.
 */
export class MfaStore {
  constructor(
    private readonly pool: Pool,
    private readonly secrets: MfaSecrets,
  ) {}
  private async transaction<T>(
    userId: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (!MFA_USER_ID.test(userId)) throw new Error('Invalid MFA user');
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.user_id',$1,true)", [userId]);
      // Serializes enrollment and consumption even before a factor row exists.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,5))', [
        userId.toLowerCase(),
      ]);
      const result = await work(client);
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
  async beginEnrollment(userId: string) {
    return this.transaction(userId, async (client) => {
      const secret = newTotpSecret();
      const result = await client.query(
        `INSERT INTO app.mfa_factors(user_id,envelope) VALUES($1,$2)
        ON CONFLICT(user_id) DO UPDATE SET envelope=excluded.envelope,created_at=now()
        WHERE NOT app.mfa_factors.active RETURNING user_id`,
        [userId, this.secrets.seal(userId, secret)],
      );
      if (result.rowCount !== 1) throw new ConflictException();
      // Deliberately preserve failure counters/lockouts when replacing a pending enrollment.
      return { secret, uri: totpProvisioningUri(secret, userId) };
    });
  }
  async confirmEnrollment(userId: string, code: unknown) {
    return (await this.confirmEnrollmentWithRecovery(userId, code)) !== null;
  }
  /** Returns the recovery plaintext only in the activation response, never from a later read.
   * The caller must establish recent primary reauthentication before invoking this method.
   */
  async confirmEnrollmentWithRecovery(userId: string, code: unknown) {
    return this.transaction(userId, async (client) => {
      const valid = await this.consume(client, userId, code, false);
      if (valid) {
        await client.query(
          'UPDATE app.sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE user_id=$1',
          [userId],
        );
        await client.query(
          'UPDATE app.mfa_challenges SET consumed_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL',
          [userId],
        );
      }
      return valid ? { recoveryCodes: await replaceRecoveryCodes(client, userId) } : null;
    });
  }
  async consumeActive(userId: string, code: unknown) {
    return this.transaction(userId, (client) => this.consume(client, userId, code, true));
  }
  /** Caller owns a transaction, derived user context and the per-user advisory lock. */
  consumeInTransaction(client: PoolClient, userId: string, code: unknown) {
    return this.consume(client, userId, code, true);
  }
  private async consume(client: PoolClient, userId: string, code: unknown, active: boolean) {
    const row = (
      await client.query<{
        envelope: unknown;
        active: boolean;
        last_used_step: string;
        failed_attempts: number;
        locked_until: Date | null;
        created_at: Date;
      }>('SELECT * FROM app.mfa_factors WHERE user_id=$1 FOR UPDATE', [userId])
    ).rows[0];
    if (!row || row.active !== active) return false;
    // Obtain time after the lock wait, so queuing cannot extend validity.
    const now = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
    if (
      (row.locked_until && row.locked_until > now) ||
      (!active && now.getTime() - row.created_at.getTime() >= 600000)
    )
      return false;
    const matched = matchTotp(
      this.secrets.open(userId, row.envelope),
      code,
      Math.floor(now.getTime() / 1000),
      Number(row.last_used_step),
    );
    if (matched === null) {
      const failures = Math.min(5, (row.locked_until ? 0 : row.failed_attempts) + 1);
      await client.query(
        `UPDATE app.mfa_factors SET failed_attempts=$2,
        locked_until=CASE WHEN $2=5 THEN clock_timestamp()+interval '15 minutes' ELSE NULL END
        WHERE user_id=$1`,
        [userId, failures],
      );
      // Commit failures instead of throwing inside the transaction and rolling them back.
      return false;
    }
    await client.query(
      `UPDATE app.mfa_factors SET active=true,confirmed_at=coalesce(confirmed_at,clock_timestamp()),
      last_used_step=$2,failed_attempts=0,locked_until=NULL WHERE user_id=$1`,
      [userId, matched],
    );
    return true;
  }
}
