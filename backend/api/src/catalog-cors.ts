import type { FastifyInstance } from 'fastify';
/** Explicit catalog and sync capabilities; auth routes retain their existing policy. */
export function registerCatalogCors(server: FastifyInstance) {
  server.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    const movementRead = /^\/v1\/sync\/movements\/[0-9a-f-]{36}$/.test(path ?? '');
    if (
      !movementRead &&
      ![
        '/v1/me',
        '/v1/accounts',
        '/v1/categories',
        '/v1/sync/commands',
        '/v1/sync/changes',
        '/v1/sync/corrections',
      ].includes(path!)
    )
      return;
    const requestedMethod =
      request.method === 'OPTIONS'
        ? request.headers['access-control-request-method']
        : request.method;
    const catalogCreate =
      (path === '/v1/accounts' || path === '/v1/categories') && requestedMethod === 'POST';
    const method =
      catalogCreate || path === '/v1/sync/commands' || path === '/v1/sync/corrections'
        ? 'POST'
        : 'GET';
    const allowedHeaders =
      method === 'POST' ? ['authorization', 'content-type'] : ['authorization'];
    const origin = request.headers.origin;
    if (origin !== 'capacitor://localhost' && origin !== 'https://localhost') return;
    reply.header('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      const headers = request.headers['access-control-request-headers'];
      if (
        request.headers['access-control-request-method'] !== method ||
        (headers !== undefined &&
          (typeof headers !== 'string' ||
            headers.split(',').some((h) => !allowedHeaders.includes(h.trim().toLowerCase()))))
      )
        return reply.code(403).send();
      reply
        .header('Access-Control-Allow-Origin', origin)
        .header('Access-Control-Allow-Methods', method)
        .header('Access-Control-Allow-Headers', allowedHeaders.join(', '))
        .header('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
      return reply.code(204).send();
    }
    if (request.method === method) reply.header('Access-Control-Allow-Origin', origin);
  });
}
