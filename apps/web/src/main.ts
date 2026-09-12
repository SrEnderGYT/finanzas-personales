import { Component, isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withHashLocation, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { Shell, APP_ROUTES, AUTH_CLIENT, browserAuthClient } from '@finanzas/ui';

@Component({ selector: 'app-root', imports: [Shell], template: `<fp-shell />` })
class App {}

bootstrapApplication(App, {
  providers: [
    { provide: AUTH_CLIENT, useFactory: browserAuthClient },
    provideRouter(APP_ROUTES, withHashLocation(), withComponentInputBinding()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerImmediately',
    }),
  ],
}).catch(() => {
  document.body.textContent = 'No se pudo iniciar. Recarga para volver a intentar.';
});
