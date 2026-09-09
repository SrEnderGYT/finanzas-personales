import { expect, it, vi } from 'vitest';
import { nativeAuthProviders } from '../apps/mobile/src/native-auth.providers';
import { NATIVE_GOOGLE_LOGIN, type NativeGoogleLogin } from '../packages/ui/src/native-auth';
import { AuthClient } from '../packages/ui/src/auth-client';

const browser = vi.hoisted(() => ({
  addListener: vi.fn(),
  close: vi.fn(async () => undefined),
}));
vi.mock('@capacitor/browser', () => ({ Browser: browser }));
const config = {
  apiOrigin: 'https://api.example.test',
  redirectUri: 'https://auth.example.test/mobile/callback',
};

it('keeps browser previews and unconfigured native builds disabled', () => {
  expect(nativeAuthProviders(config, false)).toEqual([]);
  expect(nativeAuthProviders(null, true)).toEqual([]);
  expect(() =>
    nativeAuthProviders({ ...config, apiOrigin: 'http://api.example.test' }, true),
  ).toThrow();
});

it('cancels login when the browser closes and cleans its own listener', async () => {
  const remove = vi.fn(async () => {
    throw new Error('already removed');
  });
  let finish!: () => void;
  browser.addListener.mockImplementation(async (_event, callback) => {
    finish = callback;
    return { remove };
  });
  const providers = nativeAuthProviders(config, true) as { provide: unknown; useValue: unknown }[];
  const login = providers.find((p) => p.provide === NATIVE_GOOGLE_LOGIN)!
    .useValue as NativeGoogleLogin;
  const client = new AuthClient(true);
  vi.spyOn(client, 'nativeGoogle').mockImplementation(async ({ signal }) => {
    finish();
    expect(signal.aborted).toBe(true);
    throw new Error('cancelled');
  });
  await expect(login(client, new AbortController().signal)).rejects.toThrow('cancelled');
  expect(remove).toHaveBeenCalledOnce();
  expect(browser.close).toHaveBeenCalledOnce();
});
