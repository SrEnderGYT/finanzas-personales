import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CATEGORIES,
  DEMO_TODAY,
  formatMinor,
  parseDemoAmount,
  RANGE_OPTIONS,
  type DemoTransaction,
  type RangeLabel,
} from '../../shared/src/demo';
import { DemoState } from './demo-state';
import { UI_PRIMITIVES } from './primitives';
import { StorageLab } from './storage-lab';

@Component({
  selector: 'fp-public-product-screen',
  imports: [FormsModule, RouterLink, StorageLab, ...UI_PRIMITIVES],
  styleUrl: './public-product-screen.css',
  template: `
    <section class="public-finance-page">
      <header class="product-heading">
        <div>
          <div class="heading-kicker">
            <span class="live-dot" aria-hidden="true"></span>
            <span>MIS FINANZAS</span>
            <span class="example-chip">Datos de ejemplo</span>
          </div>
          <h1>{{ title() }}</h1>
          <p>{{ subtitle() }}</p>
        </div>
        <div class="heading-actions">
          <a class="quiet-action" routerLink="/acceso">Iniciar sesión</a>
          <button fpButton type="button" (click)="showNew.set(true)">
            <span aria-hidden="true">+</span> Nuevo movimiento
          </button>
        </div>
      </header>

      @if (view() !== 'configuracion' && view() !== 'nuevo') {
        <div class="finance-toolbar">
          <div class="currency-switch" role="group" aria-label="Moneda">
            <button
              type="button"
              [class.selected]="state.currency() === 'PEN'"
              aria-label="PEN Soles"
              (click)="state.currency.set('PEN')"
            >
              PEN <span>Soles</span>
            </button>
            <button
              type="button"
              [class.selected]="state.currency() === 'USD'"
              aria-label="USD Dólares"
              (click)="state.currency.set('USD')"
            >
              USD <span>Dólares</span>
            </button>
          </div>
          <label class="period-control">
            <span>Periodo</span>
            <select
              fpSelect
              aria-label="Rango financiero"
              [ngModel]="state.range()"
              (ngModelChange)="setRange($event)"
            >
              @for (option of ranges; track option) {
                <option>{{ option }}</option>
              }
            </select>
          </label>
        </div>

        @if (state.range() === 'Personalizado') {
          <div class="custom-period">
            <label>
              Desde
              <input
                fpDatePicker
                [ngModel]="state.start()"
                (ngModelChange)="state.start.set($event)"
              />
            </label>
            <label>
              Hasta
              <input
                fpDatePicker
                [ngModel]="state.end()"
                (ngModelChange)="state.end.set($event)"
              />
            </label>
          </div>
        }
        @if (state.rangeError()) {
          <fp-alert>{{ state.rangeError() }}</fp-alert>
        }
      }

      @if (view() === 'inicio') {
        <section class="finance-hero" aria-label="Resumen financiero">
          <div class="hero-balance">
            <div class="hero-label-row">
              <span>Patrimonio visible</span>
              <button
                class="privacy-toggle"
                type="button"
                (click)="state.hidden.set(!state.hidden())"
                [attr.aria-label]="state.hidden() ? 'Mostrar importes' : 'Ocultar importes'"
              >
                {{ state.hidden() ? 'Mostrar' : 'Ocultar' }}
              </button>
            </div>
            <strong data-testid="public-balance">{{ money(accountBalance()) }}</strong>
            <p>{{ state.currency() }} · cuentas y efectivo</p>
            <div class="hero-foot">
              <span>Actualizado con la actividad mostrada</span>
              <a routerLink="/cuentas">Ver cuentas →</a>
            </div>
          </div>
          <div class="hero-metrics">
            <article>
              <span>Ingresos</span>
              <strong data-testid="public-income">{{ money(state.totals().income) }}</strong>
              <small>En el periodo seleccionado</small>
            </article>
            <article>
              <span>Gastos</span>
              <strong data-testid="public-expense">{{ money(state.totals().expense) }}</strong>
              <small>Compras y consumos</small>
            </article>
            <article>
              <span>Balance</span>
              <strong>{{ money(state.totals().balance) }}</strong>
              <small>Ingresos menos gastos</small>
            </article>
            <article>
              <span>Presupuesto usado</span>
              <strong>{{ budgetPercent() }}%</strong>
              <small>{{ money(budgetRemaining()) }} disponibles</small>
            </article>
          </div>
        </section>

        <section class="quick-actions" aria-label="Acciones rápidas">
          <button type="button" (click)="showNew.set(true)"><span>＋</span>Registrar gasto</button>
          <a routerLink="/movimientos"><span>⇅</span>Ver movimientos</a>
          <a routerLink="/gmail"><span>✉</span>Conectar Gmail</a>
          <a routerLink="/presupuestos"><span>◎</span>Presupuestos</a>
        </section>

        <div class="dashboard-layout">
          <section class="product-panel activity-panel">
            <header class="panel-heading">
              <div>
                <span class="panel-eyebrow">ACTIVIDAD</span>
                <h2>Movimientos recientes</h2>
              </div>
              <a routerLink="/movimientos">Ver todos</a>
            </header>
            @for (row of recentRows(); track row.id) {
              <article class="movement-row">
                <span class="movement-icon" aria-hidden="true">{{ row.icon }}</span>
                <div class="movement-main">
                  <strong>{{ clean(row.merchant) }}</strong>
                  <span>{{ row.category }} · {{ row.date }}</span>
                </div>
                <strong [class.positive]="row.kind === 'income'">
                  {{ row.kind === 'income' ? '+' : row.kind === 'expense' ? '−' : '' }}{{
                    money(row.minor)
                  }}
                </strong>
              </article>
            } @empty {
              <div class="empty-panel">No hay movimientos para este periodo.</div>
            }
          </section>

          <aside class="side-stack">
            <section class="product-panel budget-panel">
              <header class="panel-heading">
                <div>
                  <span class="panel-eyebrow">SEPTIEMBRE</span>
                  <h2>Presupuesto mensual</h2>
                </div>
                <strong>{{ budgetPercent() }}%</strong>
              </header>
              <div class="budget-numbers">
                <strong>{{ money(monthExpense()) }}</strong>
                <span>de {{ money(budgetLimit()) }}</span>
              </div>
              <div
                class="progress-track"
                role="progressbar"
                aria-label="Presupuesto utilizado"
                [attr.aria-valuenow]="budgetPercent()"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span [style.width.%]="budgetPercent()"></span>
              </div>
              <p>{{ money(budgetRemaining()) }} disponibles este mes.</p>
              <a routerLink="/presupuestos">Gestionar presupuesto →</a>
            </section>

            <section class="product-panel upcoming-panel">
              <header class="panel-heading">
                <div>
                  <span class="panel-eyebrow">AGENDA</span>
                  <h2>Próximos pagos</h2>
                </div>
              </header>
              <div class="due-item">
                <span class="date-tile">18<small>SEP</small></span>
                <div><strong>Tarjeta principal</strong><span>Pago del periodo</span></div>
                <strong>{{ money(state.currency() === 'PEN' ? '35000' : '4000') }}</strong>
              </div>
              <div class="due-item">
                <span class="date-tile">22<small>SEP</small></span>
                <div><strong>Internet hogar</strong><span>Servicio mensual</span></div>
                <strong>{{ state.currency() === 'PEN' ? money('12900') : '—' }}</strong>
              </div>
            </section>
          </aside>
        </div>

        <section class="product-panel accounts-overview">
          <header class="panel-heading">
            <div>
              <span class="panel-eyebrow">CUENTAS</span>
              <h2>Tu dinero, separado por origen</h2>
            </div>
            <a routerLink="/cuentas">Administrar</a>
          </header>
          <div class="account-snapshot-grid">
            @for (account of visibleAccounts(); track account.name) {
              <article>
                <span class="account-symbol" aria-hidden="true">{{ account.icon }}</span>
                <div><strong>{{ account.name }}</strong><span>{{ account.detail }}</span></div>
                <strong>{{ money(account.minor) }}</strong>
              </article>
            }
          </div>
        </section>
      }

      @if (view() === 'movimientos') {
        <section class="product-panel movement-browser">
          <header class="panel-heading movement-heading">
            <div>
              <span class="panel-eyebrow">HISTORIAL</span>
              <h2>Todos los movimientos</h2>
            </div>
            <span>{{ state.filtered().length }} resultados</span>
          </header>
          <label class="movement-search">
            <span class="visually-hidden">Buscar movimientos</span>
            <input
              fpSearchInput
              type="search"
              placeholder="Buscar comercio, categoría, cuenta o importe…"
              [ngModel]="state.query()"
              (ngModelChange)="state.query.set($event)"
            />
          </label>
          <div class="movement-table" role="table" aria-label="Movimientos">
            @for (row of state.filtered(); track row.id) {
              <article class="movement-row" role="row">
                <span class="movement-icon" aria-hidden="true">{{ row.icon }}</span>
                <div class="movement-main">
                  <strong>{{ clean(row.merchant) }}</strong>
                  <span>{{ row.category }} · {{ clean(row.account) }} · {{ row.date }}</span>
                </div>
                <span class="movement-account">{{ clean(row.bank) }}</span>
                <strong [class.positive]="row.kind === 'income'">
                  {{ row.kind === 'income' ? '+' : row.kind === 'expense' ? '−' : '' }}{{
                    money(row.minor)
                  }}
                </strong>
              </article>
            } @empty {
              <div class="empty-panel">
                <h3>No encontramos movimientos</h3>
                <p>Cambia el periodo o limpia la búsqueda.</p>
                <button fpButton class="secondary" type="button" (click)="state.query.set('')">
                  Limpiar búsqueda
                </button>
              </div>
            }
          </div>
        </section>
      }

      @if (view() === 'cuentas') {
        <div class="section-intro">
          <div><span>CUENTAS Y EFECTIVO</span><h2>Organiza dónde está tu dinero</h2></div>
          <button fpButton type="button">+ Nueva cuenta</button>
        </div>
        <div class="account-card-grid">
          @for (account of allAccounts(); track account.name) {
            <article class="account-card">
              <div class="account-card-top">
                <span class="account-symbol large" aria-hidden="true">{{ account.icon }}</span>
                <span class="currency-pill">{{ account.currency }}</span>
              </div>
              <h2>{{ account.name }}</h2>
              <p>{{ account.detail }}</p>
              <strong>{{ state.hidden() ? '••••' : formatMinor(account.minor, account.currency) }}</strong>
              <div class="account-card-foot"><span>Activa</span><button type="button">•••</button></div>
            </article>
          }
        </div>
        <section class="product-panel category-panel">
          <header class="panel-heading">
            <div><span class="panel-eyebrow">CATEGORÍAS</span><h2>Clasificación personal</h2></div>
            <span>{{ categories.length }} disponibles</span>
          </header>
          <div class="category-cloud">
            @for (category of categories; track category) {
              <span>{{ category }}</span>
            }
          </div>
        </section>
      }

      @if (view() === 'tarjetas') {
        <div class="cards-page-grid">
          <section class="credit-card-visual" aria-label="Tarjeta principal">
            <div class="credit-card-top"><span>finanzas.</span><span>VISA</span></div>
            <div class="credit-card-number">•••• •••• •••• 4821</div>
            <div class="credit-card-bottom"><span>ENDER</span><span>08/29</span></div>
          </section>
          <section class="product-panel card-summary">
            <span class="panel-eyebrow">TARJETA PRINCIPAL · PEN</span>
            <h2>Control del periodo</h2>
            <div class="card-metric-grid">
              <div><span>Línea</span><strong>S/ 5,000.00</strong></div>
              <div><span>Utilizado</span><strong>S/ 1,400.00</strong></div>
              <div><span>Disponible</span><strong>S/ 3,600.00</strong></div>
              <div><span>Pago del periodo</span><strong>S/ 350.00</strong></div>
            </div>
            <div class="progress-track"><span style="width: 28%"></span></div>
            <p>28% de utilización · cierre 28 de septiembre · pago 18 de septiembre</p>
          </section>
        </div>
        <section class="product-panel">
          <header class="panel-heading"><div><span class="panel-eyebrow">CONSUMOS</span><h2>Actividad de tarjeta</h2></div><a routerLink="/movimientos">Ver historial</a></header>
          @for (row of cardRows(); track row.id) {
            <article class="movement-row">
              <span class="movement-icon" aria-hidden="true">{{ row.icon }}</span>
              <div class="movement-main"><strong>{{ clean(row.merchant) }}</strong><span>{{ row.category }} · {{ row.date }}</span></div>
              <strong>−{{ formatMinor(row.minor, row.currency) }}</strong>
            </article>
          }
        </section>
      }

      @if (view() === 'presupuestos') {
        <section class="budget-summary-strip">
          <div><span>Presupuesto mensual</span><strong>{{ money(budgetLimit()) }}</strong></div>
          <div><span>Consumido</span><strong>{{ money(monthExpense()) }}</strong></div>
          <div><span>Disponible</span><strong>{{ money(budgetRemaining()) }}</strong></div>
          <div><span>Avance</span><strong>{{ budgetPercent() }}%</strong></div>
        </section>
        <div class="budget-card-grid">
          @for (budget of budgets(); track budget.name) {
            <article class="product-panel budget-category-card">
              <header><div><span>{{ budget.icon }}</span><strong>{{ budget.name }}</strong></div><strong>{{ budget.percent }}%</strong></header>
              <div class="budget-numbers"><strong>{{ money(budget.used) }}</strong><span>de {{ money(budget.limit) }}</span></div>
              <div class="progress-track"><span [style.width.%]="budget.percent"></span></div>
              <p>{{ money(budget.limit - budget.used) }} disponibles</p>
            </article>
          }
        </div>
      }

      @if (view() === 'analisis') {
        <section class="analysis-grid">
          <article class="product-panel analysis-highlight">
            <span class="panel-eyebrow">BALANCE DEL PERIODO</span>
            <strong>{{ money(state.totals().balance) }}</strong>
            <p>{{ state.totals().balance >= 0n ? 'Tus ingresos superan tus gastos en el periodo.' : 'Tus gastos superan tus ingresos en el periodo.' }}</p>
          </article>
          <article class="product-panel">
            <span class="panel-eyebrow">MAYOR CATEGORÍA</span>
            <strong class="analysis-value">{{ topCategory().name }}</strong>
            <p>{{ money(topCategory().amount) }} registrados.</p>
          </article>
          <article class="product-panel">
            <span class="panel-eyebrow">MOVIMIENTOS</span>
            <strong class="analysis-value">{{ state.filtered().length }}</strong>
            <p>Operaciones visibles con los filtros actuales.</p>
          </article>
        </section>
        <section class="product-panel">
          <header class="panel-heading"><div><span class="panel-eyebrow">DISTRIBUCIÓN</span><h2>Gastos por categoría</h2></div></header>
          <div class="analysis-bars">
            @for (budget of budgets().slice(0, 6); track budget.name) {
              <div><span>{{ budget.name }}</span><div class="analysis-track"><span [style.width.%]="budget.share"></span></div><strong>{{ money(budget.used) }}</strong></div>
            }
          </div>
        </section>
      }

      @if (view() === 'configuracion') {
        <div class="settings-header">
          <div><span>CONFIGURACIÓN</span><h2>Tu espacio, a tu manera</h2><p>Apariencia, privacidad, almacenamiento local e integraciones.</p></div>
          <a fpButton routerLink="/acceso">Administrar acceso</a>
        </div>
        <div class="settings-grid-public">
          <section class="product-panel">
            <span class="panel-eyebrow">APARIENCIA</span>
            <h2>Tema</h2>
            <div class="theme-selector">
              @for (theme of themes; track theme.value) {
                <button type="button" [class.active]="state.theme() === theme.value" (click)="state.setTheme(theme.value)">
                  <span aria-hidden="true">{{ theme.icon }}</span>{{ theme.label }}
                </button>
              }
            </div>
          </section>
          <section class="product-panel">
            <span class="panel-eyebrow">PRIVACIDAD</span>
            <h2>Importes visibles</h2>
            <p>Oculta importes cuando uses la aplicación frente a otras personas.</p>
            <button fpButton class="secondary" type="button" (click)="state.hidden.set(!state.hidden())">{{ state.hidden() ? 'Mostrar importes' : 'Ocultar importes' }}</button>
          </section>
          <section class="product-panel">
            <span class="panel-eyebrow">GMAIL</span>
            <h2>Automatización financiera</h2>
            <p>La conexión de Gmail usa autorización separada y permiso de solo lectura.</p>
            <a class="settings-link" routerLink="/gmail">Gestionar Gmail →</a>
          </section>
        </div>
        <fp-storage-lab />
      }

      @if (view() === 'nuevo') {
        <section class="product-panel empty-panel standalone-new">
          <span class="panel-eyebrow">REGISTRO</span>
          <h2>Registra un movimiento</h2>
          <p>Usa el formulario rápido para probar el flujo de captura.</p>
          <button fpButton type="button" (click)="showNew.set(true)">Abrir formulario</button>
        </section>
      }

      @if (showNew()) {
        <div class="composer-backdrop" (click)="showNew.set(false)">
          <section class="movement-composer" role="dialog" aria-modal="true" aria-labelledby="composer-title" (click)="$event.stopPropagation()">
            <header>
              <div><span class="panel-eyebrow">NUEVO MOVIMIENTO</span><h2 id="composer-title">Registrar operación</h2></div>
              <button type="button" class="close-composer" aria-label="Cerrar" (click)="showNew.set(false)">×</button>
            </header>
            <p class="composer-note">En esta publicación se conserva solamente durante la sesión actual.</p>
            <form (ngSubmit)="saveExample()">
              <div class="form-row">
                <label>Tipo<select fpSelect name="kind" [(ngModel)]="form.kind"><option value="expense">Gasto</option><option value="income">Ingreso</option><option value="transfer">Transferencia</option><option value="payment">Pago</option></select></label>
                <label>Moneda<select fpSelect name="currency" [(ngModel)]="form.currency"><option>PEN</option><option>USD</option></select></label>
              </div>
              <label>Importe<input fpInput name="amount" [(ngModel)]="form.amount" inputmode="decimal" placeholder="0.00" required /></label>
              <label>Comercio o concepto<input fpInput name="merchant" [(ngModel)]="form.merchant" maxlength="60" placeholder="Ej. supermercado" required /></label>
              <label>Categoría<select fpSelect name="category" [(ngModel)]="form.category">@for (category of categories; track category) {<option>{{ category }}</option>}</select></label>
              @if (formError()) { <fp-alert>{{ formError() }}</fp-alert> }
              <div class="composer-actions"><button type="button" class="quiet-action" (click)="showNew.set(false)">Cancelar</button><button fpButton type="submit">Guardar en esta sesión</button></div>
            </form>
          </section>
        </div>
      }

      @if (toast()) {
        <div class="public-toast" role="status">{{ toast() }}</div>
      }
    </section>
  `,
})
export class PublicProductScreen {
  readonly view = input('inicio');
  readonly state = inject(DemoState);
  readonly ranges = RANGE_OPTIONS;
  readonly categories = CATEGORIES;
  readonly showNew = signal(false);
  readonly formError = signal('');
  readonly toast = signal('');

  readonly titles: Record<string, string> = {
    inicio: 'Mis finanzas',
    movimientos: 'Movimientos',
    cuentas: 'Cuentas',
    tarjetas: 'Tarjetas',
    presupuestos: 'Presupuestos',
    analisis: 'Análisis',
    configuracion: 'Configuración',
    nuevo: 'Nuevo movimiento',
  };

  readonly subtitles: Record<string, string> = {
    inicio: 'Tu panorama financiero en un solo lugar.',
    movimientos: 'Busca, filtra y entiende cada movimiento.',
    cuentas: 'Organiza cuentas, efectivo y categorías sin mezclar monedas.',
    tarjetas: 'Controla línea, consumo, cierre y próximo pago.',
    presupuestos: 'Define límites y revisa cuánto te queda disponible.',
    analisis: 'Convierte tus movimientos en información útil.',
    configuracion: 'Personaliza la aplicación y controla tu privacidad.',
    nuevo: 'Captura gastos e ingresos de forma rápida.',
  };

  readonly title = computed(() => this.titles[this.view()] ?? 'Mis finanzas');
  readonly subtitle = computed(() => this.subtitles[this.view()] ?? 'Tu espacio financiero personal.');

  readonly themes = [
    { value: 'light' as const, label: 'Claro', icon: '☀' },
    { value: 'dark' as const, label: 'Oscuro', icon: '☾' },
    { value: 'system' as const, label: 'Sistema', icon: '◐' },
  ];

  form: {
    kind: DemoTransaction['kind'];
    currency: 'PEN' | 'USD';
    amount: string;
    merchant: string;
    category: string;
  } = { kind: 'expense', currency: 'PEN', amount: '', merchant: '', category: 'Otros' };

  readonly accountBalance = computed(() => (this.state.currency() === 'PEN' ? 562000n : 150000n));

  readonly monthExpense = computed(() =>
    this.state
      .rows()
      .filter(
        (row) =>
          row.currency === this.state.currency() &&
          row.kind === 'expense' &&
          row.date.startsWith('2026-09'),
      )
      .reduce((sum, row) => sum + BigInt(row.minor), 0n),
  );

  readonly budgetLimit = computed(() => (this.state.currency() === 'PEN' ? 180000n : 30000n));
  readonly budgetRemaining = computed(() => this.budgetLimit() - this.monthExpense());
  readonly budgetPercent = computed(() =>
    Math.min(100, Number((this.monthExpense() * 100n) / this.budgetLimit())),
  );

  readonly recentRows = computed(() => this.state.filtered().slice(0, 5));
  readonly cardRows = computed(() =>
    this.state
      .rows()
      .filter((row) => row.kind === 'expense' && row.currency === 'PEN')
      .slice(0, 4),
  );

  readonly allAccounts = computed(() => [
    { name: 'Cuenta diaria', detail: 'Ahorros · Principal', currency: 'PEN' as const, minor: '300000', icon: '▣' },
    { name: 'Ahorro', detail: 'Ahorros · Meta principal', currency: 'PEN' as const, minor: '250000', icon: '◇' },
    { name: 'Efectivo', detail: 'Billetera', currency: 'PEN' as const, minor: '12000', icon: '▱' },
    { name: 'Cuenta USD', detail: 'Ahorros · Dólares', currency: 'USD' as const, minor: '150000', icon: '$' },
  ]);

  readonly visibleAccounts = computed(() =>
    this.allAccounts()
      .filter((account) => account.currency === this.state.currency())
      .slice(0, 3),
  );

  readonly budgets = computed(() => {
    const icons: Record<string, string> = {
      Supermercado: '▦',
      Restaurante: '☕',
      Transporte: '↗',
      Servicios: '⌁',
      Tecnología: '◇',
      Otros: '•••',
    };
    const names = ['Supermercado', 'Restaurante', 'Transporte', 'Servicios', 'Tecnología', 'Otros'];
    const totalExpense = this.monthExpense();
    return names.map((name) => {
      const limit = this.state.currency() === 'PEN' ? 30000n : 5000n;
      const used = this.state
        .rows()
        .filter(
          (row) =>
            row.currency === this.state.currency() &&
            row.category === name &&
            row.kind === 'expense' &&
            row.date.startsWith('2026-09'),
        )
        .reduce((sum, row) => sum + BigInt(row.minor), 0n);
      return {
        name,
        icon: icons[name] ?? '•',
        limit,
        used,
        percent: Math.min(100, Number((used * 100n) / limit)),
        share: totalExpense === 0n ? 0 : Math.min(100, Number((used * 100n) / totalExpense)),
      };
    });
  });

  readonly topCategory = computed(() => {
    const top = this.budgets().reduce(
      (best, item) => (item.used > best.used ? item : best),
      { name: 'Sin gastos', used: 0n },
    );
    return { name: top.name, amount: top.used };
  });

  money(value: string | bigint) {
    return this.state.hidden() ? '••••' : formatMinor(value, this.state.currency());
  }

  clean(value: string) {
    return value.replace(/\s*DEMO\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  }

  setRange(value: RangeLabel) {
    this.state.range.set(value);
  }

  saveExample() {
    try {
      const minor = parseDemoAmount(this.form.amount);
      const merchant = this.form.merchant.trim();
      if (!merchant) throw new Error('Escribe un comercio o concepto.');
      this.state.rows.update((rows) => [
        {
          id: crypto.randomUUID(),
          demo: true,
          date: DEMO_TODAY,
          merchant,
          category: this.form.category,
          account: 'Cuenta diaria',
          bank: 'Banco principal',
          currency: this.form.currency,
          minor,
          kind: this.form.kind,
          icon: this.form.kind === 'income' ? '↓' : '↗',
        },
        ...rows,
      ]);
      this.state.currency.set(this.form.currency);
      this.form = { ...this.form, amount: '', merchant: '' };
      this.formError.set('');
      this.showNew.set(false);
      this.toast.set('Movimiento guardado en esta sesión.');
      setTimeout(() => this.toast.set(''), 3500);
    } catch (error) {
      this.formError.set(error instanceof Error ? error.message : 'Revisa los campos.');
    }
  }
}
