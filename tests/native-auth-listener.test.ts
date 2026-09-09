import type { AppPlugin } from '@capacitor/app';
import { afterEach, expect, it, vi } from 'vitest';
import { listenForNativeAuth } from '../packages/shared/src/native-auth-listener';

afterEach(() => vi.useRealTimers());
const redirect = 'https://auth.example.test/mobile/callback';
const state = 'a'.repeat(43);
it('registers Capacitor app links and removes only its own listener after a matching return', async () => {
  let receive!: (event: { url: string }) => void;
  const remove = vi.fn(async () => undefined);
  const app = {
    addListener: vi.fn(async (_name, callback) => {
      receive = callback;
      return { remove };
    }),
  };
  const listener = await listenForNativeAuth(
    app as unknown as AppPlugin,
    redirect,
    state,
    new AbortController().signal,
  );
  expect(app.addListener.mock.calls[0]?.[0]).toBe('appUrlOpen');
  receive({ url: 'https://other.example.test/?state=x' });
  expect(remove).not.toHaveBeenCalled();
  receive({ url: `${redirect}?state=${state}&code=synthetic` });
  await expect(listener.result).resolves.toEqual({ state, code: 'synthetic' });
  expect(remove).toHaveBeenCalledOnce();
  listener.cancel();
  expect(remove).toHaveBeenCalledOnce();
  const denied = await listenForNativeAuth(
    app as unknown as AppPlugin,
    redirect,
    state,
    new AbortController().signal,
  );
  receive({ url: `${redirect}?state=${state}&error=access_denied` });
  await expect(denied.result).rejects.toThrow('canceló');
  expect(remove).toHaveBeenCalledTimes(2);
});

it('removes a late native registration after cancellation and rejects expiry', async () => {
  vi.useFakeTimers();
  let register!: (handle: { remove: () => Promise<void> }) => void;
  const app = {
    addListener: vi.fn(
      () =>
        new Promise((resolve) => {
          register = resolve;
        }),
    ),
  };
  const controller = new AbortController();
  const pending = listenForNativeAuth(
    app as unknown as AppPlugin,
    redirect,
    state,
    controller.signal,
  );
  controller.abort();
  const remove = vi.fn(async () => undefined);
  register({ remove });
  const listener = await pending;
  await expect(listener.result).rejects.toThrow('canceló');
  expect(remove).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);

  app.addListener.mockResolvedValueOnce({ remove });
  const expired = await listenForNativeAuth(
    app as unknown as AppPlugin,
    redirect,
    state,
    new AbortController().signal,
  );
  const rejected = expect(expired.result).rejects.toThrow('caducó');
  vi.advanceTimersByTime(300000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
