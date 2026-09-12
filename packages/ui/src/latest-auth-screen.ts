import { Component } from '@angular/core';
import { AuthScreen } from './auth-screen';

@Component({
  selector: 'fp-latest-auth-screen',
  imports: [AuthScreen],
  template: `<fp-auth-screen />`,
})
export class LatestAuthScreen {}
