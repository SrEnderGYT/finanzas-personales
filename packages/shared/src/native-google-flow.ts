import type { AppPlugin } from '@capacitor/app';
import { createNativeProof } from './native-pkce';
import { listenForNativeAuth } from './native-auth-listener';

export interface NativeGoogleTransport<T> {
  start(
    input: { state: string; challenge: string; method: 'S256' },
    signal: AbortSignal,
  ): Promise<string>;
  complete(
    input: { state: string; code: string; verifier: string },
    signal: AbortSignal,
  ): Promise<T>;
}

/** Native orchestration port: no WebView navigation and no client secret. */
export async function nativeGoogleFlow<T>(options: {
  app: Pick<AppPlugin, 'addListener'>;
  browser: { open(options: { url: string }): Promise<void> };
  transport: NativeGoogleTransport<T>;
  redirectUri: string;
  signal: AbortSignal;
}): Promise<T> {
  const proof = await createNativeProof();
  const lifetime = new AbortController();
  const abort = () => lifetime.abort();
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) lifetime.abort();
  const timeout = setTimeout(abort, 300000);
  let listener: Awaited<ReturnType<typeof listenForNativeAuth>> | undefined;
  try {
    listener = await listenForNativeAuth(
      options.app,
      options.redirectUri,
      proof.state,
      lifetime.signal,
    );
    const address = await options.transport.start(
      { state: proof.state, challenge: proof.challenge, method: proof.method },
      lifetime.signal,
    );
    if (lifetime.signal.aborted) throw new Error('La verificación se canceló.');
    const url = new URL(address);
    if (
      url.origin !== 'https://accounts.google.com' ||
      url.pathname !== '/o/oauth2/v2/auth' ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.getAll('state').length !== 1 ||
      url.searchParams.get('state') !== proof.state
    )
      throw new Error('La dirección de Google no es válida.');
    await options.browser.open({ url: url.href });
    const result = await listener.result;
    if (lifetime.signal.aborted) throw new Error('La verificación se canceló.');
    return await options.transport.complete(
      { ...result, verifier: proof.verifier },
      lifetime.signal,
    );
  } finally {
    proof.verifier = '';
    listener?.cancel();
    clearTimeout(timeout);
    options.signal.removeEventListener('abort', abort);
    lifetime.abort();
  }
}
