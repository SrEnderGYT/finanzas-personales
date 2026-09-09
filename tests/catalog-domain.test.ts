import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { catalogName, normalizeCatalog, canonical } from '../packages/domain/src';
const envelope = () => ({
  operationId: randomUUID(),
  deviceId: randomUUID(),
  schemaVersion: 1,
  baseVersion: '0',
  command: {
    type: 'account.create',
    id: randomUUID(),
    payload: { name: '  Caja  ', type: 'cash', currency: 'PEN', state: 'active', position: 0 },
  },
});
describe('catalog contracts', () => {
  it('normalizes names and retains exact serializable commands', () => {
    expect(catalogName(' Cafe\u0301 ')).toBe('Café');
    const e = normalizeCatalog(envelope());
    expect(canonical(normalizeCatalog(JSON.parse(JSON.stringify(e))))).toBe(canonical(e));
    expect(() => catalogName('a\u0000b')).toThrow();
    expect(() => catalogName('a'.repeat(81))).toThrow();
  });
  it('rejects ownership, balances, invalid positions and currencies', () => {
    for (const extra of [
      { userId: randomUUID() },
      { balance: '10' },
      { currency: 'EUR' },
      { position: 0.5 },
      { position: 2147483648 },
      { state: 'inactive' },
    ]) {
      const e = envelope();
      Object.assign(e.command.payload, extra);
      expect(() => normalizeCatalog(e)).toThrow();
    }
  });
  it('separates creation from versioned mutable metadata', () => {
    const e = envelope();
    const update = {
      ...e,
      baseVersion: '1',
      command: { type: 'account.update', id: e.command.id, payload: { name: 'Caja' } },
    };
    expect(normalizeCatalog(update).baseVersion).toBe('1');
    expect(() => normalizeCatalog({ ...update, baseVersion: '0' })).toThrow();
    expect(() =>
      normalizeCatalog({ ...update, command: { ...update.command, payload: { currency: 'USD' } } }),
    ).toThrow();
    expect(() =>
      normalizeCatalog({ ...update, command: { ...update.command, payload: {} } }),
    ).toThrow();
    expect(() => normalizeCatalog({ ...e, user_id: randomUUID() })).toThrow();
  });
});
