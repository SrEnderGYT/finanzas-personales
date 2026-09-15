import { Component } from '@angular/core';
import { AuthScreen } from './auth-screen';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'fp-latest-auth-screen',
  imports: [AuthScreen, RouterLink],
  template: `<fp-auth-screen />
    <p class="zone-note"><a routerLink="/dispositivo">Abrir espacio local sin conexión</a></p>`,
})
export class LatestAuthScreen {}
