import { expect, it } from 'vitest';
import { NativeAuthReturn } from '../packages/shared/src/native-auth-return';

const destination = 'https://auth.example.test/mobile/callback';
const state = 'a'.repeat(43);
const address = `${destination}?state=${state}&code=synthetic-code`;

it('accepts exactly one correlated app link and never resumes an unrequested cold launch', () => {
  const flow = new NativeAuthReturn(destination);
  expect(flow.consume(address)).toBeNull();
  flow.begin(state);
  expect(() => flow.begin('b'.repeat(43))).toThrow('already pending');
  expect(flow.consume(address)).toEqual({ state, code: 'synthetic-code' });
  expect(flow.consume(address)).toBeNull();
  expect(new NativeAuthReturn(destination).consume(address)).toBeNull();
});

it('rejects unrelated host, path, credentials, fragment and state without consuming the valid flow', () => {
  const flow = new NativeAuthReturn(destination);
  flow.begin(state);
  for (const invalid of [
    address.replace('auth.example.test', 'attacker.example.test'),
    address.replace('/mobile/callback', '/mobile/callback/other'),
    address.replace('https://', 'http://'),
    address.replace('https://', 'https://other@'),
    address + '#fragment',
    address.replace(state, 'b'.repeat(43)),
    address + `&state=${state}`,
    'not a URL',
  ])
    expect(flow.consume(invalid)).toBeNull();
  expect(flow.consume(address)?.code).toBe('synthetic-code');
});

it('expires at five minutes and cancellation clears pending identity', () => {
  let now = 1000;
  const flow = new NativeAuthReturn(destination, () => now);
  flow.begin(state);
  now += 300000;
  expect(flow.consume(address)).toBeNull();
  flow.begin(state);
  flow.cancel();
  expect(flow.consume(address)).toBeNull();
});

it('consumes malformed correlated replies and never accepts session or token URL parameters', () => {
  for (const query of ['&token=synthetic', '&error=access_denied', '&code=second']) {
    const flow = new NativeAuthReturn(destination);
    flow.begin(state);
    expect(flow.consume(address + query)).toBeNull();
    expect(flow.consume(address)).toBeNull();
  }
  for (const uri of [
    'http://auth.example.test/mobile/callback',
    destination + '?next=x',
    destination + '#x',
    'app.finanzas://callback',
  ])
    expect(() => new NativeAuthReturn(uri)).toThrow();
});
