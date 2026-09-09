import type { Provider } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { AUTH_CLIENT } from '../../../packages/ui/src/auth-provider';
import { AuthClient } from '../../../packages/ui/src/auth-client';
import { NATIVE_GOOGLE_LOGIN, type NativeGoogleLogin } from '../../../packages/ui/src/native-auth';
import { NativeAuthReturn } from '../../../packages/shared/src/native-auth-return';

export function nativeAuthProviders(
  config: { apiOrigin: string; redirectUri: string } | null,
  native = Capacitor.isNativePlatform(),
): Provider[] {
  if (!config || !native) return [];
  new NativeAuthReturn(config.redirectUri); // Reject an invalid build configuration before bootstrapping.
  const client = AuthClient.forNativeServer(config.apiOrigin);
  const login: NativeGoogleLogin = async (auth, signal) => {
    const closed = new AbortController();
    const listener = await Browser.addListener('browserFinished', () => closed.abort());
    try {
      await auth.nativeGoogle({
        app: App,
        browser: Browser,
        redirectUri: config.redirectUri,
        signal: AbortSignal.any([signal, closed.signal]),
      });
    } finally {
      await listener.remove().catch(() => undefined);
      await Browser.close().catch(() => undefined);
    }
  };
  return [
    { provide: AUTH_CLIENT, useValue: client },
    { provide: NATIVE_GOOGLE_LOGIN, useValue: login },
  ];
}
