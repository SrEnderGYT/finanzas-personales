import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CATEGORIES,
  DEMO_TODAY,
  formatMinor,
  parseDemoAmount,
  RANGE_OPTIONS,
  RangeLabel,
} from '../../shared/src/demo';
import { DemoState } from './demo-state';
import { UI_PRIMITIVES } from './primitives';

@Component({
  selector: 'fp-screen',
  imports: [FormsModule, RouterLink, ...UI_PRIMITIVES],
  template: `
    <div class="page-heading">
      <div>
        <p class="eyebrow">{{ view() === 'inicio' ? 'SEPTIEMBRE 2026' : 'MI ESPACIO DEMO' }}</p>
        <h1>{{ title() }}</h1>
        <p class="page-intro">{{ subtitle() }}</p>
      </div>
      <button fpButton type="button" (click)="showNew.set(true)">
        <span aria-hidden="true">+</span> Movimiento demo
      </button>
    </div>
    @if (view() !== 'configuracion' && view() !== 'nuevo') {
      <div class="filter-toolbar">
        <div class="currency-switch" role="group" aria-label="Moneda">
          <button [class.selected]="state.currency() === 'PEN'" (click)="state.currency.set('PEN')">
            PEN <span>Soles</span></button
          ><button
            [class.selected]="state.currency() === 'USD'"
            (click)="state.currency.set('USD')"
          >
            USD <span>Dólares</span>
          </button>
        </div>
        <label class="range-label"
          ><span aria-hidden="true">▦</span
          ><select
            fpSelect
            aria-label="Rango financiero"
            [ngModel]="state.range()"
            (ngModelChange)="setRange($event)"
          >
            @for (option of ranges; track option) {
              <option>{{ option }}</option>
            }
          </select></label
        >
      </div>
      @if (state.range() === 'Personalizado') {
        <div class="custom-range">
          <label
            >Desde<input
              fpDatePicker
              [ngModel]="state.start()"
              (ngModelChange)="state.start.set($event)" /></label
          ><label
            >Hasta<input
              fpDatePicker
              [ngModel]="state.end()"
              (ngModelChange)="state.end.set($event)"
          /></label>
        </div>
      }
      @if (state.rangeError()) {
        <fp-alert>{{ state.rangeError() }}</fp-alert>
      } @else {
        <p class="period-caption">
          {{ state.period()[0] }} — {{ state.period()[1] }} <span>· Sin conversión de moneda</span>
        </p>
      }
    }
    @if (view() === 'inicio' || view() === 'analisis') {
      <div class="overview-grid">
        <section class="balance-card">
          <div class="balance-heading">
            <span>Saldo de cuentas DEMO</span
            ><span class="balance-symbol" aria-hidden="true">↗</span>
          </div>
          <strong class="balance-amount">{{
            money(state.currency() === 'PEN' ? '562000' : '150000')
          }}</strong>
          <p>Saldos iniciales de muestra · {{ state.currency() }}</p>
          <div class="balance-bottom">
            <span>3 cuentas de muestra</span
            ><a routerLink="/cuentas">Ver cuentas <span aria-hidden="true">↗</span></a>
          </div>
        </section>
        <div class="summary-grid">
          <fp-financial-card
            label="Ingresos del periodo"
            [value]="money(state.totals().income)"
            note="↓ Entradas registradas"
          /><fp-financial-card
            label="Gastos del periodo"
            [value]="money(state.totals().expense)"
            note="↑ Compras, sin repetir pagos"
          /><fp-financial-card
            label="Balance del periodo"
            [value]="money(state.totals().balance)"
            note="Ingresos menos gastos"
          /><fp-financial-card
            label="Ahorro de muestra"
            [value]="money(state.currency() === 'PEN' ? '250000' : '0')"
            note="Saldo inicial asignado a ahorro"
          />
        </div>
      </div>
      <div class="dashboard-grid">
        <fp-chart-card title="Gastos por categoría" subtitle="En el periodo"
          ><div class="category-chart">
            <div
              class="donut"
              [style.background]="donut()"
              role="img"
              [attr.aria-label]="'Distribución de ' + money(state.totals().expense)"
            >
              <div>
                <span>Gasto total</span><strong>{{ money(state.totals().expense) }}</strong>
              </div>
            </div>
            <div class="category-legend">
              @for (cat of categoriesUsed(); track cat.name) {
                <div>
                  <span class="legend-dot" [style.background]="cat.color"></span
                  ><span>{{ cat.name }}</span
                  ><strong>{{ money(cat.amount) }}</strong>
                </div>
              } @empty {
                <p>Sin gastos en este periodo.</p>
              }
            </div>
          </div></fp-chart-card
        >
        <fp-chart-card title="Tu presupuesto" subtitle="Septiembre · DEMO"
          ><div class="budget-top">
            <strong>{{ money(monthExpense()) }}</strong
            ><span>de {{ money(budgetLimit()) }}</span>
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
          <p class="budget-note">
            {{ budgetPercent() }}% utilizado · {{ money(budgetRemaining()) }} disponibles
          </p>
          <div class="budget-tip">
            <span aria-hidden="true">✧</span>
            <p>Tu presupuesto mensual se mantiene separado de los filtros del dashboard.</p>
          </div>
          <a routerLink="/presupuestos" class="text-link"
            >Ver presupuestos <span aria-hidden="true">→</span></a
          ></fp-chart-card
        >
        <fp-card class="activity-card"
          ><header class="section-heading">
            <h2>Últimos movimientos</h2>
            <a routerLink="/movimientos" class="text-link">Ver todos →</a>
          </header>
          @for (row of state.filtered().slice(0, 5); track row.id) {
            <fp-transaction-row
              [icon]="row.icon"
              [merchant]="row.merchant"
              [detail]="row.category + ' · ' + row.date"
              [amount]="(row.kind === 'income' ? '+' : '−') + money(row.minor)"
              [positive]="row.kind === 'income'"
            />
          } @empty {
            <fp-empty-state />
          }
        </fp-card>
        <fp-card class="upcoming-card"
          ><header class="section-heading">
            <h2>Próximos pagos</h2>
            <fp-badge>DEMO</fp-badge>
          </header>
          <div class="due-row">
            <span class="calendar-tile">SEP<strong>18</strong></span>
            <div><strong>Visa de muestra</strong><span>Pago del periodo</span></div>
            <strong>{{ money(state.currency() === 'PEN' ? '35000' : '4000') }}</strong>
          </div>
          <div class="due-row">
            <span class="calendar-tile">SEP<strong>22</strong></span>
            <div><strong>Internet DEMO</strong><span>Servicio mensual</span></div>
            <strong>{{ state.currency() === 'PEN' ? money('12900') : '—' }}</strong>
          </div>
          <p class="muted small">Fechas e importes ficticios. No hay pagos programados.</p></fp-card
        >
      </div>
    }
    @if (view() === 'movimientos') {
      <div class="search-bar">
        <label
          ><span class="visually-hidden">Buscar movimientos</span
          ><input
            fpSearchInput
            placeholder="Buscar comercio, categoría, cuenta o importe…"
            [ngModel]="state.query()"
            (ngModelChange)="state.query.set($event)" /></label
        ><span>{{ state.filtered().length }} movimientos</span>
      </div>
      <fp-card
        ><header class="section-heading">
          <h2>Actividad del periodo</h2>
          <span>{{ state.currency() }}</span>
        </header>
        @for (row of state.filtered(); track row.id) {
          <fp-transaction-row
            [icon]="row.icon"
            [merchant]="row.merchant"
            [detail]="row.category + ' · ' + row.account + ' · ' + row.date"
            [amount]="(row.kind === 'income' ? '+' : '−') + money(row.minor)"
            [positive]="row.kind === 'income'"
          />
        } @empty {
          <fp-empty-state
            ><button fpButton class="secondary" (click)="state.query.set('')">
              Limpiar búsqueda
            </button></fp-empty-state
          >
        }
      </fp-card>
    }
    @if (view() === 'cuentas') {
      <div class="account-grid">
        <fp-account-card
          name="Cuenta diaria DEMO"
          detail="Ahorros · Banco DEMO · PEN"
          [balance]="shown('300000', 'PEN')"
        /><fp-account-card
          name="Ahorro de muestra"
          detail="Ahorros · PEN"
          [balance]="shown('250000', 'PEN')"
          icon="◇"
        /><fp-account-card
          name="Efectivo de muestra"
          detail="Efectivo · PEN"
          [balance]="shown('12000', 'PEN')"
          icon="▱"
        /><fp-account-card
          name="Cuenta USD DEMO"
          detail="Ahorros · USD"
          [balance]="shown('150000', 'USD')"
          icon="$"
        />
      </div>
      <p class="muted">
        Saldos iniciales ilustrativos. El registro y la conciliación de cuentas se implementan en el
        core, después de revisar P03.
      </p>
    }
    @if (view() === 'tarjetas') {
      <div class="cards-layout">
        <fp-credit-card /><fp-card
          ><h2>Visa DEMO · PEN</h2>
          <dl class="card-facts">
            @for (fact of cardFacts; track fact.label) {
              <div>
                <dt>{{ fact.label }}</dt>
                <dd>{{ state.hidden() ? '••••' : fact.value }}</dd>
              </div>
            }
          </dl>
          <div class="progress-track"><span style="width:28%"></span></div>
          <p class="budget-note">28% de utilización · Datos ilustrativos</p></fp-card
        >
      </div>
    }
    @if (view() === 'presupuestos') {
      <fp-alert
        >Presupuestos de septiembre DEMO. Transferencias y pagos de tarjetas no se cuentan como
        gastos.</fp-alert
      >
      <div class="budget-grid">
        @for (b of budgets(); track b.name) {
          <fp-card
            ><header class="section-heading">
              <h2>{{ b.name }}</h2>
              <fp-badge>{{ b.percent }}%</fp-badge>
            </header>
            <div class="budget-top">
              <strong>{{ money(b.used) }}</strong
              ><span>de {{ money(b.limit) }}</span>
            </div>
            <div class="progress-track"><span [style.width.%]="b.percent"></span></div>
            <p class="budget-note">Disponible: {{ money(b.limit - b.used) }}</p></fp-card
          >
        }
      </div>
    }
    @if (view() === 'configuracion') {
      <div class="settings-grid">
        <fp-card
          ><h2>Apariencia</h2>
          <p class="muted">Elige cómo quieres ver tu espacio.</p>
          <div class="theme-options">
            @for (t of themes; track t.value) {
              <button [class.active]="state.theme() === t.value" (click)="state.setTheme(t.value)">
                <span aria-hidden="true">{{ t.icon }}</span
                >{{ t.label }}
              </button>
            }
          </div></fp-card
        ><fp-card
          ><h2>Privacidad del preview</h2>
          <p>Todos los datos son sintéticos. No hay cuentas bancarias ni correo conectados.</p>
          <fp-sync-status /><button
            fpButton
            class="secondary"
            (click)="state.hidden.set(!state.hidden())"
          >
            {{ state.hidden() ? 'Mostrar' : 'Ocultar' }} importes
          </button></fp-card
        ><fp-card
          ><h2>Aplicación en tu teléfono</h2>
          <p class="muted">
            Desde Chrome usa “Instalar aplicación”. En Safari: Compartir → Añadir a pantalla de
            inicio.
          </p>
          <p class="small">La PWA no equivale a una instalación nativa de iOS.</p></fp-card
        >
      </div>
    }
    @if (view() === 'nuevo') {
      <fp-empty-state
        title="Prueba un movimiento DEMO"
        detail="Se conserva sólo durante esta sesión. No uses información real."
        ><button fpButton (click)="showNew.set(true)">Abrir formulario</button></fp-empty-state
      >
    }
    @if (showNew()) {
      <fp-bottom-sheet title="Nuevo movimiento DEMO" (close)="showNew.set(false)"
        ><p class="muted small">Sólo datos ficticios. Se guarda en memoria durante esta sesión.</p>
        <form (ngSubmit)="saveDemo()">
          <div class="form-grid">
            <label class="field-label"
              >Tipo<select fpSelect name="kind" [(ngModel)]="form.kind">
                <option value="expense">Gasto</option>
                <option value="income">Ingreso</option>
                <option value="transfer">Transferencia</option>
                <option value="payment">Pago</option>
              </select></label
            ><label class="field-label"
              >Moneda<select fpSelect name="currency" [(ngModel)]="form.currency">
                <option>PEN</option>
                <option>USD</option>
              </select></label
            >
          </div>
          <label class="field-label"
            >Importe<input
              fpMoneyInput
              name="amount"
              [(ngModel)]="form.amount"
              placeholder="0.00"
              required /></label
          ><label class="field-label"
            >Comercio o concepto de muestra<input
              fpInput
              name="merchant"
              [(ngModel)]="form.merchant"
              maxlength="60"
              required /></label
          ><fp-category-picker
            [options]="allCategories"
            [value]="form.category"
            (valueChange)="form.category = $event"
          />
          @if (formError()) {
            <fp-alert>{{ formError() }}</fp-alert>
          }
          <button fpButton class="full-width" type="submit">Guardar demo de sesión</button>
        </form></fp-bottom-sheet
      >
    }
    @if (toast()) {
      <fp-toast>{{ toast() }}</fp-toast>
    }
  `,
})
export class Screen {
  readonly view = input('inicio');
  readonly state = inject(DemoState);
  readonly ranges = RANGE_OPTIONS;
  readonly allCategories = CATEGORIES;
  readonly titles: Record<string, string> = {
    inicio: 'Tu resumen',
    movimientos: 'Movimientos',
    cuentas: 'Tus cuentas',
    tarjetas: 'Tus tarjetas',
    presupuestos: 'Presupuestos',
    configuracion: 'Tu espacio, a tu manera',
    analisis: 'Tu dinero en perspectiva',
    nuevo: 'Nuevo movimiento',
  };
  readonly title = computed(() => this.titles[this.view()] ?? 'Tu resumen');
  readonly subtitle = computed(() =>
    this.view() === 'inicio'
      ? 'Todo lo importante, en un solo lugar.'
      : 'Explora y prueba con datos de muestra.',
  );
  readonly showNew = signal(false);
  readonly formError = signal('');
  readonly toast = signal('');
  form: {
    kind: 'expense' | 'income' | 'transfer' | 'payment';
    currency: 'PEN' | 'USD';
    amount: string;
    merchant: string;
    category: string;
  } = { kind: 'expense', currency: 'PEN', amount: '', merchant: '', category: 'Otros' };
  readonly themes = [
    { value: 'light' as const, label: 'Claro', icon: '☀' },
    { value: 'dark' as const, label: 'Oscuro', icon: '☾' },
    { value: 'system' as const, label: 'Sistema', icon: '◐' },
  ];
  readonly cardFacts = [
    { label: 'Línea', value: 'S/ 5,000.00' },
    { label: 'Utilizado', value: 'S/ 1,400.00' },
    { label: 'Disponible', value: 'S/ 3,600.00' },
    { label: 'Corte', value: '28 de septiembre' },
    { label: 'Próximo pago', value: '18 de septiembre' },
    { label: 'Pago mínimo', value: 'S/ 80.00' },
    { label: 'Pago del periodo', value: 'S/ 350.00' },
    { label: 'Pendiente', value: 'S/ 0.00' },
  ];
  money = (n: string | bigint) => this.shown(n, this.state.currency());
  shown(n: string | bigint, c: 'PEN' | 'USD') {
    return this.state.hidden() ? '••••' : formatMinor(n, c);
  }
  setRange(r: RangeLabel) {
    this.state.range.set(r);
  }
  readonly categoriesUsed = computed(() => {
    const colors = ['#635BFF', '#14B8A6', '#7C3AED', '#F59E0B', '#EF4444'];
    const map = new Map<string, bigint>();
    for (const r of this.state.filtered())
      if (r.kind === 'expense') map.set(r.category, (map.get(r.category) ?? 0n) + BigInt(r.minor));
    return [...map].map(([name, amount], i) => ({
      name,
      amount,
      color: colors[i % colors.length] ?? '#635BFF',
    }));
  });
  readonly donut = computed(() => {
    let start = 0;
    const total = this.state.totals().expense;
    if (total === 0n) return 'var(--border)';
    return (
      'conic-gradient(' +
      this.categoriesUsed()
        .map((c) => {
          const end = start + Number((c.amount * 10000n) / total) / 100;
          const part = `${c.color} ${start}% ${end}%`;
          start = end;
          return part;
        })
        .join(',') +
      ')'
    );
  });
  readonly monthExpense = computed(() =>
    this.state
      .rows()
      .filter(
        (r) =>
          r.currency === this.state.currency() &&
          r.date.startsWith('2026-09') &&
          r.kind === 'expense',
      )
      .reduce((n, r) => n + BigInt(r.minor), 0n),
  );
  readonly budgetLimit = computed(() => (this.state.currency() === 'PEN' ? 180000n : 20000n));
  readonly budgetRemaining = computed(() => this.budgetLimit() - this.monthExpense());
  readonly budgetPercent = computed(() =>
    Math.min(100, Number((this.monthExpense() * 100n) / this.budgetLimit())),
  );
  readonly budgets = computed(() =>
    ['Supermercado', 'Restaurante', 'Transporte', 'Servicios', 'Tecnología', 'Otros'].map(
      (name) => {
        const limit = this.state.currency() === 'PEN' ? 30000n : 5000n;
        const used = this.state
          .rows()
          .filter(
            (r) =>
              r.currency === this.state.currency() &&
              r.category === name &&
              r.kind === 'expense' &&
              r.date.startsWith('2026-09'),
          )
          .reduce((n, r) => n + BigInt(r.minor), 0n);
        return { name, limit, used, percent: Math.min(100, Number((used * 100n) / limit)) };
      },
    ),
  );
  saveDemo() {
    try {
      const minor = parseDemoAmount(this.form.amount);
      if (!this.form.merchant.trim()) throw new Error('Escribe un concepto de muestra.');
      this.state.rows.update((rows) => [
        {
          id: crypto.randomUUID(),
          demo: true,
          date: DEMO_TODAY,
          merchant: this.form.merchant.trim(),
          category: this.form.category,
          account: 'Cuenta diaria',
          bank: 'Banco DEMO',
          currency: this.form.currency,
          minor,
          kind: this.form.kind,
          icon: '↗',
        },
        ...rows,
      ]);
      this.state.currency.set(this.form.currency);
      this.showNew.set(false);
      this.formError.set('');
      this.toast.set('Demo guardada en esta sesión.');
      setTimeout(() => this.toast.set(''), 4500);
    } catch (e) {
      this.formError.set(e instanceof Error ? e.message : 'Revisa los campos.');
    }
  }
}
