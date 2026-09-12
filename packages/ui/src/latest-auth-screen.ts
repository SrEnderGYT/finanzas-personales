import { Component, inject } from '@angular/core';
import { AUTH_CLIENT } from './auth-provider';
import { AuthScreen } from './auth-screen';
import { BackendRequiredScreen } from './backend-required-screen';

@Component({
  selector: 'fp-latest-auth-screen',
  imports: [AuthScreen, BackendRequiredScreen],
  template: `
    @if (auth.enabled) {
      <fp-auth-screen />
    } @else {
      <fp-backend-required-screen />
    }
  `,
})
export class LatestAuthScreen {
  readonly auth = inject(AUTH_CLIENT);
}
