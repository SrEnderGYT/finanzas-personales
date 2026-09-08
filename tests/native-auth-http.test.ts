import { expect, it, vi } from 'vitest';
import { nativeAuthHttp } from '../packages/shared/src/native-auth-http';

it('sends credentials only to the fixed HTTPS origin and enforces no cookies, redirects or cache', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
  const http = nativeAuthHttp('https://api.example.test', transport);
  const signal = new AbortController().signal;
  await http('/v1/auth/google/native/complete', {
    method: 'POST',
    body: '{"code":"synthetic"}',
    headers: { Authorization: 'Bearer synthetic' },
    credentials: 'include',
    redirect: 'follow',
    cache: 'force-cache',
    signal,
  });
  expect(transport).toHaveBeenCalledWith(
    'https://api.example.test/v1/auth/google/native/complete',
    expect.objectContaining({
      method: 'POST',
      body: '{"code":"synthetic"}',
      headers: { Authorization: 'Bearer synthetic' },
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal,
    }),
  );
});

it('rejects destinations and path traversal before any request', async () => {
  const transport = vi.fn<typeof fetch>();
  for (const origin of [
    'http://api.example.test',
    'https://user@api.example.test',
    'https://api.example.test/base',
    'https://api.example.test/?x=y',
    'https://api.example.test/#x',
  ])
    expect(() => nativeAuthHttp(origin, transport)).toThrow('fixed HTTPS');
  const http = nativeAuthHttp('https://api.example.test', transport);
  for (const path of [
    'https://other.example.test/v1/auth/login',
    '//other.example.test',
    '/v1/auth/../other',
    '/v1/auth/%2e%2e/other',
    '/v1/auth/login?next=x',
    '/v1/auth//login',
    '/v1/me',
  ])
    await expect(http(path)).rejects.toThrow('Invalid authentication');
  expect(transport).not.toHaveBeenCalled();
});

it('rejects a transport that reports a redirect or unexpected response URL', async () => {
  const response = Response.json({});
  Object.defineProperty(response, 'url', { value: 'https://other.example.test/v1/auth/login' });
  const http = nativeAuthHttp(
    'https://api.example.test',
    vi.fn<typeof fetch>().mockResolvedValue(response),
  );
  await expect(http('/v1/auth/login')).rejects.toThrow('Unexpected');
});
