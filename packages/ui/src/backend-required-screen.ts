import { Component } from '@angular/core';

@Component({
  selector: 'fp-backend-required-screen',
  template: `
    <section class="auth-layout" aria-labelledby="backend-title">
      <div class="auth-story">
        <span class="auth-eyebrow">FINANZAS PERSONALES</span>
        <h1 id="backend-title">Tu información empieza con tu cuenta.</h1>
        <p>
          Esta aplicación no muestra información financiera sin una sesión autenticada y no usa
          datos ficticios como reemplazo de tus datos.
        </p>
        <div class="auth-detail">
          <span aria-hidden="true">◇</span>
          <div>
            <strong>Acceso obligatorio</strong>
            <p>Inicio, movimientos, tarjetas, Gmail y presupuestos permanecen bloqueados.</p>
          </div>
        </div>
        <div class="auth-detail">
          <span aria-hidden="true">✉</span>
          <div>
            <strong>Gmail se conecta por separado</strong>
            <p>
              Cuando el API esté disponible podrás autorizar solo lectura y revisar lo detectado.
            </p>
          </div>
        </div>
      </div>
      <div class="auth-panel">
        <p class="auth-notice" role="status">
          <strong>Servidor de Finanzas no configurado</strong><br />
          El frontend está protegido, pero necesita la URL HTTPS del API privado para habilitar el
          inicio de sesión. No introduzcas credenciales hasta que aparezca el formulario activo.
        </p>
        <h2>Acceso protegido</h2>
        <p>
          En cuanto el API quede publicado, esta misma pantalla se convertirá automáticamente en el
          inicio de sesión real.
        </p>
      </div>
    </section>
  `,
})
export class BackendRequiredScreen {}
