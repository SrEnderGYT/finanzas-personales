import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { catalogQuery } from '../backend/api/src/catalog/read';
it('bounds private catalog queries and uses exact deterministic position/id cursors', () => {
  expect(catalogQuery('account', {})).toMatchObject({ limit: 50, state: 'active' });
  const id = randomUUID();
  expect(
    catalogQuery('account', { currency: 'USD', cursor: `2147483647:${id}`, limit: '100' }),
  ).toMatchObject({ currency: 'USD', cursor: { position: 2147483647, id } });
  for (const q of [
    { limit: '0' },
    { limit: '101' },
    { limit: '1e2' },
    { cursor: `2147483648:${id}` },
    { user_id: id },
    { kind: 'expense' },
  ])
    expect(() => catalogQuery('account', q)).toThrow();
  for (const q of [{ currency: 'PEN' }, { state: 'inactive' }, { kind: 'transfer' }])
    expect(() => catalogQuery('category', q)).toThrow();
});
