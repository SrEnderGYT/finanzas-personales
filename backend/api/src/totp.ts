import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const validSecret = /^[A-Z2-7]{32}$/;

/** A fresh 160-bit secret, encoded without padding for authenticator apps. */
export function newTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let encoded = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += alphabet[(value >>> bits) & 31];
    }
  }
  return encoded;
}

function decode(secret: string): Buffer {
  if (!validSecret.test(secret)) throw new Error('Invalid authenticator secret');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}

function counterAt(unixSeconds: number) {
  if (!Number.isSafeInteger(unixSeconds) || unixSeconds < 0)
    throw new Error('Invalid authenticator time');
  return Math.floor(unixSeconds / 30);
}

function codeAt(key: Buffer, step: number, digits: 6 | 8): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  const number = digest.readUInt32BE(offset) & 0x7fffffff;
  return (number % 10 ** digits).toString().padStart(digits, '0');
}

/** RFC 6238 HMAC-SHA1; 8 digits are supported for published reference vectors. */
export function totpAt(secret: string, unixSeconds: number, digits: 6 | 8 = 6): string {
  if (digits !== 6 && digits !== 8) throw new Error('Invalid authenticator digits');
  return codeAt(decode(secret), counterAt(unixSeconds), digits);
}

/**
 * Returns the matching step, never a session or a boolean authorization.
 * Caller MUST atomically persist this step under a database row lock before
 * authorizing, and apply persistent attempt limits. This function alone cannot
 * stop concurrent replay. Time and lastUsedStep must come from trusted server state.
 */
export function matchTotp(
  secret: string,
  candidate: unknown,
  unixSeconds: number,
  lastUsedStep: number,
): number | null {
  const current = counterAt(unixSeconds);
  if (!Number.isSafeInteger(lastUsedStep) || lastUsedStep < -1)
    throw new Error('Invalid authenticator replay state');
  if (typeof candidate !== 'string' || !/^\d{6}$/.test(candidate)) return null;
  const key = decode(secret);
  const submitted = Buffer.from(candidate, 'ascii');
  let matched: number | null = null;
  // Compare the whole fixed window. Choose the newest match if two steps collide.
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(codeAt(key, Math.max(0, step), 6), 'ascii');
    const same = timingSafeEqual(submitted, expected);
    if (same && step >= 0 && step > lastUsedStep) matched = step;
  }
  return matched;
}

export function totpProvisioningUri(secret: string, userId: string): string {
  if (
    !validSecret.test(secret) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
  )
    throw new Error('Invalid authenticator enrollment');
  const query = new URLSearchParams({
    secret,
    issuer: 'Finanzas',
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  // Opaque local identifier instead of email or financial details in the QR label.
  return `otpauth://totp/${encodeURIComponent(`Finanzas:${userId}`)}?${query}`;
}
