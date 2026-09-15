import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface Envelope {
  version: 1;
  iv: string;
  tag: string;
  data: string;
}

export class GmailSecrets {
  private readonly key: Buffer;
  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('Gmail requires a 32-byte encryption key');
    this.key = Buffer.from(key);
  }
  private aad(userId: string) {
    if (!USER_ID.test(userId)) throw new Error('Invalid Gmail user');
    return Buffer.from(`finanzas:gmail:v1:${userId.toLowerCase()}`);
  }
  seal(userId: string, token: string): Envelope {
    if (!token || token.length > 4096) throw new Error('Invalid Gmail refresh token');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(this.aad(userId));
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
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
        !/^[a-f0-9]+$/.test(data['data']) ||
        data['data'].length > 8192
      )
        throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(data['iv'], 'hex'));
      decipher.setAAD(this.aad(userId));
      decipher.setAuthTag(Buffer.from(data['tag'], 'hex'));
      const token = Buffer.concat([
        decipher.update(Buffer.from(data['data'], 'hex')),
        decipher.final(),
      ]).toString('utf8');
      if (!token || token.length > 4096) throw new Error();
      return token;
    } catch {
      throw new Error('Gmail refresh token could not be decrypted');
    }
  }
}
