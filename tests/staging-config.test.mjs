import { describe, expect, it } from 'vitest';
import { stagingConfig } from '../scripts/staging-config.mjs';

const fixture = {
  STAGING_ROLE_SECRET: 'synthetic-test-only-not-a-deployment-secret',
  STAGING_DATABASE_HOST: 'private-synthetic-db',
  STAGING_DATABASE_NAME: 'synthetic_staging',
};

describe('private staging configuration', () => {
  it('derives stable, separate restricted-role and encryption credentials', () => {
    const first = stagingConfig(fixture);
    expect(stagingConfig({ ...fixture })).toEqual(first);
    expect(first.roles.map((role) => role.group)).toEqual([
      'finanzas_runtime',
      'finanzas_auth_runtime',
    ]);
    expect(new Set(first.roles.map((role) => role.password)).size).toBe(2);
    expect(first.runtime.AUTH_MAIL_KEY).not.toBe(first.runtime.MFA_ENCRYPTION_KEY);
    for (const role of first.roles) expect(role.password).toMatch(/^[a-f0-9]{64}$/);
    expect(first.runtime.DATABASE_URL).toContain('@private-synthetic-db:5432/synthetic_staging');
    const rotated = stagingConfig({
      ...fixture,
      STAGING_ROLE_SECRET: fixture.STAGING_ROLE_SECRET + '2',
    });
    expect(rotated.runtime).not.toEqual(first.runtime);
  });

  it('fails closed for missing or malformed private configuration', () => {
    for (const secret of [undefined, '', 'short', 'x'.repeat(257)])
      expect(() => stagingConfig({ ...fixture, STAGING_ROLE_SECRET: secret })).toThrow();
    for (const host of [undefined, '', 'public.example.com', 'db/path', 'db:5432', 'user@db'])
      expect(() => stagingConfig({ ...fixture, STAGING_DATABASE_HOST: host })).toThrow();
    for (const name of [undefined, '', '../db', 'db?sslmode=disable', 'a'.repeat(64)])
      expect(() => stagingConfig({ ...fixture, STAGING_DATABASE_NAME: name })).toThrow();
  });
});
