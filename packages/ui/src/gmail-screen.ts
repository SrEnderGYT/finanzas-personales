import { Component, OnInit, computed, inject, signal } from '@angular/core';
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
import {
  normalizeGmailCandidates,
  type GmailCandidateStatus,
  type GmailFinancialCandidate,
  type GmailFinancialKind,
} from '../../shared/src/gmail-candidates';
import { SyncHttpError } from '../../shared/src/sync-engine';

type CandidateView = GmailCandidateStatus | 'all';

@Component({
  selector: 'fp-gmail-screen',
  imports: [FormsModule, RouterLink, ...UI_PRIMITIVES],
  styleUrl: './gmail-screen.css',
  template: `
    <section class="gmail-page">
      <header class="gmail-heading">
        <div>
          <p class="eyebrow">AUTOMATIZACIÓN FINANCIERA</p>
          <h1>Gmail</h1>
          <p>
            Autoriza lectura para detectar movimientos, cargos de tarjeta, estados de cuenta,
            suscripciones, pagos y deudas. Nada se convierte en un movimiento confirmado sin tu
            revisión.
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

      @if (!auth.signedIn) {
        <section class="gmail-card">
          <h2>Inicia sesión primero</h2>
          <p>El acceso a Gmail está vinculado a tu cuenta de Finanzas.</p>
          <a routerLink="/acceso">Volver a acceso</a>
        </section>
      } @else if (unavailable()) {
        <section class="gmail-card gmail-callout">
          <h2>Gmail aún no está habilitado en el servidor</h2>
          <p>
            Tu sesión está protegida, pero faltan las credenciales OAuth de Gmail en el API. No se
            ha leído ningún correo.
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
              <div><dt>Permiso</dt><dd>Gmail readonly</dd></div>
              <div><dt>Rango</dt><dd>Últimos {{ snapshot()?.rangeDays }} días</dd></div>
              <div><dt>Última sincronización</dt><dd>{{ lastSyncLabel() }}</dd></div>
              <div><dt>Cobertura</dt><dd>{{ coverage() }}</dd></div>
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
                  Se detendrán nuevas lecturas y el token de conexión dejará de usarse. Los datos
                  que ya hayas confirmado no se eliminan automáticamente.
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
            <p class="eyebrow">PRIVACIDAD</p>
            <h2>Qué procesa Finanzas</h2>
            <ul class="gmail-list">
              <li>Remitente, asunto, fecha y un fragmento corto para detectar eventos financieros.</li>
              <li>El rango que tú selecciones, con un máximo configurado por el servidor.</li>
              <li>El refresh token cifrado en el servidor; nunca se guarda en el navegador.</li>
            </ul>
            <h3>Qué no hace</h3>
            <ul class="gmail-list">
              <li>No conoce tu contraseña de Gmail.</li>
              <li>No envía, elimina ni modifica correos.</li>
              <li>No confirma automáticamente gastos o deudas detectadas.</li>
            </ul>
          </section>
        </div>

        <section class="gmail-inbox" aria-labelledby="gmail-inbox-title">
          <div class="gmail-inbox-heading">
            <div>
              <p class="eyebrow">DETECTADO EN TU CORREO</p>
              <h2 id="gmail-inbox-title">Bandeja financiera</h2>
              <p>Revisa cada hallazgo antes de incorporarlo a tus finanzas.</p>
            </div>
            <label>
              Estado
              <select fpSelect [(ngModel)]="candidateView" (ngModelChange)="loadCandidates()">
                <option value="pending">Pendientes</option>
                <option value="confirmed">Confirmados</option>
                <option value="discarded">Descartados</option>
                <option value="all">Todos</option>
              </select>
            </label>
          </div>

          <div class="gmail-detection-summary">
            <strong>{{ candidates().length }}</strong>
            <span>{{ candidateViewLabel() }}</span>
            @if (candidateTotals().pen) {
              <span>PEN {{ candidateTotals().pen }}</span>
            }
            @if (candidateTotals().usd) {
              <span>USD {{ candidateTotals().usd }}</span>
            }
          </div>

          @if (candidateBusy()) {
            <p class="gmail-empty" role="status">Cargando detecciones…</p>
          } @else if (candidates().length === 0) {
            <div class="gmail-empty">
              <strong>No hay elementos en esta vista.</strong>
              <p>
                Sincroniza Gmail para buscar avisos financieros dentro del rango autorizado. Un
                correo que no pueda clasificarse con suficiente evidencia no se mostrará como gasto.
              </p>
            </div>
          } @else {
            <div class="gmail-candidates">
              @for (candidate of candidates(); track candidate.id) {
                <article class="gmail-candidate">
                  <div class="candidate-main">
                    <div class="candidate-heading">
                      <span class="candidate-kind">{{ kindLabel(candidate.kind) }}</span>
                      <span class="candidate-confidence">{{ candidate.confidence }}% confianza</span>
                    </div>
                    <h3>{{ candidate.summary }}</h3>
                    <div class="candidate-meta">
                      @if (candidate.institution) { <span>{{ candidate.institution }}</span> }
                      @if (candidate.merchant) { <span>{{ candidate.merchant }}</span> }
                      <span>{{ dateLabel(candidate.occurredAt) }}</span>
                      @if (candidate.dueAt) { <span>Vence {{ candidate.dueAt }}</span> }
                    </div>
                  </div>
                  <div class="candidate-side">
                    <strong class="candidate-amount">{{ amountLabel(candidate) }}</strong>
                    <span class="candidate-status">{{ statusLabel(candidate.status) }}</span>
                    @if (candidate.status === 'pending') {
                      <div class="candidate-actions">
                        <button
                          fpButton
                          type="button"
                          [disabled]="candidateBusy()"
                          (click)="review(candidate, 'confirmed')"
                        >
                          Confirmar
                        </button>
                        <button
                          fpButton
                          class="secondary"
                          type="button"
                          [disabled]="candidateBusy()"
                          (click)="review(candidate, 'discarded')"
                        >
                          Descartar
                        </button>
                      </div>
                    }
                  </div>
                </article>
              }
            </div>
          }
        </section>
      } @else {
        <div class="gmail-grid">
          <section class="gmail-card">
            <p class="eyebrow">CONSENTIMIENTO</p>
            <h2>Conectar Gmail</h2>
            <p>
              Google abrirá una autorización separada para lectura. Puedes revocarla cuando quieras
              sin perder el acceso a Finanzas.
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
            <p class="gmail-scope">Permiso solicitado: <code>{{ readonlyScope }}</code></p>
            <button fpButton type="button" [disabled]="busy()" (click)="connect()">
              Conectar mi Gmail
            </button>
          </section>

          <section class="gmail-card gmail-callout">
            <h2>Primero detectar, después confirmar</h2>
            <p>
              La aplicación busca señales financieras y las coloca en una bandeja de revisión. Una
              coincidencia no altera tus saldos ni crea una deuda por sí sola.
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
  readonly candidates = signal<GmailFinancialCandidate[]>([]);
  readonly busy = signal(false);
  readonly candidateBusy = signal(false);
  readonly unavailable = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  readonly disconnectArmed = signal(false);
  readonly readonlyScope = GMAIL_READONLY_SCOPE;
  readonly candidateTotals = computed(() => {
    let pen = 0n;
    let usd = 0n;
    for (const candidate of this.candidates()) {
      if (!candidate.amountMinor || !candidate.currency) continue;
      const value = BigInt(candidate.amountMinor);
      if (candidate.currency === 'PEN') pen += value;
      else usd += value;
    }
    return {
      pen: pen === 0n ? '' : this.money(pen),
      usd: usd === 0n ? '' : this.money(usd),
    };
  });
  rangeDays = 30;
  candidateView: CandidateView = 'pending';

  ngOnInit() {
    if (this.auth.enabled && this.auth.signedIn) void this.load();
  }

  coverage() {
    const value = this.snapshot();
    return value?.coverageFrom && value.coverageTo
      ? `${value.coverageFrom} — ${value.coverageTo}`
      : 'Aún no informada';
  }

  lastSyncLabel() {
    const value = this.snapshot()?.lastSyncAt;
    return value ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Aún no realizada';
  }

  candidateViewLabel() {
    return this.candidateView === 'pending'
      ? 'pendientes de revisión'
      : this.candidateView === 'confirmed'
        ? 'confirmados'
        : this.candidateView === 'discarded'
          ? 'descartados'
          : 'hallazgos';
  }

  kindLabel(kind: GmailFinancialKind) {
    const labels: Record<GmailFinancialKind, string> = {
      expense: 'Gasto',
      income: 'Ingreso',
      transfer: 'Transferencia',
      card_charge: 'Cargo de tarjeta',
      card_statement: 'Estado de cuenta',
      subscription: 'Suscripción',
      debt: 'Deuda / cuota',
      payment: 'Pago',
      unknown: 'Por revisar',
    };
    return labels[kind];
  }

  statusLabel(status: GmailCandidateStatus) {
    return status === 'pending' ? 'Pendiente' : status === 'confirmed' ? 'Confirmado' : 'Descartado';
  }

  dateLabel(value: string) {
    return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  amountLabel(candidate: GmailFinancialCandidate) {
    if (!candidate.amountMinor || !candidate.currency) return 'Importe por revisar';
    return `${candidate.currency === 'PEN' ? 'S/' : 'US$'} ${this.money(BigInt(candidate.amountMinor))}`;
  }

  private money(value: bigint) {
    const whole = value / 100n;
    const cents = (value % 100n).toString().padStart(2, '0');
    return `${whole.toLocaleString('en-US')}.${cents}`;
  }

  async load() {
    if (!this.auth.enabled || !this.auth.signedIn || this.busy()) return;
    await this.action(async () => {
      const value = normalizeGmailConnection(await this.auth.gmail('connection', 'GET'));
      this.snapshot.set(value);
      this.rangeDays = value.rangeDays;
      this.unavailable.set(false);
      this.disconnectArmed.set(false);
      if (value.state === 'connected') await this.loadCandidates();
      else this.candidates.set([]);
    });
  }

  async loadCandidates() {
    if (!this.auth.signedIn || this.candidateBusy()) return;
    this.candidateBusy.set(true);
    try {
      const value = await this.auth.gmail(`candidates?status=${this.candidateView}`, 'GET');
      this.candidates.set(normalizeGmailCandidates(value));
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 401) {
        this.error.set('Tu sesión terminó. Vuelve a iniciar sesión.');
      } else {
        this.error.set('No se pudo cargar la bandeja financiera de Gmail.');
      }
    } finally {
      this.candidateBusy.set(false);
    }
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
      const value = normalizeGmailConnection(await this.auth.gmail('connection', 'GET'));
      this.snapshot.set(value);
      await this.loadCandidates();
      this.message.set('Gmail se sincronizó y la bandeja financiera fue actualizada.');
    });
  }

  async review(candidate: GmailFinancialCandidate, status: 'confirmed' | 'discarded') {
    if (this.candidateBusy()) return;
    this.candidateBusy.set(true);
    this.error.set('');
    try {
      await this.auth.gmail(
        `candidates/${candidate.id}/${status === 'confirmed' ? 'confirm' : 'discard'}`,
        'POST',
      );
      this.message.set(status === 'confirmed' ? 'Hallazgo confirmado.' : 'Hallazgo descartado.');
      const value = await this.auth.gmail(`candidates?status=${this.candidateView}`, 'GET');
      this.candidates.set(normalizeGmailCandidates(value));
    } catch {
      this.error.set('No se pudo actualizar este hallazgo. Vuelve a intentarlo.');
    } finally {
      this.candidateBusy.set(false);
    }
  }

  async disconnect() {
    if (!this.auth.signedIn || this.busy()) return;
    await this.action(async () => {
      await this.auth.gmail('connection', 'DELETE');
      this.snapshot.set({ state: 'disconnected', scope: GMAIL_READONLY_SCOPE, rangeDays: this.rangeDays });
      this.candidates.set([]);
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
