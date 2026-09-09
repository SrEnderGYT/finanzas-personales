import { randomBytes, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { MfaSecrets } from '../backend/api/src/mfa-secrets';
import { newTotpSecret } from '../backend/api/src/totp';

it('encrypts each enrollment independently and binds ciphertext to its owner', () => {
  const key = randomBytes(32);
  const box = new MfaSecrets(key);
  const user = randomUUID();
  const secret = newTotpSecret();
  const first = box.seal(user, secret);
  const second = box.seal(user, secret);
  expect(first.data === second.data).toBe(false);
  expect(JSON.stringify(first).includes(secret)).toBe(false);
  expect(box.open(user, first) === secret).toBe(true);
  expect(() => box.open(randomUUID(), first)).toThrow('could not be decrypted');
  expect(() => new MfaSecrets(randomBytes(32)).open(user, first)).toThrow('could not be decrypted');
  key.fill(0);
  expect(box.open(user, first) === secret).toBe(true);
});

it('rejects modified, malformed and unsupported ciphertext without disclosing its contents', () => {
  const box = new MfaSecrets(randomBytes(32));
  const user = randomUUID();
  const valid = box.seal(user, newTotpSecret());
  for (const value of [
    null,
    [],
    {},
    { ...valid, version: 2 },
    { ...valid, extra: true },
    { ...valid, tag: '00'.repeat(16) },
    { ...valid, iv: 'z'.repeat(24) },
    { ...valid, data: '00'.repeat(32) },
  ])
    expect(() => box.open(user, value)).toThrow('MFA secret could not be decrypted');
  expect(() => new MfaSecrets(Buffer.alloc(31))).toThrow('32-byte');
});
