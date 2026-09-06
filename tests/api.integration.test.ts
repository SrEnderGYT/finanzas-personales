import { describe, expect, it } from 'vitest';
import { createApp } from '../backend/api/src/app';
describe('Nest/Fastify integration', () => {
  it('serves health without exposing configuration or financial endpoints', async () => {
    const app = await createApp();
    try {
      const health = await app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({
        status: 'ok',
        environment: 'development',
        financialData: false,
      });
      expect((await app.inject({ method: 'GET', url: '/v1/accounts' })).statusCode).toBe(404);
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
