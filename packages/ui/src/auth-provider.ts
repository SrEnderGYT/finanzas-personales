import { InjectionToken } from '@angular/core';
import { AuthClient } from './auth-client';

export const AUTH_CLIENT = new InjectionToken<AuthClient>('AUTH_CLIENT');

const OFFICIAL_PAGES_HOST = 'srendergyt.github.io';
const OFFICIAL_PAGES_PATH = '/finanzas-personales';
const OFFICIAL_PAGES_API = 'https://finanzas-personales-staging.onrender.com';

function officialPagesApi() {
  if (
    window.location.hostname === OFFICIAL_PAGES_HOST &&
    (window.location.pathname === OFFICIAL_PAGES_PATH ||
      window.location.pathname.startsWith(`${OFFICIAL_PAGES_PATH}/`))
  ) {
    return OFFICIAL_PAGES_API;
  }
  return undefined;
}

export function browserAuthClient() {
  const mode = document.querySelector<HTMLMetaElement>('meta[name="finanzas-auth"]')?.content;
  if (mode === 'same-origin') return new AuthClient(true);

  const configuredOrigin = document
    .querySelector<HTMLMetaElement>('meta[name="finanzas-api-origin"]')
    ?.content.trim();
  const origin = mode === 'remote' && configuredOrigin ? configuredOrigin : officialPagesApi();

  if (origin) {
    try {
      return AuthClient.forNativeServer(origin);
    } catch {
      return new AuthClient(false);
    }
  }

  return new AuthClient(false);
}
