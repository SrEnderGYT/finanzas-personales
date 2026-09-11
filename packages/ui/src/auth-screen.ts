import { MfaEnrollment } from './mfa-enrollment';
import { relayGoogleReturn } from './google-popup';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { NATIVE_GOOGLE_LOGIN } from './native-auth';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthSession } from './auth-client';

import { AUTH_CLIENT } from './auth-provider';
export { AUTH_CLIENT } from './auth-provider';
type Mode =
  'recovery' | 'mfa' | 'login' | 'register' | 'forgot-password' | 'verify-email' | 'reset-password';

// Capture once before Angular's hash router replaces the initial URL.
function captureCallback() {
  const query = new URLSearchParams(location.search);
  if (!query.has('state') && !query.has('code') && !query.has('error')) return null;
  const callback = {
    state: query.get('state'),
    code: query.get('code'),
    error: query.has('error'),
  };
  history.replaceState(null, '', `${location.pathname}#/acceso`);
  if (relayGoogleReturn(callback)) return null;
  return callback;
}
let pendingCallback = captureCallback();

@Component({
  selector: 'fp-auth-screen',
  imports: [FormsModule, RouterLink, DatePipe, MfaEnrollment],
  template: `
    <section class="auth-layout" aria-labelledby="auth-title">
      <div class="auth-story">
        <span class="auth-eyebrow">TU ESPACIO PERSONAL</span>
        <h1 id="auth-title">Un lugar para<br />tenerlo claro.</h1>
        <p>Accede a tu cuenta y controla las sesiones abiertas en tus dispositivos.</p>
        <div class="auth-detail">
          <span aria-hidden="true">◇</span>
          <div>
            <strong>Tu acceso, bajo control</strong>
            <p>Puedes cerrar una sesión o revocarlas todas.</p>
          </div>
        </div>
        <div class="auth-detail">
          <span aria-hidden="true">✉</span>
          <div>
            <strong>Google sin acceso a tus correos</strong>
            <p>Conectar Gmail requerirá un permiso diferente, en una fase posterior.</p>
          </div>
        </div>
        <a routerLink="/inicio" class="auth-back">{{
          client.enabled ? '← Volver a Mi espacio' : '← Volver a la vista de muestra'
        }}</a>
      </div>
      <div class="auth-panel">
        @if (client.privateStaging) {
          <p class="auth-notice" role="note">
            Acceso privado de pruebas. Utiliza la cuenta de revisión y la contraseña configurada en
            Render. El registro público y el envío de correos están deshabilitados.
          </p>
        }
        @if (!client.enabled) {
          <p class="auth-notice" role="note">
            <strong>Vista previa</strong><br />El acceso real aún no está conectado aquí. Explora
            los formularios sin introducir datos personales.
          </p>
        }
        @if (enrolling()) {
          <fp-mfa-enrollment [client]="client" (finished)="finishEnrollment()" />
        } @else if (signedIn()) {
          <h2>Tu sesión</h2>
          <button
            type="button"
            class="auth-secondary"
            [disabled]="busy()"
            (click)="enrolling.set(true)"
          >
            Activar autenticador
          </button>
          <p>
            El acceso dura mientras mantengas esta página abierta. Al recargar tendrás que volver a
            entrar.
          </p>
          <button type="button" class="auth-primary" [disabled]="busy()" (click)="refresh()">
            Actualizar sesiones
          </button>
          <ul class="auth-sessions">
            @for (session of sessions(); track session.id) {
              <li>
                <strong>{{ session.current ? 'Esta sesión' : 'Otra sesión' }}</strong>
                <small>Última actividad: {{ session.lastSeenAt | date: 'dd/MM HH:mm' }}</small>
                <button type="button" [disabled]="busy()" (click)="revoke(session)">
                  Cerrar {{ session.current ? 'esta sesión' : 'sesión' }}
                </button>
              </li>
            }
          </ul>
          @if (!client.privateStaging) {
            <button
              type="button"
              class="auth-secondary"
              [disabled]="busy()"
              (click)="google('link')"
            >
              Vincular Google
            </button>
          }
          <button type="button" class="auth-secondary" [disabled]="busy()" (click)="logout(false)">
            Cerrar sesión
          </button>
          <button type="button" class="auth-secondary" [disabled]="busy()" (click)="logout(true)">
            Cerrar todas las sesiones
          </button>
        } @else {
          <h2>{{ titles[mode()] }}</h2>
          <p>{{ descriptions[mode()] }}</p>
          <form (ngSubmit)="submit()" #form="ngForm">
            @if (mode() === 'login' || mode() === 'register' || mode() === 'forgot-password') {
              <label for="auth-email">Correo electrónico</label>
              <input
                id="auth-email"
                name="email"
                type="email"
                autocomplete="email"
                required
                maxlength="254"
                [(ngModel)]="email"
                [disabled]="busy() || !client.enabled"
                placeholder="tu@correo.com"
              />
            } @else {
              <label for="auth-code">{{
                mode() === 'recovery'
                  ? 'Código de recuperación'
                  : mode() === 'mfa'
                    ? 'Código del autenticador'
                    : 'Código del correo'
              }}</label>
              <input
                id="auth-code"
                name="code"
                type="password"
                autocomplete="one-time-code"
                [attr.inputmode]="mode() === 'mfa' ? 'numeric' : 'text'"
                required
                [pattern]="
                  mode() === 'recovery'
                    ? '[0-9a-fA-F]{8}(-[0-9a-fA-F]{8}){3}'
                    : mode() === 'mfa'
                      ? '[0-9]{6}'
                      : '[A-Za-z0-9_-]{43}'
                "
                [(ngModel)]="code"
                [disabled]="busy() || !client.enabled"
                aria-describedby="code-help"
              />
              <small id="code-help">{{
                mode() === 'recovery'
                  ? 'Usa uno de los códigos que guardaste al activar el autenticador. Cada código sirve una sola vez.'
                  : mode() === 'mfa'
                    ? 'Introduce los seis dígitos de tu app de autenticación. Este paso caduca en cinco minutos.'
                    : 'Pega el código que recibiste. Caduca a los 15 minutos y solo puede usarse una vez.'
              }}</small>
            }
            @if (mode() === 'login' || mode() === 'verify-email' || mode() === 'reset-password') {
              <label for="auth-password">{{
                mode() === 'login' ? 'Contraseña' : 'Nueva contraseña'
              }}</label>
              <input
                id="auth-password"
                name="password"
                type="password"
                [autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
                required
                [(ngModel)]="password"
                [disabled]="busy() || !client.enabled"
                aria-describedby="password-help"
              />
              <small id="password-help">{{
                mode() === 'login'
                  ? 'Usa la contraseña de tu cuenta de Finanzas.'
                  : 'Entre 15 y 128 caracteres. Puedes usar una frase larga.'
              }}</small>
            }
            <button
              class="auth-primary"
              type="submit"
              [disabled]="busy() || !client.enabled || form.invalid"
            >
              {{ busy() ? 'Un momento…' : actions[mode()] }}
            </button>
          </form>
          @if (mode() === 'mfa' || mode() === 'recovery') {
            <button
              type="button"
              class="auth-secondary"
              [disabled]="busy()"
              (click)="switchFactor()"
            >
              {{ mode() === 'mfa' ? 'Usar un código de recuperación' : 'Usar el autenticador' }}
            </button>
          }
          @if (mode() === 'login' && !client.privateStaging) {
            <button
              type="button"
              class="auth-secondary"
              [disabled]="busy() || !client.enabled"
              (click)="google('login')"
            >
              Continuar con Google
            </button>
            <div class="auth-links">
              <button type="button" [disabled]="busy()" (click)="change('forgot-password')">
                Olvidé mi contraseña</button
              ><button type="button" [disabled]="busy()" (click)="change('register')">
                Crear una cuenta
              </button>
            </div>
          } @else {
            <div class="auth-links">
              <button type="button" [disabled]="busy()" (click)="change('login')">
                Ya tengo cuenta · Entrar
              </button>
            </div>
          }
          @if (mode() === 'register' || mode() === 'forgot-password') {
            <button
              type="button"
              class="auth-secondary"
              [disabled]="busy()"
              (click)="change(mode() === 'register' ? 'verify-email' : 'reset-password')"
            >
              Ya tengo el código
            </button>
          }
        }
        @if (!enrolling()) {
          <p class="auth-message" [class.auth-error]="failed()" role="status" aria-live="polite">
            {{ message() }}
          </p>
        }
      </div>
    </section>
  `,
})
export class AuthScreen {
  private readonly nativeLogin = inject(NATIVE_GOOGLE_LOGIN);
  private readonly lifetime = new AbortController();
  readonly client = inject(AUTH_CLIENT);
  readonly enrolling = signal(false);
  readonly signedIn = signal(this.client.signedIn);
  readonly sessions = signal<AuthSession[]>([]);
  readonly mode = signal<Mode>(this.client.mfaPending ? 'mfa' : 'login');
  readonly busy = signal(false);
  readonly failed = signal(false);
  readonly message = signal('');
  email = '';
  password = '';
  code = '';
  readonly titles = {
    recovery: 'Recupera tu segundo paso',
    mfa: 'Verifica que eres tú',
    login: 'Bienvenido de nuevo',
    register: 'Crea tu cuenta',
    'forgot-password': 'Recupera tu acceso',
    'verify-email': 'Confirma tu correo',
    'reset-password': 'Elige una nueva contraseña',
  };
  readonly descriptions = {
    recovery: 'Podrás entrar sin desactivar la protección de tu cuenta.',
    mfa: 'Completa el segundo paso para acceder a tu cuenta.',
    login: 'Entra para gestionar tu acceso.',
    register: 'Primero verificaremos que el correo te pertenece.',
    'forgot-password': 'Te enviaremos un código si existe una cuenta verificada.',
    'verify-email': 'Completa la verificación y crea tu contraseña.',
    'reset-password': 'Las sesiones anteriores se cerrarán al cambiarla.',
  };
  readonly actions = {
    recovery: 'Usar código y entrar',
    mfa: 'Verificar y entrar',
    login: 'Entrar',
    register: 'Enviar código de verificación',
    'forgot-password': 'Enviar código de recuperación',
    'verify-email': 'Verificar y crear contraseña',
    'reset-password': 'Cambiar contraseña',
  };
  constructor() {
    inject(DestroyRef).onDestroy(() => this.lifetime.abort());
    const callback = pendingCallback;
    pendingCallback = null;
    if (callback) {
      const { state, code, error } = callback;
      if (state && code && !error) {
        void this.run(async () => {
          await this.client.completeGoogle(state, code);
          await this.afterPrimary();
        });
      } else this.message.set('El acceso con Google no se completó. Puedes volver a intentarlo.');
    }
  }
  finishEnrollment() {
    this.enrolling.set(false);
    this.signedIn.set(this.client.signedIn);
    if (!this.client.signedIn) this.sessions.set([]);
    this.message.set('');
  }
  switchFactor() {
    if (!this.client.mfaPending || this.busy()) return;
    this.mode.set(this.mode() === 'mfa' ? 'recovery' : 'mfa');
    this.code = '';
    this.message.set('');
    this.failed.set(false);
  }
  change(mode: Mode) {
    this.client.cancelMfa();
    this.mode.set(mode);
    this.password = '';
    this.code = '';
    this.message.set('');
    this.failed.set(false);
  }
  private async run(action: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.failed.set(false);
    this.message.set('');
    try {
      await action();
    } catch (error) {
      this.failed.set(true);
      this.message.set(
        error instanceof Error ? error.message : 'No se pudo completar la solicitud.',
      );
    } finally {
      this.signedIn.set(this.client.signedIn);
      if (!this.client.signedIn) this.sessions.set([]);
      this.password = '';
      this.code = '';
      this.busy.set(false);
    }
  }
  submit() {
    return this.run(async () => {
      const mode = this.mode();
      if (mode === 'login') {
        await this.client.login(this.email, this.password);
        await this.afterPrimary();
      } else if (mode === 'recovery') {
        await this.client.recoverMfa(this.code);
        await this.afterPrimary();
      } else if (mode === 'mfa') {
        await this.client.completeMfa(this.code);
        await this.afterPrimary();
      } else if (mode === 'register' || mode === 'forgot-password') {
        await this.client.requestEmail(mode, this.email);
        this.mode.set(mode === 'register' ? 'verify-email' : 'reset-password');
        this.message.set(
          'Si corresponde, recibirás un código en tu correo. Revisa también la carpeta de spam.',
        );
      } else {
        const length = [...this.password].length;
        if (length < 15 || length > 128 || new TextEncoder().encode(this.password).length > 512)
          throw new Error('La contraseña debe tener entre 15 y 128 caracteres.');
        await this.client.completeEmail(mode, this.code, this.password);
        this.mode.set('login');
        this.message.set('Contraseña guardada. Ya puedes entrar.');
      }
    });
  }
  private async afterPrimary() {
    if (this.client.mfaPending) {
      this.mode.set('mfa');
      this.message.set('La sesión se abrirá al verificar tu código.');
    } else {
      this.mode.set('login');
      this.sessions.set(await this.client.sessions());
      this.message.set('Sesión iniciada.');
    }
  }
  refresh() {
    return this.run(async () => {
      this.sessions.set(await this.client.sessions());
    });
  }
  revoke(session: AuthSession) {
    return this.run(async () => {
      await this.client.revoke(session);
      if (this.client.signedIn) this.sessions.set(await this.client.sessions());
      this.message.set('Sesión cerrada.');
    });
  }
  logout(all: boolean) {
    return this.run(async () => {
      await this.client.logout(all);
      this.message.set(all ? 'Todas las sesiones se han cerrado.' : 'Sesión cerrada.');
    });
  }
  google(mode: 'login' | 'link') {
    return this.run(async () => {
      if (this.nativeLogin) {
        await this.nativeLogin(this.client, this.lifetime.signal, mode);
        await this.afterPrimary();
        return;
      }
      location.assign(await this.client.google(mode));
    });
  }
}
