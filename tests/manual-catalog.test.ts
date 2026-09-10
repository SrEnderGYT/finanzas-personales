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
        items: [{ id: category, name: 'Synthetic', kind: 'expense', state: 'active' }],
        nextCursor: null,
      });
    return new Response(null, { status: 204 });
  });
  const client = new AuthClient(true, transport),
    lock = vi.fn();
  client.onSessionChange(lock);
  await client.login('synthetic@example.test', 'synthetic');
  const loaded = await client.manualCatalog();
  expect(loaded.ownerId).toBe(id);
  expect(loaded.catalog.accounts[0]).not.toHaveProperty('balance');
  await client.logout();
  expect(lock).toHaveBeenCalledTimes(2);
});
it('permits only GET catalog reads on a fixed native origin', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({})),
    http = nativeAuthHttp('https://api.example.test', transport);
  await http('/v1/accounts?state=all&limit=100', { method: 'GET' });
  expect(transport).toHaveBeenCalledTimes(1);
  await expect(http('/v1/accounts', { method: 'POST' })).rejects.toThrow();
  await expect(http('/v1/manual', { method: 'GET' })).rejects.toThrow();
});
