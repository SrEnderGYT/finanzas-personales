import { Component, inject } from '@angular/core';
import { AUTH_CLIENT } from './auth-provider';
import { AuthScreen } from './auth-screen';
import { PublicAuthScreen } from './public-auth-screen';

@Component({
  selector: 'fp-latest-auth-screen',
  imports: [AuthScreen, PublicAuthScreen],
  template: `
    @if (auth.enabled) {
      <fp-auth-screen />
    } @else {
      <fp-public-auth-screen />
    }
  `,
})
export class LatestAuthScreen {
  readonly auth = inject(AUTH_CLIENT);
}
