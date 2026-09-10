import { it, expect, vi } from 'vitest';
import { AuthClient } from '../packages/ui/src/auth-client';
import { nativeAuthHttp } from '../packages/shared/src/native-auth-http';
it('downloads catalog with encapsulated token and locks consumers on session changes', async () => {
  const id = crypto.randomUUID(),
    account = crypto.randomUUID(),
    category = crypto.randomUUID();
  const transport = vi.fn<typeof fetch>(async (input) => {
    const path = String(input);
    if (path === '/v1/auth/login') return Response.json({ token: 'fp_' + 'x'.repeat(43) });
    if (path === '/v1/me') return Response.json({ id });
    if (path.startsWith('/v1/accounts'))
      return Response.json({
        items: [
          {
            id: account,
            version: '1',
            name: 'Synthetic',
            currency: 'PEN',
            state: 'active',
            balance: { amountMinor: '999', currency: 'PEN' },
          },
        ],
        nextCursor: null,
      });
    if (path.startsWith('/v1/categories'))
      return Response.json({
        items: [
          { id: category, version: '1', name: 'Synthetic', kind: 'expense', state: 'active' },
        ],
        nextCursor: null,
      });
    return new Response(null, { status: 204 });
  });
  const client = new AuthClient(true, transport),
    lock = vi.fn();
  client.onSessionChange(lock);
  await client.login('synthetic@example.test', 'synthetic');
  expect(client.canUseOwner(id)).toBe(false);
  const loaded = await client.manualCatalog();
  expect(client.canUseOwner(id)).toBe(true);
  await expect(
    client.syncApi(crypto.randomUUID()).send({}, new AbortController().signal),
  ).rejects.toMatchObject({ status: 401 });
  expect(loaded.ownerId).toBe(id);
  expect(loaded.catalog.accounts[0]).not.toHaveProperty('balance');
  expect(loaded.catalog.accounts[0]?.version).toBe('1');
  await client.logout();
  expect(client.canUseOwner(id)).toBe(false);
  await expect(client.syncApi(id).send({}, new AbortController().signal)).rejects.toMatchObject({
    status: 401,
  });
  expect(lock).toHaveBeenCalledTimes(2);
});
it('native sync capability stays on its fixed HTTPS origin and cannot send to another path', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
  const http = nativeAuthHttp('https://api.example.test', transport);
  await http('/v1/sync/commands', { method: 'POST', body: '{}' });
  await http('/v1/sync/changes?cursor=abc_123-xyz', { method: 'GET' });
  expect(transport.mock.calls.map((call) => call[0])).toEqual([
    'https://api.example.test/v1/sync/commands',
    'https://api.example.test/v1/sync/changes?cursor=abc_123-xyz',
  ]);
  await expect(http('/v1/sync/changes', { method: 'POST' })).rejects.toThrow();
  await expect(
    http('https://other.example.test/v1/sync/commands', { method: 'POST' }),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(2);
});
it('permits only GET catalog reads on a fixed native origin', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({})),
    http = nativeAuthHttp('https://api.example.test', transport);
  await http('/v1/accounts?state=all&limit=100', { method: 'GET' });
  expect(transport).toHaveBeenCalledTimes(1);
  await expect(http('/v1/accounts', { method: 'POST' })).rejects.toThrow();
  await expect(http('/v1/manual', { method: 'GET' })).rejects.toThrow();
});
