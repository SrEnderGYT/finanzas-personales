import type { AppPlugin } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { NativeAuthReturn, type NativeAuthResult } from './native-auth-return';

/** Register before opening the system browser; caller exchanges code with its PKCE proof. */
export async function listenForNativeAuth(
  app: Pick<AppPlugin, 'addListener'>,
  redirectUri: string,
  state: string,
  signal: AbortSignal,
): Promise<{ result: Promise<NativeAuthResult>; cancel: () => void }> {
  const flow = new NativeAuthReturn(redirectUri);
  if (signal.aborted) throw new Error('La verificación se canceló.');
  flow.begin(state);
  let handle: PluginListenerHandle | undefined;
  let settled = false;
  let resolve!: (result: NativeAuthResult) => void;
  let reject!: (error: Error) => void;
  const result = new Promise<NativeAuthResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // The listener may be cancelled while native registration is still pending.
  void result.catch(() => undefined);
  const remove = () => {
    if (handle) void handle.remove().catch(() => undefined);
  };
  const finish = (value?: NativeAuthResult) => {
    if (settled) return;
    settled = true;
    flow.cancel();
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    remove();
    if (value) resolve(value);
    else reject(new Error('La verificación se canceló o caducó. Vuelve a intentarlo.'));
  };
  const cancel = () => finish();
  const timer = setTimeout(cancel, 300000);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    handle = await app.addListener('appUrlOpen', ({ url }) => {
      const value = flow.consume(url);
      if (value) finish(value);
      else if (!flow.waiting) cancel();
    });
    if (settled) remove();
  } catch {
    cancel();
    throw new Error('No se pudo preparar el retorno a la aplicación.');
  }
  return { result, cancel };
}
