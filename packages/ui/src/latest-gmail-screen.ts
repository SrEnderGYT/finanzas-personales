import { Component, inject } from '@angular/core';
import { AUTH_CLIENT } from './auth-provider';
import { GmailScreen } from './gmail-screen';
import { GmailLockedScreen } from './gmail-locked-screen';

@Component({
  selector: 'fp-latest-gmail-screen',
  imports: [GmailScreen, GmailLockedScreen],
  template: `
    @if (auth.enabled) {
      <fp-gmail-screen />
    } @else {
      <fp-gmail-locked-screen />
    }
  `,
})
export class LatestGmailScreen {
  readonly auth = inject(AUTH_CLIENT);
}
