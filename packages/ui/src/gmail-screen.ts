import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AUTH_CLIENT } from './auth-provider';
import { UI_PRIMITIVES } from './primitives';
import {
  GMAIL_READONLY_SCOPE,
  gmailRangeDays,
  normalizeGmailConnection,
  normalizeGmailOAuthStart,
  type GmailConnectionSnapshot,
} from '../../shared/src/gmail-connection';
import { SyncHttpError } from '../../shared/src/sync-engine';

@Component({
  selector: 'fp-gmail-screen',
  imports: [FormsModule, RouterLink, ...UI_PRIMITIVES],
  styleUrl: './gmail-screen.css',
  template: `
    <section class="gmail-page">
      <header class="gmail-heading">
        <div>
          <p class="eyebrow">AUTOMATIZACIÓN</p>
          <h1>Gmail</h1>
          <p>
            Conecta tu correo conscientemente para detectar avisos financieros. Iniciar sesión con
            Google no concede acceso a Gmail.
          </p>
        </div>
        @if (snapshot()?.state === 'connected') {
          <span class="gmail-status connected">Conectado</span>
        } @else if (snapshot()?.state === 'reauthorization_required') {
          <span class="gmail-status attention">Requiere reconexión</span>
        } @else {
          <span class="gmail-status">Sin conectar</span>
        }
      </header>

      @if (!auth.enabled) {
        <section class="gmail-card">
          <h2>Disponible en tu espacio privado</h2>
          <p>
            Este preview público no conecta correos. La autorización real solo se inicia desde un
            entorno con autenticación privada habilitada.
          </p>
          <a routerLink="/acceso">Ir a Acceso</a>
        </section>
      } @else if (!auth.signedIn) {
        <section class="gmail-card">
          <h2>Inicia sesión primero</h2>
          <p>
            Gmail se conecta a una sesión de Finanzas ya autenticada. No reutilizamos el login de
            Google como consentimiento de correo.
          </p>
          <a routerLink="/acceso">Iniciar sesión</a>
        </section>
      } @else if (unavailable()) {
        <section class="gmail-card gmail-callout">
          <h2>La interfaz está lista; falta habilitar Gmail en el servidor</h2>
          <p>
            Tu sesión funciona, pero este entorno todavía no publica el contrato de Gmail. No se
            ha leído ningún correo ni se ha concedido permiso silenciosamente.
          </p>
          <button fpButton type="button" [disabled]="busy()" (click)="load()">
            Comprobar de nuevo
          </button>
        </section>
      } @else if (snapshot()?.state === 'connected') {
        <div class="gmail-grid">
          <section class="gmail-card">
            <div class="gmail-card-heading">
              <div>
                <p class="eyebrow">CUENTA AUTORIZADA</p>
                <h2>{{ snapshot()?.email }}</h2>
              </div>
              <span class="gmail-status connected">Solo lectura</span>
            </div>
            <dl class="gmail-facts">
              <div>
                <dt>Permiso</dt>
                <dd>Gmail readonly</dd>
              </div>
              <div>
                <dt>Rango seleccionado</dt>
                <dd>Últimos {{ snapshot()?.rangeDays }} días</dd>
              </div>
              <div>
                <dt>Última sincronización</dt>
                <dd>{{ snapshot()?.lastSyncAt ?? 'Aún no realizada' }}</dd>
              </div>
              <div>
                <dt>Cobertura</dt>
                <dd>{{ coverage() }}</dd>
              </div>
            </dl>
            <div class="gmail-actions">
              <button fpButton type="button" [disabled]="busy()" (click)="syncNow()">
                Sincronizar ahora
              </button>
              @if (!disconnectArmed()) {
                <button
                  fpButton
                  class="secondary"
                  type="button"
                  [disabled]="busy()"
                  (click)="disconnectArmed.set(true)"
                >
                  Desconectar Gmail
                </button>
              }
            </div>
            @if (disconnectArmed()) {
              <div class="gmail-danger" role="alert">
                <p>
                  Desconectar revoca esta conexión dentro de Finanzas y detiene nuevas lecturas.
                  Tus movimientos ya confirmados no se eliminan automáticamente.
                </p>
                <div class="gmail-actions">
                  <button fpButton type="button" [disabled]="busy()" (click)="disconnect()">
                    Confirmar desconexión
                  </button>
                  <button
                    fpButton
                    class="secondary"
                    type="button"
                    [disabled]="busy()"
                    (click)="disconnectArmed.set(false)"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            }
          </section>

          <section class="gmail-card">
            <h2>Qué puede hacer Finanzas</h2>
            <ul class="gmail-list">
              <li>Consultar mensajes mediante el permiso de solo lectura que tú aceptes.</li>
              <li>Procesar únicamente el rango que configures dentro de la aplicación.</li>
              <li>Mostrar cobertura y última sincronización para que sepas qué se revisó.</li>
            </ul>
            <h3>Qué no hace</h3>
            <ul class="gmail-list">
              <li>No conoce ni almacena tu contraseña de Gmail.</li>
              <li>No envía, elimina ni modifica correos con este permiso.</li>
              <li>No guarda el refresh token en el navegador.</li>
            </ul>
          </section>
        </div>
      } @else {
        <div class="gmail-grid">
          <section class="gmail-card">
            <p class="eyebrow">CONSENTIMIENTO</p>
            <h2>Conectar Gmail</h2>
            <p>
              Google mostrará una pantalla de autorización separada. Puedes rechazarla y seguir
              usando todas las funciones manuales.
            </p>
            <label>
              Rango inicial
              <select fpSelect [(ngModel)]="rangeDays" [disabled]="busy()">
                <option [ngValue]="7">Últimos 7 días</option>
                <option [ngValue]="30">Últimos 30 días</option>
                <option [ngValue]="90">Últimos 90 días</option>
                <option [ngValue]="180">Últimos 180 días</option>
                <option [ngValue]="365">Último año</option>
              </select>
            </label>
            <p class="gmail-scope">
              Scope solicitado: <code>{{ readonlyScope }}</code>
            </p>
            <button fpButton type="button" [disabled]="busy()" (click)="connect()">
              Continuar con Google
            </button>
          </section>

          <section class="gmail-card gmail-callout">
            <h2>Permiso amplio, uso limitado</h2>
            <p>
              <strong>gmail.readonly</strong> técnicamente permite leer el buzón autorizado. El
              rango elegido limita lo que Finanzas debe procesar, pero no reduce el alcance que
              Google muestra en OAuth.
            </p>
            <p>
              La conexión puede revocarse cuando quieras. Si Google revoca el token, Finanzas debe
              detener las tareas y pedirte reconectar en lugar de insistir en segundo plano.
            </p>
          </section>
        </div>
      }

      @if (message()) {
        <p class="gmail-feedback" role="status" aria-live="polite">{{ message() }}</p>
      }
      @if (error()) {
        <p class="gmail-feedback error" role="alert">{{ error() }}</p>
      }
    </section>
  `,
})
export class GmailScreen implements OnInit {
  readonly auth = inject(AUTH_CLIENT);
  readonly snapshot = signal<GmailConnectionSnapshot | undefined>(undefined);
  readonly busy = signal(false);
  readonly unavailable = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  readonly disconnectArmed = signal(false);
  readonly readonlyScope = GMAIL_READONLY_SCOPE;
  rangeDays = 30;

  ngOnInit() {
    if (this.auth.enabled && this.auth.signedIn) void this.load();
  }

  coverage() {
    const value = this.snapshot();
    return value?.coverageFrom && value.coverageTo
      ? `${value.coverageFrom} — ${value.coverageTo}`
      : 'Aún no informada';
  }

  async load() {
    if (!this.auth.enabled || !this.auth.signedIn || this.busy()) return;
    await this.action(async () => {
      const value = normalizeGmailConnection(await this.auth.gmail('connection', 'GET'));
      this.snapshot.set(value);
      this.rangeDays = value.rangeDays;
      this.unavailable.set(false);
      this.disconnectArmed.set(false);
    });
  }

  async connect() {
    if (!this.auth.signedIn || this.busy()) return;
    await this.action(async () => {
      const rangeDays = gmailRangeDays(this.rangeDays);
      const start = normalizeGmailOAuthStart(
        await this.auth.gmail('oauth/start', 'POST', { rangeDays }),
      );
      this.message.set('Abriendo el consentimiento de Google…');
      window.location.assign(start.authorizationUrl);
    });
  }

  async syncNow() {
    if (!this.auth.signedIn || this.busy()) return;
    await this.action(async () => {
      await this.auth.gmail('sync', 'POST');
      this.message.set('Sincronización solicitada. Actualizando estado…');
      const value = normalizeGmailConnection(await this.auth.gmail('connection', 'GET'));
      this.snapshot.set(value);
    });
  }

  async disconnect() {
    if (!this.auth.signedIn || this.busy()) return;
    await this.action(async () => {
      await this.auth.gmail('connection', 'DELETE');
      this.snapshot.set({
        state: 'disconnected',
        scope: GMAIL_READONLY_SCOPE,
        rangeDays: this.rangeDays,
      });
      this.disconnectArmed.set(false);
      this.message.set('Gmail quedó desconectado de Finanzas.');
    });
  }

  private async action(run: () => Promise<void>) {
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await run();
    } catch (error) {
      if (error instanceof SyncHttpError && (error.status === 404 || error.status === 503)) {
        this.unavailable.set(true);
        this.error.set('');
      } else if (error instanceof SyncHttpError && error.status === 401) {
        this.error.set('Tu sesión terminó. Inicia sesión nuevamente para administrar Gmail.');
      } else {
        this.error.set('No se pudo completar la operación de Gmail. No se modificó tu conexión.');
      }
    } finally {
      this.busy.set(false);
    }
  }
}
