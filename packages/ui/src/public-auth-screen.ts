import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UI_PRIMITIVES } from './primitives';

@Component({
  selector: 'fp-public-auth-screen',
  imports: [RouterLink, ...UI_PRIMITIVES],
  styleUrl: './public-auth-screen.css',
  template: `
    <section class="public-auth" aria-labelledby="public-auth-title">
      <div class="auth-brand-panel">
        <a class="auth-brand" routerLink="/inicio" aria-label="Ir a Mis finanzas">
          <span class="auth-brand-mark">f<span>↗</span></span>
          <strong>finanzas<span>.</span></strong>
        </a>
        <div class="auth-brand-copy">
          <span class="auth-overline">TU DINERO, MÁS CLARO</span>
          <h1 id="public-auth-title">Tus finanzas.<br />Un solo lugar.</h1>
          <p>
            Organiza cuentas, movimientos, tarjetas, presupuestos y automatizaciones sin perder el
            control de tus datos.
          </p>
        </div>
        <div class="auth-benefits">
          <article><span>✓</span><div><strong>Privacidad por diseño</strong><p>Tu espacio real se abre únicamente con una sesión autenticada.</p></div></article>
          <article><span>✓</span><div><strong>Web y móvil</strong><p>La misma información disponible en tus dispositivos.</p></div></article>
          <article><span>✓</span><div><strong>Automatización consciente</strong><p>Gmail usa un permiso separado y de solo lectura.</p></div></article>
        </div>
      </div>

      <div class="auth-form-panel">
        <div class="login-card">
          <div class="login-heading">
            <span>ACCESO</span>
            <h2>Bienvenido de nuevo</h2>
            <p>Ingresa a tu espacio financiero personal.</p>
          </div>

          <form aria-label="Inicio de sesión">
            <label>
              Correo electrónico
              <input fpInput type="email" placeholder="tu@correo.com" readonly aria-describedby="public-login-note" />
            </label>
            <label>
              Contraseña
              <input fpInput type="password" value="finanzas-seguras" readonly aria-describedby="public-login-note" />
            </label>
            <div class="login-options">
              <label class="remember"><input type="checkbox" disabled /> Recordarme</label>
              <span>¿Olvidaste tu contraseña?</span>
            </div>
            <button fpButton type="button" disabled>Entrar</button>
          </form>

          <div class="login-divider"><span>o continúa con</span></div>
          <button class="google-button" type="button" disabled>
            <span aria-hidden="true">G</span> Continuar con Google
          </button>

          <p id="public-login-note" class="login-note">
            La publicación pública no procesa credenciales. El formulario real se activa cuando el
            backend privado está conectado.
          </p>

          <a fpButton class="explore-button" routerLink="/inicio">Explorar Mis finanzas</a>
          <p class="create-account">¿Aún no tienes cuenta? <span>Crear cuenta</span></p>
        </div>
      </div>
    </section>
  `,
})
export class PublicAuthScreen {}
