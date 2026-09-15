// Explicit native-storage-test build only. Never used by production or published APKs.
import { Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withHashLocation, withComponentInputBinding } from '@angular/router';
import { provideIonicAngular, IonApp } from '@ionic/angular';
import { Shell, APP_ROUTES, MOBILE_MODE, AUTH_CLIENT } from '@finanzas/ui';
import { AuthClient } from '../../../packages/ui/src/auth-client';
import { demoManualCatalog, DEMO_PROFILE } from '../../../packages/shared/src/manual-session';

class StorageTestIdentity extends AuthClient {
  constructor() {
    super(
      true,
      async () => {
        throw new Error('Storage instrumentation never contacts an API');
      },
      'native-storage-test',
    );
  }
  override get signedIn() {
    return true;
  }
  override canUseOwner(owner: string) {
    return owner === DEMO_PROFILE.ownerId;
  }
  override async manualCatalog() {
    return { ownerId: DEMO_PROFILE.ownerId, catalog: demoManualCatalog() };
  }
}
@Component({
  selector: 'app-root',
  imports: [Shell, IonApp],
  template: `<ion-app><fp-shell /></ion-app>`,
})
class StorageTestApp {}

bootstrapApplication(StorageTestApp, {
  providers: [
    provideIonicAngular(),
    { provide: AUTH_CLIENT, useValue: new StorageTestIdentity() },
    { provide: MOBILE_MODE, useValue: true },
    provideRouter(APP_ROUTES, withHashLocation(), withComponentInputBinding()),
  ],
}).catch(() => {
  document.body.textContent = 'Storage test bootstrap failed';
});
