import { Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideIonicAngular, IonApp } from '@ionic/angular';
@Component({
  selector: 'app-root',
  imports: [IonApp],
  template: `<ion-app
    ><h1>Finanzas · DEMO</h1>
    <p>Workspace móvil preparado. Sin datos reales.</p></ion-app
  >`,
})
class App {}
bootstrapApplication(App, { providers: [provideIonicAngular()] }).catch(() => {
  document.body.textContent = 'No se pudo iniciar la aplicación.';
});
