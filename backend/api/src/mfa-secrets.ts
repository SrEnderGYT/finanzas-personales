import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const MFA_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface Envelope {
  version: 1;
  iv: string;
  tag: string;
  data: string;
}
export class MfaSecrets {
  private readonly key: Buffer;
  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('MFA requires a 32-byte encryption key');
    this.key = Buffer.from(key);
  }
  private aad(userId: string) {
    if (!MFA_USER_ID.test(userId)) throw new Error('Invalid MFA user');
    return Buffer.from(`finanzas:mfa:v1:${userId.toLowerCase()}`);
  }
  seal(userId: string, secret: string): Envelope {
    if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error('Invalid MFA secret');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(this.aad(userId));
    const encrypted = Buffer.concat([cipher.update(secret, 'ascii'), cipher.final()]);
    return {
      version: 1,
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      data: encrypted.toString('hex'),
    };
  }
  open(userId: string, value: unknown): string {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      const data = value as Record<string, unknown>;
      if (
        Object.keys(data).length !== 4 ||
        data['version'] !== 1 ||
        typeof data['iv'] !== 'string' ||
        !/^[a-f0-9]{24}$/.test(data['iv']) ||
        typeof data['tag'] !== 'string' ||
        !/^[a-f0-9]{32}$/.test(data['tag']) ||
        typeof data['data'] !== 'string' ||
        !/^[a-f0-9]{64}$/.test(data['data'])
      )
        throw new Error();
      const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(data['iv'], 'hex'));
      cipher.setAAD(this.aad(userId));
      cipher.setAuthTag(Buffer.from(data['tag'], 'hex'));
      const secret = Buffer.concat([
        cipher.update(Buffer.from(data['data'], 'hex')),
        cipher.final(),
      ]).toString('ascii');
      if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error();
      return secret;
    } catch {
      throw new Error('MFA secret could not be decrypted');
    }
  }
}
