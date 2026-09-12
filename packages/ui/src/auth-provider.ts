import { InjectionToken } from '@angular/core';
import { AuthClient } from './auth-client';

export const AUTH_CLIENT = new InjectionToken<AuthClient>('AUTH_CLIENT');

export function browserAuthClient() {
  const mode = document.querySelector<HTMLMetaElement>('meta[name="finanzas-auth"]')?.content;
  if (mode === 'same-origin') return new AuthClient(true);
  if (mode === 'remote') {
    const origin = document
      .querySelector<HTMLMetaElement>('meta[name="finanzas-api-origin"]')
      ?.content.trim();
    if (origin) {
      try {
        return AuthClient.forNativeServer(origin);
      } catch {
        return new AuthClient(false);
      }
    }
  }
  return new AuthClient(false);
}
