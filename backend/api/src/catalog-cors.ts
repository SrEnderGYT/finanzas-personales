import type { FastifyInstance } from 'fastify';
/** Read-only catalog extension; auth routes retain their existing policy. */
export function registerCatalogCors(server: FastifyInstance) {
  server.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (!['/v1/me', '/v1/accounts', '/v1/categories'].includes(path!)) return;
    const origin = request.headers.origin;
    if (origin !== 'capacitor://localhost' && origin !== 'https://localhost') return;
    reply.header('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      const headers = request.headers['access-control-request-headers'];
      if (
        request.headers['access-control-request-method'] !== 'GET' ||
        (headers !== undefined &&
          (typeof headers !== 'string' ||
            headers.split(',').some((h) => h.trim().toLowerCase() !== 'authorization')))
      )
        return reply.code(403).send();
      reply
        .header('Access-Control-Allow-Origin', origin)
        .header('Access-Control-Allow-Methods', 'GET')
        .header('Access-Control-Allow-Headers', 'Authorization')
        .header('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
      return reply.code(204).send();
    }
    if (request.method === 'GET') reply.header('Access-Control-Allow-Origin', origin);
  });
}
