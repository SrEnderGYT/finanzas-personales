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
    if (
      typeof input !== 'string' ||
      !/^\/v1\/auth\/[a-zA-Z0-9/-]+$/.test(input) ||
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
