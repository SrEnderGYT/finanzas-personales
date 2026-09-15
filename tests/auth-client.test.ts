import { describe, it, expect, vi } from 'vitest';
import { AuthClient } from '../packages/ui/src/auth-client';

const token = `fp_${'a'.repeat(43)}`;
describe('browser auth transport', () => {
  it('keeps an MFA challenge separate from a session and exchanges it only with a code', async () => {
    const challenge = `fpm_${'b'.repeat(43)}`;
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ mfaRequired: true, challenge }));
    const client = new AuthClient(true, transport);
    await client.login('synthetic@example.test', 'synthetic');
    expect(client.signedIn).toBe(false);
    expect(client.mfaPending).toBe(true);
    transport.mockResolvedValueOnce(Response.json({ token }));
    await client.completeMfa('123456');
    expect(client.signedIn).toBe(true);
    expect(client.mfaPending).toBe(false);
    expect(transport.mock.calls[1]?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(transport.mock.calls[1]?.[1]?.body as string)).toEqual({
      challenge,
      code: '123456',
    });
  });
  it('disabled clients never send credentials and sessions are instance-only', async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(
      new AuthClient(false, transport).login('synthetic@example.test', 'synthetic'),
    ).rejects.toThrow('no está configurado');
    expect(transport).not.toHaveBeenCalled();
    transport.mockResolvedValueOnce(Response.json({ token }));
    const client = new AuthClient(true, transport);
    await client.login('synthetic@example.test', 'synthetic');
    expect(client.signedIn).toBe(true);
    expect(new AuthClient(true, transport).signedIn).toBe(false);
    transport.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.logout();
    expect(client.signedIn).toBe(false);
    expect(transport.mock.calls[1]?.[1]).toMatchObject({
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      redirect: 'error',
      credentials: 'same-origin',
      method: 'POST',
    });
  });
  it('keeps a session available to retry a failed remote logout, clears rejected sessions', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ token }));
    const client = new AuthClient(true, transport);
    await client.login('synthetic@example.test', 'synthetic');
    transport.mockRejectedValueOnce(new Error('internal network details'));
    await expect(client.logout(true)).rejects.toThrow('No pudimos conectar');
    expect(client.signedIn).toBe(true);
    transport.mockResolvedValueOnce(new Response(null, { status: 504 }));
    await expect(client.logout(true)).rejects.toThrow('No pudimos conectar');
    expect(client.signedIn).toBe(true);
    transport.mockResolvedValueOnce(
      Response.json({ secret: 'must never display' }, { status: 401 }),
    );
    await expect(client.sessions()).rejects.toThrow('sesión ha caducado');
    expect(client.signedIn).toBe(false);
  });
  it('rejects malformed session tokens and untrusted Google redirect destinations', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: 'invalid' }));
    const client = new AuthClient(true, transport);
    await expect(client.login('synthetic@example.test', 'synthetic')).rejects.toThrow('no válida');
    expect(client.signedIn).toBe(false);
    transport.mockResolvedValueOnce(Response.json({ authorizationUrl: 'https://example.test/' }));
    await expect(client.google('login')).rejects.toThrow('no es válida');
  });
});

it('recovery exchanges only the pending challenge and rejects malformed codes locally', async () => {
  const challenge = `fpm_${'b'.repeat(43)}`;
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ mfaRequired: true, challenge }));
  const client = new AuthClient(true, transport);
  await client.login('synthetic@example.test', 'synthetic');
  await expect(client.recoverMfa('123456')).rejects.toThrow('completo');
  expect(transport).toHaveBeenCalledTimes(1);
  transport.mockResolvedValueOnce(Response.json({ token }));
  const code = '01234567-89abcdef-01234567-89abcdef';
  await client.recoverMfa(code);
  expect(transport.mock.calls[1]?.[0]).toBe('/v1/auth/mfa/recover');
  expect(JSON.parse(transport.mock.calls[1]?.[1]?.body as string)).toEqual({ challenge, code });
  expect(client.signedIn).toBe(true);
  expect(client.mfaPending).toBe(false);
});

it('Google enrollment consumes a grant with the original session without accepting a new login', async () => {
  const grant = `fpr_${'g'.repeat(43)}`;
  const secret = 'A'.repeat(32);
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ token }))
    .mockResolvedValueOnce(Response.json({ reauthenticated: true, grant }))
    .mockResolvedValueOnce(Response.json({ secret }));
  const client = new AuthClient(true, transport);
  await client.login('synthetic@example.test', 'synthetic');
  expect(await client.beginMfaGoogle('synthetic-state', 'synthetic-code')).toBe(secret);
  expect(client.signedIn).toBe(true);
  expect(client.mfaPending).toBe(false);
  expect(transport.mock.calls[1]?.[0]).toBe('/v1/auth/google/complete');
  expect(transport.mock.calls[2]?.[0]).toBe('/v1/auth/mfa/enrollment/start');
  expect(JSON.parse(transport.mock.calls[2]?.[1]?.body as string)).toEqual({ grant });
  for (const call of transport.mock.calls.slice(1)) {
    expect(call[1]?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
  }
  transport.mockResolvedValueOnce(Response.json({ token: `fp_${'z'.repeat(43)}` }));
  await expect(client.beginMfaGoogle('state', 'code')).rejects.toThrow('verificar tu identidad');
  expect(transport).toHaveBeenCalledTimes(4);
  transport.mockResolvedValueOnce(Response.json([]));
  await client.sessions();
  expect(transport.mock.calls[4]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
});

it('Google enrollment requires a session and a valid grant, never treating MFA challenges as proof', async () => {
  const transport = vi.fn<typeof fetch>();
  const client = new AuthClient(true, transport);
  await expect(client.google('reauthenticate')).rejects.toThrow('Vuelve a entrar');
  await expect(client.beginMfaGoogle('state', 'code')).rejects.toThrow('Vuelve a entrar');
  expect(transport).not.toHaveBeenCalled();
  transport.mockResolvedValueOnce(Response.json({ token }));
  await client.login('synthetic@example.test', 'synthetic');
  for (const proof of [
    { reauthenticated: true, grant: 'invalid' },
    { mfaRequired: true, challenge: `fpm_${'b'.repeat(43)}` },
    { reauthenticated: false, grant: `fpr_${'g'.repeat(43)}` },
  ]) {
    transport.mockResolvedValueOnce(Response.json(proof));
    await expect(client.beginMfaGoogle('state', 'code')).rejects.toThrow('verificar tu identidad');
  }
  expect(transport).toHaveBeenCalledTimes(4);
  expect(client.mfaPending).toBe(false);
});
