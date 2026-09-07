import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { type PoolClient, Pool } from 'pg';
export interface AuthMail {
  recipient: string;
  kind: 'verify' | 'reset';
  token: string;
}
interface Envelope {
  iv: string;
  data: string;
  tag: string;
}
export class EmailOutbox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('Mail encryption key must contain 32 bytes');
  }
  async enqueue(client: PoolClient, message: AuthMail) {
    const id = randomUUID();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(id));
    const data = Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final()]);
    const envelope: Envelope = {
      iv: iv.toString('hex'),
      data: data.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
    };
    await client.query('INSERT INTO app.auth_mail_outbox(id,envelope) VALUES ($1,$2)', [
      id,
      envelope,
    ]);
  }
  async deliverOne(pool: Pool, send: (mail: AuthMail) => Promise<void>): Promise<boolean> {
    const client = await pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        id: string;
        envelope: Envelope;
      }>(`SELECT id,envelope FROM app.auth_mail_outbox
        WHERE sent_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
      const item = result.rows[0];
      if (!item) {
        await client.query('COMMIT');
        return false;
      }
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(item.envelope.iv, 'hex'),
      );
      decipher.setAAD(Buffer.from(item.id));
      decipher.setAuthTag(Buffer.from(item.envelope.tag, 'hex'));
      const mail = JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(item.envelope.data, 'hex')),
          decipher.final(),
        ]).toString('utf8'),
      ) as AuthMail;
      await send(mail);
      await client.query('UPDATE app.auth_mail_outbox SET sent_at=now() WHERE id=$1', [item.id]);
      await client.query('COMMIT');
      return true;
    } catch {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      throw new Error('Mail delivery failed');
    } finally {
      client.release(discard);
    }
  }
}
