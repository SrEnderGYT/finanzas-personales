import type { AppPlugin } from '@capacitor/app';
import { expect, it, vi } from 'vitest';
import { nativeGoogleFlow } from '../packages/shared/src/native-google-flow';
import { pkceChallenge } from '../packages/shared/src/native-pkce';

it('keeps the verifier off the start request and exchanges only a correlated return', async () => {
  let receive!: (event: { url: string }) => void;
  let challenge = '';
  const remove = vi.fn(async () => undefined);
  const app = {
    addListener: vi.fn(async (_event, callback) => {
      receive = callback;
      return { remove };
    }),
  };
  const complete = vi.fn(async (input: { state: string; code: string; verifier: string }) => {
    expect(await pkceChallenge(input.verifier)).toBe(challenge);
    expect(input.code).toBe('synthetic');
    return { accepted: true };
  });
  const result = await nativeGoogleFlow({
    app: app as unknown as AppPlugin,
    redirectUri: 'https://auth.example.test/mobile/callback',
    signal: new AbortController().signal,
    transport: {
      start: async (input) => {
        expect(Object.keys(input).sort()).toEqual(['challenge', 'method', 'state']);
        challenge = input.challenge;
        return `https://accounts.google.com/o/oauth2/v2/auth?state=${input.state}`;
      },
      complete,
    },
    browser: {
      open: async ({ url }) => {
        const state = new URL(url).searchParams.get('state');
        receive({ url: `https://auth.example.test/mobile/callback?state=${state}&code=synthetic` });
      },
    },
  });
  expect(result).toEqual({ accepted: true });
  expect(complete).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledOnce();
});

it('never opens an untrusted authorization destination and removes the native listener', async () => {
  const remove = vi.fn(async () => undefined);
  const app = { addListener: vi.fn(async () => ({ remove })) };
  const open = vi.fn();
  const complete = vi.fn();
  await expect(
    nativeGoogleFlow({
      app: app as unknown as AppPlugin,
      browser: { open },
      redirectUri: 'https://auth.example.test/mobile/callback',
      signal: new AbortController().signal,
      transport: { start: async () => 'https://attacker.example.test/', complete },
    }),
  ).rejects.toThrow('no es válida');
  expect(open).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledOnce();
});
