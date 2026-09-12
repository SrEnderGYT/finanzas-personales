import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DemoState } from './demo-state';
import { Screen } from './screen';
import { UI_PRIMITIVES } from './primitives';
import { formatMinor, type DemoTransaction } from '../../shared/src/demo';

interface PreviewCurrencySummary {
  currency: 'PEN' | 'USD';
  confirmedCount: number;
  incomeMinor: bigint;
  expenseMinor: bigint;
  balanceMinor: bigint;
}

@Component({
  selector: 'fp-product-preview',
  imports: [FormsModule, RouterLink, Screen, ...UI_PRIMITIVES],
  styleUrl: './manual-screen.css',
  template: `
    @if (legacyView()) {
      <fp-screen [view]="view()" />
    } @else {
      <section class="manual-page">
        <header class="page-heading">
          <div>
            <p class="eyebrow">VISTA FUNCIONAL · DEMO</p>
            <h1>{{ title() }}</h1>
            <p>
              Esta vista replica la interfaz más reciente con datos sintéticos para revisión visual.
              No usa tus cuentas, tu correo ni el backend privado.
            </p>
          </div>
          <a fpButton routerLink="/registro">Probar registro local</a>
        </header>

        <div class="mode-banner" role="note">
          <strong>Preview seguro.</strong> Todo lo que ves aquí es ficticio. El producto privado usa
          los mismos componentes con información autenticada.
        </div>

        @if (view() === 'inicio') {
          <section class="product-status-grid" aria-label="Estado sintético de movimientos">
            <article class="product-stat-card">
              <span>Confirmados</span>
              <strong>{{ confirmedCount() }}</strong>
              <small>Incluidos en los totales DEMO</small>
            </article>
            <article class="product-stat-card">
              <span>Pendientes</span>
              <strong>2</strong>
              <small>Ejemplo de operaciones aún locales</small>
            </article>
            <article class="product-stat-card needs-attention">
              <span>Requieren atención</span>
              <strong>1</strong>
              <small>Ejemplo de conflicto/revisión</small>
            </article>
          </section>

          <div class="product-currency-grid">
            @for (currency of summaries(); track currency.currency) {
              <section class="manual-card currency-summary">
                <header>
                  <div>
                    <p class="eyebrow">{{ currency.currency }}</p>
                    <h2>Movimientos confirmados</h2>
                  </div>
                  <span>{{ currency.confirmedCount }} operación(es)</span>
                </header>
                <dl class="money-summary">
                  <div>
                    <dt>Ingresos</dt>
                    <dd>{{ exact(currency.incomeMinor, currency.currency) }}</dd>
                  </div>
                  <div>
                    <dt>Gastos</dt>
                    <dd>{{ exact(currency.expenseMinor, currency.currency) }}</dd>
                  </div>
                  <div>
                    <dt>Balance registrado</dt>
                    <dd>{{ exact(currency.balanceMinor, currency.currency) }}</dd>
                  </div>
                </dl>
                <p class="zone-note">
                  DEMO: resume movimientos de muestra y no representa un saldo bancario.
                </p>
              </section>
            }
          </div>

          <section class="manual-card">
            <header class="product-section-heading">
              <div>
                <h2>Actividad reciente</h2>
                <p>La interfaz final diferencia confirmado, pendiente y revisión.</p>
              </div>
              <a routerLink="/movimientos">Ver todos</a>
            </header>
            @for (row of recent(); track row.id; let i = $index) {
              <article class="pending-row" [attr.data-state]="previewState(i)">
                <div>
                  <strong>{{ label(row) }} · {{ exact(row.minor, row.currency) }}</strong>
                  <span>{{ row.account }} · {{ row.category }}</span>
                  <span>{{ row.date }} · {{ row.bank }}</span>
                </div>
                <span class="pending-badge">{{ previewStateLabel(i) }}</span>
              </article>
            }
          </section>
        } @else if (view() === 'movimientos') {
          <div class="local-toolbar">
            <p role="status">Preview visual de sincronización</p>
            <button fpButton type="button" disabled>Sincronizar ahora</button>
            <span>Última sincronización DEMO: hace 2 min</span>
          </div>

          <section class="manual-card movement-filter-card" aria-label="Filtrar movimientos DEMO">
            <div class="movement-search-row">
              <label>
                Buscar
                <input
                  fpInput
                  type="search"
                  placeholder="Comercio, categoría, cuenta o importe"
                  [ngModel]="state.query()"
                  (ngModelChange)="state.query.set($event)"
                />
              </label>
              <span>{{ visibleRows().length }} resultado(s)</span>
            </div>
            <div class="movement-filter-grid">
              <label>
                Moneda
                <select
                  fpSelect
                  [ngModel]="state.currency()"
                  (ngModelChange)="state.currency.set($event)"
                >
                  <option value="PEN">PEN</option>
                  <option value="USD">USD</option>
                </select>
              </label>
              <label>
                Tipo
                <select fpSelect [ngModel]="kind()" (ngModelChange)="kind.set($event)">
                  <option value="all">Todos</option>
                  <option value="expense">Gastos</option>
                  <option value="income">Ingresos</option>
                </select>
              </label>
              <label>
                Estado visual
                <select fpSelect [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
                  <option value="all">Todos</option>
                  <option value="confirmed">Confirmados</option>
                  <option value="pending">Pendientes</option>
                  <option value="attention">Requieren atención</option>
                </select>
              </label>
            </div>
            <button fpButton class="secondary" type="button" (click)="clearFilters()">
              Limpiar filtros
            </button>
          </section>

          <section class="manual-card" aria-label="Lista DEMO de movimientos">
            @for (row of visibleRows(); track row.id; let i = $index) {
              <article class="pending-row" [attr.data-state]="previewState(i)">
                <div>
                  <strong>{{ label(row) }} · {{ exact(row.minor, row.currency) }}</strong>
                  <span>{{ row.date }} · {{ row.account }} · {{ row.category }}</span>
                  <p>{{ row.merchant }}</p>
                </div>
                <span class="pending-badge">{{ previewStateLabel(i) }}</span>
              </article>
            } @empty {
              <h2>No hay movimientos con estos filtros</h2>
              <p>Ajusta o limpia los filtros para continuar revisando la interfaz.</p>
            }
          </section>
        } @else if (view() === 'cuentas') {
          <div class="manual-grid">
            <section class="manual-card">
              <p class="eyebrow">PEN</p>
              <h2>Cuenta diaria DEMO</h2>
              <p>Ahorros · Banco DEMO</p>
              <strong>{{ exact(300000n, 'PEN') }}</strong>
              <p class="zone-note">Saldo ilustrativo para validar la interfaz.</p>
            </section>
            <section class="manual-card">
              <p class="eyebrow">USD</p>
              <h2>Cuenta USD DEMO</h2>
              <p>Ahorros · Banco DEMO</p>
              <strong>{{ exact(150000n, 'USD') }}</strong>
              <p class="zone-note">Las monedas permanecen separadas.</p>
            </section>
          </div>
          <section class="manual-card product-empty-state">
            <header class="product-section-heading">
              <div>
                <h2>Categorías</h2>
                <p>Ejemplo de catálogo que alimenta el registro manual y Gmail.</p>
              </div>
            </header>
            <p>Supermercado · Gasto</p>
            <p>Transporte · Gasto</p>
            <p>Servicios · Gasto</p>
            <p>Ingreso · Ingreso</p>
          </section>
        } @else if (view() === 'configuracion') {
          <div class="manual-grid">
            <section class="manual-card">
              <h2>Acceso y privacidad</h2>
              <p>
                En el entorno privado esta sección administra sesión, bloqueo local y seguridad.
              </p>
              <a routerLink="/acceso">Revisar pantalla de acceso</a>
            </section>
            <section class="manual-card">
              <h2>Automatización Gmail</h2>
              <p>
                La nueva interfaz Gmail ya puede validarse visualmente con datos sintéticos sin
                conceder permisos reales.
              </p>
              <a routerLink="/gmail">Abrir Gmail</a>
            </section>
          </div>
          <section class="manual-card product-empty-state">
            <h2>Qué valida este preview</h2>
            <p>
              Diseño, navegación, filtros, estados y flujos. Login real, PostgreSQL y OAuth real se
              prueban únicamente en staging privado.
            </p>
          </section>
        }
      </section>
    }
  `,
})
export class ProductPreview {
  readonly view = input('inicio');
  readonly state = inject(DemoState);
  readonly kind = signal<'all' | 'expense' | 'income'>('all');
  readonly statusFilter = signal<'all' | 'confirmed' | 'pending' | 'attention'>('all');

  readonly legacyView = computed(() =>
    ['tarjetas', 'presupuestos', 'analisis', 'nuevo'].includes(this.view()),
  );

  readonly title = computed(
    () =>
      ({
        inicio: 'Inicio',
        movimientos: 'Movimientos',
        cuentas: 'Cuentas',
        configuracion: 'Configuración',
      })[this.view()] ?? 'Mi espacio',
  );

  readonly confirmedRows = computed(() =>
    this.state.rows().filter((row) => row.kind === 'expense' || row.kind === 'income'),
  );

  readonly confirmedCount = computed(() => this.confirmedRows().length);

  readonly summaries = computed<PreviewCurrencySummary[]>(() =>
    (['PEN', 'USD'] as const).map((currency) => {
      const rows = this.confirmedRows().filter((row) => row.currency === currency);
      const incomeMinor = rows
        .filter((row) => row.kind === 'income')
        .reduce((sum, row) => sum + BigInt(row.minor), 0n);
      const expenseMinor = rows
        .filter((row) => row.kind === 'expense')
        .reduce((sum, row) => sum + BigInt(row.minor), 0n);
      return {
        currency,
        confirmedCount: rows.length,
        incomeMinor,
        expenseMinor,
        balanceMinor: incomeMinor - expenseMinor,
      };
    }),
  );

  readonly recent = computed(() => this.confirmedRows().slice(0, 5));

  readonly visibleRows = computed(() => {
    const status = this.statusFilter();
    return this.state.filtered().filter((row, index) => {
      if (row.kind !== 'expense' && row.kind !== 'income') return false;
      if (this.kind() !== 'all' && row.kind !== this.kind()) return false;
      if (status === 'all') return true;
      return this.previewState(index) === status;
    });
  });

  previewState(index: number): 'confirmed' | 'pending' | 'attention' {
    if (index === 1) return 'pending';
    if (index === 2) return 'attention';
    return 'confirmed';
  }

  previewStateLabel(index: number) {
    const state = this.previewState(index);
    return state === 'confirmed' ? 'Confirmado' : state === 'pending' ? 'Pendiente' : 'Requiere revisión';
  }

  label(row: DemoTransaction) {
    return row.kind === 'income' ? 'Ingreso' : 'Gasto';
  }

  exact(value: string | bigint, currency: 'PEN' | 'USD') {
    return formatMinor(value, currency);
  }

  clearFilters() {
    this.state.query.set('');
    this.kind.set('all');
    this.statusFilter.set('all');
  }
}
