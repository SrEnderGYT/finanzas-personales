import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthClient } from './auth-client';
import { googleReauthentication } from './google-popup';
import { NATIVE_GOOGLE_REAUTHENTICATION } from './native-auth';

@Component({
  selector: 'fp-mfa-enrollment',
  imports: [FormsModule],
  template: `
    @if (codes().length) {
      <h2>Guarda tus códigos de recuperación</h2>
      <p>
        Autenticador activado. Guarda estos diez códigos en un lugar seguro antes de salir. Cada uno
        sirve una sola vez y no volveremos a mostrarlos.
      </p>
      <ul class="recovery-list">
        @for (item of codes(); track item) {
          <li>
            <code>{{ item }}</code>
          </li>
        }
      </ul>
      <p>Las sesiones anteriores se cerraron. Para volver a entrar necesitarás tu autenticador.</p>
      <button class="auth-primary" type="button" (click)="close()">Ya guardé mis códigos</button>
    } @else {
      <h2>Activa tu autenticador</h2>
      <form (ngSubmit)="submit()" #form="ngForm">
        @if (!secret()) {
          <p>Vuelve a introducir tu contraseña de Finanzas para proteger este cambio.</p>
          <label for="enroll-password">Confirma tu contraseña</label>
          <input
            id="enroll-password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            [(ngModel)]="password"
            [disabled]="busy()"
          />
        } @else {
          <p>
            En tu app de autenticación, agrega una cuenta con clave manual. Elige códigos basados en
            tiempo e introduce esta clave:
          </p>
          <code class="enrollment-secret">{{ secret() }}</code>
          <p>La configuración caduca en diez minutos. No compartas esta clave.</p>
          <label for="enroll-code">Primer código del autenticador</label>
          <input
            id="enroll-code"
            name="code"
            type="password"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{6}"
            required
            [(ngModel)]="code"
            [disabled]="busy()"
          />
        }
        <button class="auth-primary" type="submit" [disabled]="busy() || form.invalid">
          {{
            busy()
              ? 'Un momento…'
              : secret()
                ? 'Activar y obtener códigos'
                : 'Continuar configuración'
          }}
        </button>
      </form>
      @if (!secret()) {
        <button class="auth-secondary" type="button" [disabled]="busy()" (click)="google()">
          Verificar con Google vinculado
        </button>
        <p>Google se abre en otra ventana. Usa la cuenta que ya vinculaste a Finanzas.</p>
      }
      <button class="auth-secondary" type="button" [disabled]="busy()" (click)="close()">
        Volver al acceso
      </button>
    }
    <p role="status" class="auth-message" [class.auth-error]="!!error()">{{ error() }}</p>
  `,
})
export class MfaEnrollment {
  readonly nativeReauthenticate = inject(NATIVE_GOOGLE_REAUTHENTICATION);
  private readonly lifetime = new AbortController();
  constructor() {
    inject(DestroyRef).onDestroy(() => this.lifetime.abort());
  }
  readonly client = input.required<AuthClient>();
  readonly finished = output<void>();
  readonly secret = signal('');
  readonly codes = signal<string[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  password = '';
  code = '';
  async google() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.password = '';
    try {
      if (this.nativeReauthenticate) {
        this.secret.set(await this.nativeReauthenticate(this.client(), this.lifetime.signal));
        return;
      }
      const remote = this.client().remoteApi;
      const result = await googleReauthentication(
        () =>
          remote
            ? this.client().startRemoteGoogle('reauthenticate')
            : this.client().google('reauthenticate'),
        this.lifetime.signal,
      );
      this.secret.set(
        remote
          ? await this.client().beginMfaRemoteGoogle(result.state, result.code)
          : await this.client().beginMfaGoogle(result.state, result.code),
      );
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo verificar tu identidad.');
    } finally {
      this.busy.set(false);
    }
  }
  async submit() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      if (!this.secret()) this.secret.set(await this.client().beginMfa(this.password));
      else {
        this.codes.set(await this.client().confirmMfa(this.code));
        this.secret.set('');
      }
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'No se pudo completar la configuración.',
      );
    } finally {
      this.password = '';
      this.code = '';
      this.busy.set(false);
    }
  }
  close() {
    this.secret.set('');
    this.codes.set([]);
    this.password = '';
    this.code = '';
    this.finished.emit();
  }
}
