/** Build-time trusted origin only. Never source this value from links or browser storage. */
export function nativeAuthHttp(apiOrigin: string, transport: typeof fetch = fetch): typeof fetch {
  const base = new URL(apiOrigin);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw new Error('A fixed HTTPS API origin is required.');
  return async (input, options) => {
    const catalogRead =
      typeof input === 'string' &&
      options?.method === 'GET' &&
      /^\/v1\/(me|accounts|categories)(\?[a-zA-Z0-9_:%=&.-]+)?$/.test(input);
    const syncCall =
      typeof input === 'string' &&
      (((input === '/v1/sync/commands' || input === '/v1/sync/corrections') &&
        options?.method === 'POST') ||
        (/^\/v1\/sync\/movements\/[0-9a-f-]{36}$/.test(input) && options?.method === 'GET') ||
        (/^\/v1\/sync\/changes(\?[a-zA-Z0-9_:%=&.-]+)?$/.test(input) && options?.method === 'GET'));
    if (
      typeof input !== 'string' ||
      (!/^\/v1\/auth\/[a-zA-Z0-9/-]+$/.test(input) && !catalogRead && !syncCall) ||
      input.includes('//')
    )
      throw new Error('Invalid authentication API path.');
    const destination = base.origin + input;
    const response = await transport(destination, {
      ...options,
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (response.redirected || (response.url && response.url !== destination))
      throw new Error('Unexpected authentication response destination.');
    return response;
  };
}
