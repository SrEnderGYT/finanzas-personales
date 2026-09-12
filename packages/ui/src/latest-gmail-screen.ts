import { Component } from '@angular/core';
import { GmailScreen } from './gmail-screen';

@Component({
  selector: 'fp-latest-gmail-screen',
  imports: [GmailScreen],
  template: `<fp-gmail-screen />`,
})
export class LatestGmailScreen {}
