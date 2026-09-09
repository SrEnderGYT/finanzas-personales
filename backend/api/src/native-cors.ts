import type { FastifyInstance } from 'fastify';

const origins = new Set(['capacitor://localhost', 'https://localhost']);
const methods = new Set(['GET', 'POST', 'DELETE']);
const headers = new Set(['authorization', 'content-type']);

/** Opt-in for bundled Capacitor origins. This does not authenticate the caller. */
export function registerNativeCors(server: FastifyInstance) {
  server.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (!path.startsWith('/v1/auth/')) return;
    // Browser-cookie OAuth remains same-origin only.
    if (path.startsWith('/v1/auth/google/') && !path.startsWith('/v1/auth/google/native/')) return;
    reply.header('Vary', 'Origin');
    const origin = request.headers.origin;
    if (!origin || !origins.has(origin)) return;
    if (request.method === 'OPTIONS') {
      const method = request.headers['access-control-request-method'];
      const requested = request.headers['access-control-request-headers'];
      if (
        typeof method !== 'string' ||
        !methods.has(method) ||
        (requested !== undefined &&
          (typeof requested !== 'string' ||
            requested.split(',').some((name) => !headers.has(name.trim().toLowerCase()))))
      ) {
        return reply.code(403).send();
      }
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE');
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      reply.header('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
      return reply.code(204).send();
    }
    if (methods.has(request.method)) reply.header('Access-Control-Allow-Origin', origin);
  });
}
