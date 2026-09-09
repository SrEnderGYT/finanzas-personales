import { expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../backend/api/src/passwords';

it('stores a salted scrypt hash, verifies the exact password and rejects another password', async () => {
  const password = 'Synthetic passphrase for tests only';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  expect(first).not.toBe(second);
  expect(first).not.toContain(password);
  expect(await verifyPassword(password, first)).toBe(true);
  expect(await verifyPassword(password + '!', first)).toBe(false);
}, 15000);

it('supports Unicode without silently trimming or normalizing a password', async () => {
  const password = '  Clave sintética ñ 😀  ';
  const hash = await hashPassword(password);
  expect(await verifyPassword(password, hash)).toBe(true);
  expect(await verifyPassword(password.trim(), hash)).toBe(false);
}, 15000);

it('rejects missing/corrupted hashes and enforces bounded input', async () => {
  expect(await verifyPassword('Synthetic passphrase for tests only')).toBe(false);
  expect(await verifyPassword('Synthetic passphrase for tests only', 'invalid')).toBe(false);
  for (const value of [null, {}, '', 'short', 'x'.repeat(129)])
    await expect(hashPassword(value)).rejects.toThrow();
}, 15000);
