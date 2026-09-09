import { expect, it, vi } from 'vitest';
import type { AppPlugin } from '@capacitor/app';
import { AuthClient } from '../packages/ui/src/auth-client';
import { pkceChallenge } from '../packages/shared/src/native-pkce';

it('constructs a native client against an explicitly configured HTTPS server', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ token: `fp_${'a'.repeat(43)}` }));
  const client = AuthClient.forNativeServer('https://api.example.test', transport);
  await client.login('synthetic@example.test', 'Synthetic test phrase');
  expect(client.signedIn).toBe(true);
  expect(transport.mock.calls[0]?.[0]).toBe('https://api.example.test/v1/auth/login');
  expect(transport.mock.calls[0]?.[1]).toMatchObject({
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  });
});

it('uses native API paths, keeps PKCE private until completion and honors the MFA gate', async () => {
  let receive!: (event: { url: string }) => void;
  let challenge = '';
  const remove = vi.fn(async () => undefined);
  const app = {
    addListener: vi.fn(async (_event, listener) => {
      receive = listener;
      return { remove };
    }),
  };
  const transport = vi.fn<typeof fetch>(async (path, options) => {
    const body = JSON.parse(options!.body as string);
    if (path === '/v1/auth/google/native/start') {
      expect(body.verifier).toBeUndefined();
      challenge = body.challenge;
      return Response.json({
        authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?state=${body.state}`,
      });
    }
    if (path === '/v1/auth/google/native/complete') {
      expect(await pkceChallenge(body.verifier)).toBe(challenge);
      return Response.json({ mfaRequired: true, challenge: `fpm_${'b'.repeat(43)}` });
    }
    expect(path).toBe('/v1/auth/mfa/complete');
    return Response.json({ token: `fp_${'a'.repeat(43)}` });
  });
  const client = new AuthClient(true, transport);
  await client.nativeGoogle({
    app: app as unknown as AppPlugin,
    redirectUri: 'https://auth.example.test/mobile/callback',
    signal: new AbortController().signal,
    browser: {
      open: async ({ url }) => {
        receive({
          url: `https://auth.example.test/mobile/callback?state=${new URL(url).searchParams.get('state')}&code=synthetic`,
        });
      },
    },
  });
  expect(client.signedIn).toBe(false);
  expect(client.mfaPending).toBe(true);
  expect(remove).toHaveBeenCalledOnce();
  await client.completeMfa('123456');
  expect(client.signedIn).toBe(true);
  expect(client.mfaPending).toBe(false);
});

it('never starts native login in the public demo', async () => {
  const open = vi.fn();
  const addListener = vi.fn();
  const transport = vi.fn<typeof fetch>();
  await expect(
    new AuthClient(false, transport).nativeGoogle({
      app: { addListener } as unknown as AppPlugin,
      browser: { open },
      redirectUri: 'https://auth.example.test/mobile/callback',
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow('no está habilitado');
  expect(open).not.toHaveBeenCalled();
  expect(addListener).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it('native reauthentication opens enrollment without replacing the original session', async () => {
  const token = `fp_${'a'.repeat(43)}`;
  let receive!: (event: { url: string }) => void;
  const transport = vi.fn<typeof fetch>(async (path, options) => {
    const body = JSON.parse(options!.body as string);
    if (path === '/v1/auth/login') return Response.json({ token });
    expect(new Headers(options!.headers).get('authorization')).toBe('Bearer ' + token);
    if (path === '/v1/auth/google/native/reauthenticate')
      return Response.json({
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=' + body.state,
      });
    if (path === '/v1/auth/google/native/complete')
      return Response.json({ reauthenticated: true, grant: `fpr_${'b'.repeat(43)}` });
    expect(path).toBe('/v1/auth/mfa/enrollment/start');
    expect(body.grant).toBe(`fpr_${'b'.repeat(43)}`);
    return Response.json({ secret: 'A'.repeat(32) });
  });
  const client = new AuthClient(true, transport);
  await client.login('synthetic@example.test', 'Synthetic test phrase');
  const secret = await client.beginMfaNativeGoogle({
    app: {
      addListener: async (_event: string, listener: typeof receive) => {
        receive = listener;
        return { remove: async () => undefined };
      },
    } as unknown as AppPlugin,
    browser: {
      open: async ({ url }) => {
        receive({
          url:
            'https://auth.example.test/mobile/callback?state=' +
            new URL(url).searchParams.get('state') +
            '&code=synthetic',
        });
      },
    },
    redirectUri: 'https://auth.example.test/mobile/callback',
    signal: new AbortController().signal,
  });
  expect(secret).toBe('A'.repeat(32));
  expect(client.signedIn).toBe(true);
  expect(client.mfaPending).toBe(false);
});

it('native linking retains the original session without a second login', async () => {
  const token = `fp_${'a'.repeat(43)}`;
  let receive!: (event: { url: string }) => void;
  const transport = vi.fn<typeof fetch>(async (path, options) => {
    const body = JSON.parse(options!.body as string);
    if (path === '/v1/auth/login') return Response.json({ token });
    expect(new Headers(options!.headers).get('authorization')).toBe('Bearer ' + token);
    if (path === '/v1/auth/google/native/link')
      return Response.json({
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=' + body.state,
      });
    expect(path).toBe('/v1/auth/google/native/complete');
    return Response.json({ linked: true });
  });
  const client = new AuthClient(true, transport);
  await client.login('synthetic@example.test', 'Synthetic test phrase');
  await client.linkNativeGoogle({
    app: {
      addListener: async (_event: string, listener: typeof receive) => {
        receive = listener;
        return { remove: async () => undefined };
      },
    } as unknown as AppPlugin,
    browser: {
      open: async ({ url }) => {
        receive({
          url:
            'https://auth.example.test/mobile/callback?state=' +
            new URL(url).searchParams.get('state') +
            '&code=synthetic',
        });
      },
    },
    redirectUri: 'https://auth.example.test/mobile/callback',
    signal: new AbortController().signal,
  });
  expect(client.signedIn).toBe(true);
  expect(client.mfaPending).toBe(false);
});
