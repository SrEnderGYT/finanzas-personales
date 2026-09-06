import { Component, isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withHashLocation, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { Shell, DEMO_ROUTES, MOBILE_MODE } from '@finanzas/ui';
import { provideIonicAngular, IonApp } from '@ionic/angular';
@Component({
  selector: 'app-root',
  imports: [Shell, IonApp],
  template: `<ion-app><fp-shell /></ion-app>`,
})
class App {}
bootstrapApplication(App, {
  providers: [
    provideIonicAngular(),
    { provide: MOBILE_MODE, useValue: true },
    provideRouter(DEMO_ROUTES, withHashLocation(), withComponentInputBinding()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerImmediately',
    }),
  ],
}).catch(() => {
  document.body.textContent = 'No se pudo iniciar. Recarga para volver a intentar.';
});
