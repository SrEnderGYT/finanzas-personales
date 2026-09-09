import { describe, expect, it } from 'vitest';
import { matchTotp, newTotpSecret, totpAt, totpProvisioningUri } from '../backend/api/src/totp';

// Public RFC 6238 Appendix B test key (ASCII 12345678901234567890), never an account secret.
const reference = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
describe('authenticator codes', () => {
  it('matches every SHA1 reference vector including dates beyond 2038', () => {
    for (const [time, expected] of [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ] as const)
      expect(totpAt(reference, time, 8)).toBe(expected);
    expect(totpAt(reference, 59)).toBe('287082');
  });
  it('bounds the clock window and rejects already consumed steps', () => {
    const now = 1234567890;
    const current = Math.floor(now / 30);
    for (const offset of [-1, 0, 1]) {
      const code = totpAt(reference, now + offset * 30);
      expect(matchTotp(reference, code, now, -1)).toBe(current + offset);
      expect(matchTotp(reference, code, now, current + offset)).toBeNull();
    }
    for (const offset of [-2, 2])
      expect(matchTotp(reference, totpAt(reference, now + offset * 30), now, -1)).toBeNull();
    expect(matchTotp(reference, totpAt(reference, now), now, current + 1)).toBeNull();
  });
  it('rejects malformed codes and unsafe server state without normalizing input', () => {
    for (const candidate of [287082, null, '', '287082 ', ' 287082', '２８７０８２', '94287082'])
      expect(matchTotp(reference, candidate, 59, -1)).toBeNull();
    for (const time of [-1, NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1])
      expect(() => totpAt(reference, time)).toThrow('time');
    expect(() => matchTotp(reference, '287082', 59, -2)).toThrow('replay state');
    expect(() => totpAt(reference.toLowerCase(), 59)).toThrow('secret');
    expect(matchTotp(reference, totpAt(reference, 0), 0, -1)).toBe(0);
  });
  it('creates independent secrets and provisions fixed settings without email labels', () => {
    const first = newTotpSecret();
    const second = newTotpSecret();
    expect(first).toMatch(/^[A-Z2-7]{32}$/);
    expect(first === second).toBe(false);
    expect(totpAt(first, 1234567890)).toMatch(/^\d{6}$/);
    const uri = new URL(totpProvisioningUri(first, '00000000-0000-4000-8000-000000000001'));
    expect(uri.searchParams.get('secret') === first).toBe(true);
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
    expect(() => totpProvisioningUri(first, 'other@example.test')).toThrow('enrollment');
  });
});
