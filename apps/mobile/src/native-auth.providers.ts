import type { Provider } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { AUTH_CLIENT } from '../../../packages/ui/src/auth-provider';
import { AuthClient } from '../../../packages/ui/src/auth-client';
import {
  NATIVE_GOOGLE_LOGIN,
  NATIVE_GOOGLE_REAUTHENTICATION,
  type NativeGoogleLogin,
} from '../../../packages/ui/src/native-auth';
import { NativeAuthReturn } from '../../../packages/shared/src/native-auth-return';

export function nativeAuthProviders(
  config: { apiOrigin: string; redirectUri: string } | null,
  native = Capacitor.isNativePlatform(),
): Provider[] {
  if (!config || !native) return [];
  new NativeAuthReturn(config.redirectUri); // Reject an invalid build configuration before bootstrapping.
  const client = AuthClient.forNativeServer(config.apiOrigin);
  const run = async <T>(
    signal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    const closed = new AbortController();
    const listener = await Browser.addListener('browserFinished', () => closed.abort());
    try {
      return await operation(AbortSignal.any([signal, closed.signal]));
    } finally {
      await listener.remove().catch(() => undefined);
      await Browser.close().catch(() => undefined);
    }
  };
  const options = (signal: AbortSignal) => ({
    app: App,
    browser: Browser,
    redirectUri: config.redirectUri,
    signal,
  });
  const login: NativeGoogleLogin = (auth, signal) =>
    run(signal, (active) => auth.nativeGoogle(options(active)));
  return [
    { provide: AUTH_CLIENT, useValue: client },
    { provide: NATIVE_GOOGLE_LOGIN, useValue: login },
    {
      provide: NATIVE_GOOGLE_REAUTHENTICATION,
      useValue: (auth: AuthClient, signal: AbortSignal) =>
        run(signal, (active) => auth.beginMfaNativeGoogle(options(active))),
    },
  ];
}
