import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AUTH_CLIENT } from './auth-provider';
import { UI_PRIMITIVES } from './primitives';
import {
  normalizeGmailConnection,
  type GmailConnectionSnapshot,
} from '../../shared/src/gmail-connection';
import {
  normalizeGmailCandidates,
  type GmailFinancialCandidate,
  type GmailFinancialKind,
} from '../../shared/src/gmail-candidates';

export type DetectedFinanceView = 'cards' | 'subscriptions' | 'debts';
type CardKindFilter = 'all' | 'card_charge' | 'payment' | 'card_statement';

function monthKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

@Component({
  selector: 'fp-detected-finances-screen',
  imports: [RouterLink, ...UI_PRIMITIVES],
  styleUrl: './detected-finances-screen.css',
  template: `
    <section class="detected-page">
      <header class="detected-heading">
        <div>
          <p class="eyebrow">{{ eyebrow() }}</p>
          <h1>{{ title() }}</h1>
          <p>{{ description() }}</p>
        </div>
        <a fpButton routerLink="/gmail">Administrar Gmail</a>
      </header>

      @if (busy()) {
        <div class="detected-state" role="status">Cargando información…</div>
      } @else if (error()) {
        <div class="detected-state error" role="alert">
          <strong>No pudimos cargar esta información.</strong>
          <p>{{ error() }}</p>
          <button fpButton type="button" (click)="load()">Reintentar</button>
        </div>
      } @else if (connection()?.state !== 'connected') {
        <div class="detected-state">
          <strong>Conecta Gmail para encontrar {{ emptySubject() }}.</strong>
          <p>
            Finanzas no mostrará tarjetas, suscripciones o deudas inventadas. Esta pantalla se llena
            únicamente con información financiera detectada en el correo que autorices.
          </p>
          <a fpButton routerLink="/gmail">Conectar Gmail</a>
        </div>
      } @else {
        <section class="detected-filters" aria-label="Filtros de información financiera">
          <label>
            <span>Periodo</span>
            <input type="month" [value]="month()" (change)="setMonth($any($event.target).value)" />
          </label>

          @if (view() === 'cards' || view() === 'debts') {
            <label>
              <span>Tarjeta / entidad</span>
              <select
                [value]="institutionFilter()"
                (change)="setInstitution($any($event.target).value)"
              >
                <option value="all">Todas</option>
                @for (institution of institutionOptions(); track institution) {
                  <option [value]="institution">{{ institution }}</option>
                }
              </select>
            </label>
          }

          @if (view() === 'cards') {
            <label>
              <span>Tipo</span>
              <select [value]="cardKindFilter()" (change)="setCardKind($any($event.target).value)">
                <option value="all">Todos</option>
                <option value="card_charge">Consumos</option>
                <option value="payment">Pagos</option>
                <option value="card_statement">Deuda / estado</option>
              </select>
            </label>
          }

          <p>Solo se muestran correos financieros con importe detectado.</p>
        </section>

        <div class="detected-summary">
          <article>
            <span>Detectados</span>
            <strong>{{ visible().length }}</strong>
          </article>
          <article>
            <span>Pendientes</span>
            <strong>{{ pendingCount() }}</strong>
          </article>
          <article>
            <span>Total PEN detectado</span>
            <strong>{{ total('PEN') }}</strong>
          </article>
          <article>
            <span>Total USD detectado</span>
            <strong>{{ total('USD') }}</strong>
          </article>
        </div>

        @if (view() === 'cards' && institutions().length > 0) {
          <section class="institution-section">
            <div class="section-heading">
              <div>
                <p class="eyebrow">ENTIDADES DETECTADAS</p>
                <h2>Mis tarjetas y bancos</h2>
              </div>
              <span>{{ periodLabel() }}</span>
            </div>
            <div class="institution-grid">
              @for (institution of institutions(); track institution.name) {
                <article class="institution-card">
                  <span class="institution-mark">{{
                    institution.name.slice(0, 2).toUpperCase()
                  }}</span>
                  <div>
                    <strong>{{ institution.name }}</strong>
                    <p>
                      {{ institution.events }} evento{{
                        institution.events === 1 ? '' : 's'
                      }}
                      detectado{{ institution.events === 1 ? '' : 's' }}
                    </p>
                  </div>
                  <span
                    >{{ institution.pending }} pendiente{{
                      institution.pending === 1 ? '' : 's'
                    }}</span
                  >
                </article>
              }
            </div>
          </section>
        }

        <section class="detected-list-section">
          <div class="section-heading">
            <div>
              <p class="eyebrow">INFORMACIÓN ENCONTRADA</p>
              <h2>{{ listTitle() }}</h2>
            </div>
            <span>{{ periodLabel() }}</span>
          </div>

          @if (visible().length === 0) {
            <div class="detected-state compact">
              <strong>No encontramos {{ emptySubject() }} con importe en este periodo.</strong>
              <p>
                Periodo seleccionado: {{ periodLabel() }}. La cobertura actual de Gmail es
                {{ coverage() }}.
              </p>
            </div>
          } @else {
            <div class="detected-list">
              @for (item of visible(); track item.id) {
                <article class="detected-item">
                  <div class="detected-main">
                    <div class="detected-tags">
                      <span>{{ kindLabel(item.kind) }}</span>
                      @if (item.institution) {
                        <span>{{ item.institution }}</span>
                      }
                      @if (item.merchant) {
                        <span>{{ item.merchant }}</span>
                      }
                      <span [class.pending]="item.status === 'pending'">{{
                        statusLabel(item.status)
                      }}</span>
                    </div>
                    <h3>{{ item.summary }}</h3>
                    <p>
                      {{ dateLabel(item.occurredAt) }}
                      @if (item.dueAt) {
                        · Vence {{ item.dueAt }}
                      }
                    </p>
                  </div>
                  <div class="detected-amount">
                    <strong>{{ amountLabel(item) }}</strong>
                    <span>{{ item.confidence }}% confianza</span>
                  </div>
                </article>
              }
            </div>
          }
        </section>
      }
    </section>
  `,
})
export class DetectedFinancesScreen implements OnInit {
  readonly auth = inject(AUTH_CLIENT);
  readonly view = input<DetectedFinanceView>('cards');
  readonly connection = signal<GmailConnectionSnapshot | undefined>(undefined);
  readonly candidates = signal<GmailFinancialCandidate[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly month = signal(monthKey(new Date()));
  readonly institutionFilter = signal('all');
  readonly cardKindFilter = signal<CardKindFilter>('all');

  readonly periodRows = computed(() => {
    const allowed = new Set<GmailFinancialKind>(
      this.view() === 'cards'
        ? ['card_charge', 'card_statement', 'payment']
        : this.view() === 'subscriptions'
          ? ['subscription']
          : ['debt', 'card_statement'],
    );
    return this.candidates().filter((candidate) => {
      if (!allowed.has(candidate.kind) || !candidate.amountMinor || !candidate.currency)
        return false;
      if (monthKey(new Date(candidate.occurredAt)) !== this.month()) return false;
      if (this.view() === 'debts' && !candidate.institution) return false;
      return true;
    });
  });

  readonly institutionOptions = computed(() =>
    [
      ...new Set(this.periodRows().flatMap((item) => (item.institution ? [item.institution] : []))),
    ].sort((a, b) => a.localeCompare(b)),
  );

  readonly visible = computed(() =>
    this.periodRows().filter((candidate) => {
      if (
        (this.view() === 'cards' || this.view() === 'debts') &&
        this.institutionFilter() !== 'all' &&
        candidate.institution !== this.institutionFilter()
      )
        return false;
      if (
        this.view() === 'cards' &&
        this.cardKindFilter() !== 'all' &&
        candidate.kind !== this.cardKindFilter()
      )
        return false;
      return true;
    }),
  );

  readonly pendingCount = computed(
    () => this.visible().filter((item) => item.status === 'pending').length,
  );

  readonly institutions = computed(() => {
    const grouped = new Map<string, { events: number; pending: number }>();
    for (const item of this.visible()) {
      if (!item.institution) continue;
      const current = grouped.get(item.institution) ?? { events: 0, pending: 0 };
      current.events++;
      if (item.status === 'pending') current.pending++;
      grouped.set(item.institution, current);
    }
    return [...grouped.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));
  });

  ngOnInit() {
    void this.load();
  }

  setMonth(value: string) {
    if (/^\d{4}-\d{2}$/.test(value)) this.month.set(value);
  }

  setInstitution(value: string) {
    this.institutionFilter.set(value || 'all');
  }

  setCardKind(value: string) {
    if (['all', 'card_charge', 'payment', 'card_statement'].includes(value))
      this.cardKindFilter.set(value as CardKindFilter);
  }

  title() {
    return this.view() === 'cards'
      ? 'Tarjetas'
      : this.view() === 'subscriptions'
        ? 'Suscripciones'
        : 'Deudas de tarjeta';
  }

  eyebrow() {
    return this.view() === 'cards'
      ? 'TARJETAS Y ESTADOS DE CUENTA'
      : this.view() === 'subscriptions'
        ? 'PAGOS RECURRENTES'
        : 'ESTADOS DE CUENTA Y PAGOS';
  }

  description() {
    return this.view() === 'cards'
      ? 'Consumos, pagos y deuda de tarjeta encontrados en tu Gmail autorizado.'
      : this.view() === 'subscriptions'
        ? 'Cobros recurrentes reales detectados por importe y proveedor, no promociones ni bajas.'
        : 'Deuda de tarjeta detectada desde estados de cuenta, pagos totales, mínimos y cuotas con importe.';
  }

  listTitle() {
    return this.view() === 'cards'
      ? 'Actividad de tarjetas'
      : this.view() === 'subscriptions'
        ? 'Cobros recurrentes encontrados'
        : 'Deudas de tarjeta encontradas';
  }

  emptySubject() {
    return this.view() === 'cards'
      ? 'actividad de tarjetas'
      : this.view() === 'subscriptions'
        ? 'cobros recurrentes'
        : 'deuda de tarjeta';
  }

  coverage() {
    const value = this.connection();
    return value?.coverageFrom && value.coverageTo
      ? `${value.coverageFrom} — ${value.coverageTo}`
      : 'aún no disponible';
  }

  periodLabel() {
    const [year, month] = this.month().split('-').map(Number);
    if (!year || !month) return this.month();
    return new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(
      new Date(Date.UTC(year, month - 1, 15)),
    );
  }

  total(currency: 'PEN' | 'USD') {
    let minor = 0n;
    for (const item of this.visible()) {
      if (item.currency === currency && item.amountMinor) minor += BigInt(item.amountMinor);
    }
    const whole = minor / 100n;
    const cents = (minor % 100n).toString().padStart(2, '0');
    return `${currency === 'PEN' ? 'S/' : 'US$'} ${whole.toLocaleString('en-US')}.${cents}`;
  }

  kindLabel(kind: GmailFinancialKind) {
    const labels: Record<GmailFinancialKind, string> = {
      expense: 'Gasto',
      income: 'Ingreso',
      transfer: 'Transferencia',
      card_charge: 'Consumo',
      card_statement: 'Deuda de tarjeta',
      subscription: 'Suscripción',
      debt: 'Cuota / deuda',
      payment: 'Pago de tarjeta',
      unknown: 'Por revisar',
    };
    return labels[kind];
  }

  statusLabel(status: GmailFinancialCandidate['status']) {
    return status === 'pending'
      ? 'Pendiente'
      : status === 'confirmed'
        ? 'Confirmado'
        : 'Descartado';
  }

  dateLabel(value: string) {
    return new Intl.DateTimeFormat('es-PE', {
      dateStyle: 'medium',
      timeZone: 'America/Lima',
    }).format(new Date(value));
  }

  amountLabel(item: GmailFinancialCandidate) {
    if (!item.amountMinor || !item.currency) return '—';
    const minor = BigInt(item.amountMinor);
    const whole = minor / 100n;
    const cents = (minor % 100n).toString().padStart(2, '0');
    return `${item.currency === 'PEN' ? 'S/' : 'US$'} ${whole.toLocaleString('en-US')}.${cents}`;
  }

  async load() {
    if (!this.auth.signedIn || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const connection = normalizeGmailConnection(await this.auth.gmail('connection', 'GET'));
      this.connection.set(connection);
      if (connection.state !== 'connected') {
        this.candidates.set([]);
        return;
      }
      this.candidates.set(
        normalizeGmailCandidates(await this.auth.gmail('candidates?status=all', 'GET')),
      );
    } catch {
      this.error.set('Comprueba tu sesión y el estado de Gmail e inténtalo nuevamente.');
    } finally {
      this.busy.set(false);
    }
  }
}
