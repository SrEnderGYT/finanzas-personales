import { Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';

@Component({
  selector: 'app-root',
  template: `<main>
    <h1>Finanzas · DEMO</h1>
    <p>Workspace web preparado. Sin datos reales.</p>
  </main>`,
})
class App {}
bootstrapApplication(App, { providers: [] }).catch(() => {
  document.body.textContent = 'No se pudo iniciar la aplicación.';
});
