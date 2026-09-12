import type { FastifyInstance } from 'fastify';

const methods = new Set(['GET', 'POST', 'DELETE']);
const headers = new Set(['authorization', 'content-type']);

function normalizeOrigins(values: readonly string[]) {
  const result = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new Error('WEB_ALLOWED_ORIGINS must contain HTTPS origins only.');
    result.add(url.origin);
  }
  return result;
}

/** Explicit opt-in CORS for the authenticated web/PWA client. */
export function registerWebCors(server: FastifyInstance, allowed: readonly string[]) {
  const origins = normalizeOrigins(allowed);
  if (origins.size === 0) return;
  server.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (!path.startsWith('/v1/')) return;
    const origin = request.headers.origin;
    if (!origin || !origins.has(origin)) return;
    reply.header('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      const method = request.headers['access-control-request-method'];
      const requested = request.headers['access-control-request-headers'];
      if (
        typeof method !== 'string' ||
        !methods.has(method) ||
        (requested !== undefined &&
          (typeof requested !== 'string' ||
            requested.split(',').some((name) => !headers.has(name.trim().toLowerCase()))))
      )
        return reply.code(403).send();
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE');
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      reply.header('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
      return reply.code(204).send();
    }
    if (methods.has(request.method)) reply.header('Access-Control-Allow-Origin', origin);
  });
}
