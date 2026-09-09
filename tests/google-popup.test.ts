import { afterEach, expect, it, vi } from 'vitest';
import { googleReauthentication, relayGoogleReturn } from '../packages/ui/src/google-popup';

function fixture() {
  vi.useFakeTimers();
  const popup = {
    closed: false,
    close: vi.fn(),
    sessionStorage: { setItem: vi.fn() },
    location: { replace: vi.fn() },
  };
  const events = new EventTarget();
  const host = Object.assign(events, {
    location: { origin: 'https://finanzas.example.test' },
    open: vi.fn(() => popup),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  const callback = {
    type: 'finanzas.google-reauth-return',
    state: 'synthetic-state',
    code: 'synthetic-code',
    error: false,
  };
  const send = (
    origin = host.location.origin,
    source: unknown = popup,
    data: unknown = callback,
  ) => {
    events.dispatchEvent(Object.assign(new Event('message'), { origin, source, data }));
  };
  const start = vi.fn(
    async () => 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic-state',
  );
  return { popup, host: host as unknown as Window, start, send, callback };
}
afterEach(() => vi.useRealTimers());

it('accepts only the opened window, exact origin and matching state, then removes its listener', async () => {
  const { popup, host, start, send, callback } = fixture();
  const result = googleReauthentication(start, new AbortController().signal, host);
  await Promise.resolve();
  expect(popup.location.replace).toHaveBeenCalledOnce();
  send('https://attacker.example.test');
  send(undefined, {});
  send(undefined, undefined, { ...callback, state: 'different' });
  expect(popup.close).not.toHaveBeenCalled();
  send();
  await expect(result).resolves.toEqual({ state: callback.state, code: callback.code });
  expect(popup.close).toHaveBeenCalledOnce();
  send();
  expect(popup.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('cleans up on cancellation, blocked popup, closed popup, timeout and failed start', async () => {
  for (const kind of ['abort', 'closed', 'timeout', 'start'] as const) {
    const { popup, host, start } = fixture();
    const controller = new AbortController();
    if (kind === 'start') start.mockRejectedValueOnce(new Error('private diagnostic'));
    const result = googleReauthentication(start, controller.signal, host);
    const rejected = expect(result).rejects.toThrow(/canceló|cerró|caducó|No se pudo/);
    await Promise.resolve();
    if (kind === 'abort') controller.abort();
    if (kind === 'closed') {
      popup.closed = true;
      vi.advanceTimersByTime(500);
    }
    if (kind === 'timeout') vi.advanceTimersByTime(300000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  }
  const { host, start } = fixture();
  vi.mocked(host.open).mockReturnValueOnce(null);
  await expect(googleReauthentication(start, new AbortController().signal, host)).rejects.toThrow(
    'Permite',
  );
  expect(start).not.toHaveBeenCalled();
});

it('relays only marked popup callbacks to the exact local origin', () => {
  const host = {
    location: { origin: 'https://finanzas.example.test' },
    sessionStorage: { getItem: vi.fn(() => '1'), removeItem: vi.fn() },
    opener: { postMessage: vi.fn() },
    close: vi.fn(),
  };
  const callback = { state: 'synthetic-state', code: 'synthetic-code', error: false };
  expect(relayGoogleReturn(callback, host as unknown as Window)).toBe(true);
  expect(host.opener.postMessage).toHaveBeenCalledWith(
    { type: 'finanzas.google-reauth-return', ...callback },
    host.location.origin,
  );
  expect(host.sessionStorage.removeItem).toHaveBeenCalledOnce();
  expect(host.close).toHaveBeenCalledOnce();
  host.sessionStorage.getItem.mockReturnValue('');
  expect(relayGoogleReturn(callback, host as unknown as Window)).toBe(false);
  expect(host.opener.postMessage).toHaveBeenCalledOnce();
});
