import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AUTH_CLIENT } from './auth-provider';

export const authenticatedGuard: CanActivateFn = () => {
  const auth = inject(AUTH_CLIENT);
  if (auth.enabled && auth.signedIn) return true;
  return inject(Router).createUrlTree(['/acceso']);
};
