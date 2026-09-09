import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

const FORMAT = /^scrypt-v1\$([0-9a-f]{64})\$([0-9a-f]{128})$/;
let active = 0;
function validPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Array.from(value).length >= 15 &&
    Array.from(value).length <= 128 &&
    Buffer.byteLength(value, 'utf8') <= 512
  );
}
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  // Bound memory use; distributed account/IP rate limiting is still required.
  if (active >= 2) throw new ServiceUnavailableException();
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        password,
        salt,
        64,
        { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 },
        (error, key) => (error ? reject(new Error('Password derivation failed')) : resolve(key)),
      ),
    );
  } finally {
    active--;
  }
}
export async function hashPassword(password: unknown): Promise<string> {
  if (!validPassword(password)) throw new BadRequestException();
  const salt = randomBytes(32);
  const key = await derive(password, salt);
  return `scrypt-v1$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(password: unknown, encoded?: string): Promise<boolean> {
  if (!validPassword(password)) return false;
  const parts = encoded?.match(FORMAT);
  // Unknown users execute the same costly derivation; no fast username oracle.
  const salt = parts?.[1] ? Buffer.from(parts[1], 'hex') : Buffer.alloc(32);
  const expected = parts?.[2] ? Buffer.from(parts[2], 'hex') : Buffer.alloc(64);
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected) && Boolean(parts);
}
