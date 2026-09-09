import { beforeAll, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { LiveGoogleProvider, verifyGoogleToken } from '../backend/api/src/google-provider';
let keys: JWTVerifyGetKey;
let sign: (changes?: Record<string, unknown>) => Promise<string>;
beforeAll(async () => {
  const key = await generateKeyPair('RS256');
  keys = createLocalJWKSet({ keys: [await exportJWK(key.publicKey)] });
  sign = (changes = {}) =>
    new SignJWT({
      iss: 'https://accounts.google.com',
      aud: 'synthetic-client',
      sub: 'synthetic-subject',
      nonce: 'synthetic-nonce',
      email: 'person@example.test',
      email_verified: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      ...changes,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .sign(key.privateKey);
});
it('verifies signed Google claims and rejects bad nonce, issuer, audience, azp, expiry or email verification', async () => {
  expect(
    await verifyGoogleToken(await sign(), 'synthetic-nonce', 'synthetic-client', keys),
  ).toEqual({ subject: 'synthetic-subject', email: 'person@example.test' });
  for (const change of [
    { nonce: 'wrong' },
    { iss: 'https://attacker.example.test' },
    { aud: 'wrong' },
    { azp: 'wrong' },
    { email_verified: false },
    { exp: 1 },
    { sub: '' },
    { aud: ['synthetic-client', 'other'] },
  ]) {
    await expect(
      verifyGoogleToken(await sign(change), 'synthetic-nonce', 'synthetic-client', keys),
    ).rejects.toThrow();
  }
});
it('requests only identity scopes with S256 PKCE, never Gmail or offline access', () => {
  const provider = new LiveGoogleProvider(
    'synthetic-client',
    'synthetic-configuration-only',
    'https://app.example.test/auth/google/callback',
  );
  const url = new URL(
    provider.authorization({ state: 'state', nonce: 'nonce', challenge: 'challenge' }),
  );
  expect(url.origin).toBe('https://accounts.google.com');
  expect(url.searchParams.get('scope')).toBe('openid email');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.has('access_type')).toBe(false);
  expect(url.searchParams.has('client_secret')).toBe(false);
});

it('reauthentication rejects a newly issued token whose signed authentication time is stale or absent', async () => {
  const threshold = Math.floor(Date.now() / 1000) - 300;
  for (const auth_time of [
    undefined,
    threshold - 10,
    Math.floor(Date.now() / 1000) + 60,
    '123',
    1.5,
  ]) {
    await expect(
      verifyGoogleToken(
        await sign({ auth_time }),
        'synthetic-nonce',
        'synthetic-client',
        keys,
        threshold,
      ),
    ).rejects.toThrow();
  }
  await expect(
    verifyGoogleToken(
      await sign({ auth_time: threshold }),
      'synthetic-nonce',
      'synthetic-client',
      keys,
      threshold,
    ),
  ).resolves.toMatchObject({ subject: 'synthetic-subject' });
  const provider = new LiveGoogleProvider(
    'synthetic-client',
    'synthetic-configuration-only',
    'https://app.example.test/callback',
  );
  const url = new URL(
    provider.authorization({
      state: 'state',
      nonce: 'nonce',
      challenge: 'challenge',
      reauthenticate: true,
    }),
  );
  expect(JSON.parse(url.searchParams.get('claims')!)).toEqual({
    id_token: { auth_time: { essential: true } },
  });
  expect(url.searchParams.get('scope')).toBe('openid email');
});
