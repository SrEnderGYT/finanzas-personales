import { Component, inject } from '@angular/core';
import { AUTH_CLIENT } from './auth-provider';
import { GmailPreview } from './gmail-preview';
import { GmailScreen } from './gmail-screen';

@Component({
  selector: 'fp-latest-gmail-screen',
  imports: [GmailPreview, GmailScreen],
  template: `
    @if (auth.enabled) {
      <fp-gmail-screen />
    } @else {
      <fp-gmail-preview />
    }
  `,
})
export class LatestGmailScreen {
  readonly auth = inject(AUTH_CLIENT);
}
