import { InjectionToken } from '@angular/core';
import type { AuthClient } from './auth-client';

export type NativeGoogleLogin = (
  client: AuthClient,
  signal: AbortSignal,
  mode?: 'login' | 'link',
) => Promise<void>;
export const NATIVE_GOOGLE_LOGIN = new InjectionToken<NativeGoogleLogin | null>(
  'NATIVE_GOOGLE_LOGIN',
  { factory: () => null },
);

export type NativeGoogleReauthentication = (
  client: AuthClient,
  signal: AbortSignal,
) => Promise<string>;
export const NATIVE_GOOGLE_REAUTHENTICATION =
  new InjectionToken<NativeGoogleReauthentication | null>('NATIVE_GOOGLE_REAUTHENTICATION', {
    factory: () => null,
  });
