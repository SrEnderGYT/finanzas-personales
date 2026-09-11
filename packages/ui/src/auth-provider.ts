import { InjectionToken } from '@angular/core';
import { AuthClient } from './auth-client';

export const AUTH_CLIENT = new InjectionToken<AuthClient>('AUTH_CLIENT', {
  factory: () =>
    new AuthClient(
      document.querySelector('meta[name="finanzas-auth"]')?.getAttribute('content') ===
        'same-origin',
      undefined,
      'same-origin',
      document.querySelector('meta[name="finanzas-stage"]')?.getAttribute('content') === 'private',
    ),
});
