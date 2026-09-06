import { describe, expect, it } from 'vitest';
import { assertDemo } from '../packages/shared/src/index';
describe('public preview boundary', () => {
  it('rejects records not explicitly synthetic', () => {
    expect(() => assertDemo({ demo: false })).toThrow();
  });
  it('accepts explicitly synthetic fixtures', () => {
    expect(() => assertDemo({ demo: true })).not.toThrow();
  });
});
