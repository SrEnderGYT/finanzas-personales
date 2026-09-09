import { expect, it } from 'vitest';
import { newRecoveryCodes, recoveryHash } from '../backend/api/src/mfa-recovery';

it('generates ten independent 128-bit recovery codes and binds hashes to the user', () => {
  const a = '00000000-0000-4000-8000-000000000001';
  const b = '00000000-0000-4000-8000-000000000002';
  const codes = newRecoveryCodes();
  expect(new Set(codes).size).toBe(10);
  for (const code of codes) {
    expect(code).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{8}){3}$/);
    expect(recoveryHash(a, code)).toMatch(/^[0-9a-f]{64}$/);
    expect(recoveryHash(a, code)).toBe(recoveryHash(a, code.toUpperCase()));
    expect(recoveryHash(a, code)).not.toBe(recoveryHash(b, code));
  }
  for (const value of [null, 123, '', codes[0] + ' ', 'a'.repeat(10000)])
    expect(recoveryHash(a, value)).toBeNull();
});
