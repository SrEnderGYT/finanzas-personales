import { describe, expect, it } from 'vitest';
import { createApp } from '../backend/api/src/app';
describe('Nest/Fastify integration', () => {
  it('allows only configured native origins and auth preflight without cookies or authentication bypass', async () => {
    const app = await createApp({ nativeAuthCors: true });
    const preflight = (
      origin: string,
      url = '/v1/auth/google/native/start',
      method = 'POST',
      headers = 'content-type,authorization',
    ) =>
      app.inject({
        method: 'OPTIONS',
        url,
        headers: {
          origin,
          'access-control-request-method': method,
          'access-control-request-headers': headers,
        },
      });
    try {
      for (const origin of ['capacitor://localhost', 'https://localhost']) {
        for (const path of ['/v1/me', '/v1/accounts', '/v1/categories']) {
          const catalog = await preflight(origin, path, 'GET', 'authorization');
          expect(catalog.statusCode).toBe(204);
          expect(catalog.headers['access-control-allow-origin']).toBe(origin);
          expect(catalog.headers['access-control-allow-methods']).toBe('GET');
          expect(catalog.headers['access-control-allow-credentials']).toBeUndefined();
          expect((await preflight(origin, path, 'POST', 'authorization')).statusCode).toBe(403);
          expect((await preflight(origin, path, 'GET', 'x-user-id')).statusCode).toBe(403);
        }
        const result = await preflight(origin);
        expect(result.statusCode).toBe(204);
        expect(result.headers['access-control-allow-origin']).toBe(origin);
        expect(result.headers['access-control-allow-credentials']).toBeUndefined();
        expect(result.headers['cache-control']).toBe('no-store');
        const denied = await app.inject({
          method: 'GET',
          url: '/v1/auth/sessions',
          headers: { origin },
        });
        expect(denied.statusCode).toBe(503); // This app has no session service configured.
        expect(denied.headers['access-control-allow-origin']).toBe(origin);
      }
      for (const origin of [
        'null',
        'http://localhost',
        'https://localhost.evil.test',
        'https://other.example.test',
      ])
        expect((await preflight(origin)).headers['access-control-allow-origin']).toBeUndefined();
      for (const path of ['/v1/me', '/v1/auth/google/start', '/v1/auth/google/complete'])
        expect(
          (await preflight('capacitor://localhost', path)).headers['access-control-allow-origin'],
        ).toBeUndefined();
      expect((await preflight('capacitor://localhost', undefined, 'PATCH')).statusCode).toBe(403);
      expect(
        (await preflight('capacitor://localhost', undefined, 'POST', 'x-custom')).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
    const disabled = await createApp();
    try {
      const result = await disabled.inject({
        method: 'OPTIONS',
        url: '/v1/auth/login',
        headers: { origin: 'capacitor://localhost', 'access-control-request-method': 'POST' },
      });
      expect(result.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await disabled.close();
    }
  });
  it('serves health without exposing configuration and protects catalog endpoints', async () => {
    const app = await createApp();
    try {
      const health = await app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({
        status: 'ok',
        environment: 'development',
        financialData: false,
      });
      expect((await app.inject({ method: 'GET', url: '/v1/accounts' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/v1/categories' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/v1/transactions' })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/v1' })).json().version).toBe('1');
      expect((await app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
      const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json();
      expect(
        spec.paths['/v1/me/preferences'].patch.requestBody.content['application/json'].schema
          .additionalProperties,
      ).toBe(false);
      expect(spec.paths['/v1/me'].get.security).toEqual([{ bearer: [] }]);
    } finally {
      await app.close();
    }
  });
});
