import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ProductWorkspace } from './product-workspace';
import { Screen } from './screen';
import { UI_PRIMITIVES } from './primitives';
import { Money, type ManualPayload, type MovementVersion } from '../../domain/src';
import { CorrectionEditor } from './correction-editor';
import { movementVersion } from '../../shared/src/sync-engine';
import { CatalogCreator } from './catalog-creator';
import {
  filterProductMovements,
  formatMinorExact,
  summarizeProductMovements,
  type ProductMovementFilters,
  type ProductMovementItem,
} from './product-insights';

@Component({
  selector: 'fp-product-screen',
  imports: [FormsModule, RouterLink, Screen, CorrectionEditor, CatalogCreator, ...UI_PRIMITIVES],
  styleUrl: './manual-screen.css',
  template: `
    @if (!workspace.product()) {
      <fp-screen [view]="view()" />
    } @else {
      <section class="manual-page">
        <header class="page-heading">
          <div>
            <p class="eyebrow">MI ESPACIO</p>
            <h1>{{ title() }}</h1>
            <p>Tu información financiera, separada por moneda y sin cifras ficticias.</p>
          </div>
          <a fpButton routerLink="/registro">Registrar movimiento</a>
        </header>

        @if (view() === 'inicio') {
          @if (!workspace.unlocked()) {
            <section class="manual-card product-empty-state">
              <h2>Abre tu espacio cifrado</h2>
              <p>
                Inicia sesión y desbloquea tu perfil local para ver información confirmada y
                pendientes de este dispositivo.
              </p>
              <a routerLink="/registro">Abrir espacio cifrado</a>
            </section>
          } @else {
            <section class="product-status-grid" aria-label="Estado de tus movimientos">
              <article class="product-stat-card">
                <span>Confirmados</span>
                <strong>{{ summary().confirmedCount }}</strong>
                <small>Incluidos en los totales</small>
              </article>
              <article class="product-stat-card">
                <span>Pendientes</span>
                <strong>{{ summary().pendingCount }}</strong>
                <small>No alteran los totales confirmados</small>
              </article>
              <article
                class="product-stat-card"
                [class.needs-attention]="summary().attentionCount > 0"
              >
                <span>Requieren atención</span>
                <strong>{{ summary().attentionCount }}</strong>
                <small>Reintentos o rechazos conservados</small>
              </article>
            </section>

            @if (summary().currencies.length) {
              <div class="product-currency-grid">
                @for (currency of summary().currencies; track currency.currency) {
                  <section
                    class="manual-card currency-summary"
                    [attr.aria-label]="currency.currency"
                  >
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
                        <dd>{{ exact(currency.currency, currency.incomeMinor) }}</dd>
                      </div>
                      <div>
                        <dt>Gastos</dt>
                        <dd>{{ exact(currency.currency, currency.expenseMinor) }}</dd>
                      </div>
                      <div>
                        <dt>Balance registrado</dt>
                        <dd>{{ exact(currency.currency, currency.balanceMinor) }}</dd>
                      </div>
                    </dl>
                    <p class="zone-note">
                      Este balance resume movimientos confirmados. No representa el saldo bancario
                      de tus cuentas.
                    </p>
                  </section>
                }
              </div>
            } @else {
              <section class="manual-card product-empty-state">
                <h2>Aún no hay movimientos confirmados</h2>
                <p>
                  No mostramos cero como si fuera un saldo confirmado. Registra un movimiento y
                  espera su confirmación para ver el resumen.
                </p>
                <a routerLink="/registro">Registrar movimiento</a>
              </section>
            }

            <section class="manual-card">
              <header class="product-section-heading">
                <div>
                  <h2>Actividad reciente</h2>
                  <p>Confirmados y pendientes permanecen claramente diferenciados.</p>
                </div>
                <a routerLink="/movimientos">Ver todos</a>
              </header>
              @for (row of movementItems().slice(0, 5); track row.id) {
                <article class="pending-row" [attr.data-state]="row.state">
                  <div>
                    <strong
                      >{{ row.payload.kind === 'expense' ? 'Gasto' : 'Ingreso' }} ·
                      {{ money(row.payload) }}</strong
                    >
                    <span>{{ row.account }} · {{ row.category }}</span>
                    <span>{{ row.payload.businessDate }} · {{ row.payload.timezone }}</span>
                  </div>
                  <span class="pending-badge">{{ status(row.state) }}</span>
                </article>
              } @empty {
                <p class="empty-local">Todavía no existe actividad para mostrar.</p>
              }
            </section>
          }
        } @else if (view() === 'movimientos') {
          <div class="local-toolbar">
            <p role="status">{{ stateLabel() }}</p>
            <button
              fpButton
              (click)="workspace.syncNow()"
              [disabled]="!workspace.unlocked() || workspace.state() === 'syncing'"
            >
              Sincronizar ahora
            </button>
            <span
              >Última sincronización:
              {{ workspace.snapshot()?.lastSync ?? 'Todavía no realizada' }}</span
            >
          </div>
          <p role="alert">{{ workspace.error() }}</p>
          @if (workspace.state() === 'invalid' && workspace.unlocked()) {
            <section class="manual-card" aria-label="Recuperar sincronización">
              <h2>Recuperar la descarga</h2>
              <p>
                Volveremos a consultar el historial confirmado. Se conservarán la copia anterior
                cifrada y todos tus pendientes. Esta acción no envía movimientos.
              </p>
              <button fpButton (click)="workspace.recoverCheckpoint()">Recuperar descarga</button>
            </section>
          }

          <section class="manual-card movement-filter-card" aria-label="Filtrar movimientos">
            <div class="movement-search-row">
              <label>
                Buscar
                <input
                  fpInput
                  type="search"
                  placeholder="Cuenta, categoría, nota o importe"
                  [ngModel]="query()"
                  (ngModelChange)="query.set($event)"
                />
              </label>
              <span>{{ filteredMovements().length }} de {{ movementItems().length }}</span>
            </div>
            <div class="movement-filter-grid">
              <label>
                Moneda
                <select
                  fpSelect
                  [ngModel]="currencyFilter()"
                  (ngModelChange)="currencyFilter.set($event)"
                >
                  <option value="ALL">Todas</option>
                  <option value="PEN">PEN</option>
                  <option value="USD">USD</option>
                </select>
              </label>
              <label>
                Tipo
                <select fpSelect [ngModel]="kindFilter()" (ngModelChange)="kindFilter.set($event)">
                  <option value="all">Todos</option>
                  <option value="expense">Gastos</option>
                  <option value="income">Ingresos</option>
                </select>
              </label>
              <label>
                Estado
                <select
                  fpSelect
                  [ngModel]="stateFilter()"
                  (ngModelChange)="stateFilter.set($event)"
                >
                  <option value="all">Todos</option>
                  <option value="confirmed">Confirmados</option>
                  <option value="pending">Pendientes</option>
                  <option value="attention">Requieren atención</option>
                </select>
              </label>
              <label>
                Desde
                <input
                  fpInput
                  type="date"
                  [ngModel]="dateFrom()"
                  (ngModelChange)="dateFrom.set($event)"
                />
              </label>
              <label>
                Hasta
                <input
                  fpInput
                  type="date"
                  [ngModel]="dateTo()"
                  (ngModelChange)="dateTo.set($event)"
                />
              </label>
            </div>
            @if (rangeInvalid()) {
              <p role="alert" class="field-error">
                La fecha inicial no puede ser posterior a la fecha final.
              </p>
            }
            <button fpButton class="secondary" type="button" (click)="clearFilters()">
              Limpiar filtros
            </button>
          </section>

          <section class="manual-card" aria-label="Lista de movimientos">
            @for (row of filteredMovements(); track row.id) {
              <article class="pending-row" [attr.data-state]="row.state">
                <div>
                  <strong
                    >{{ row.payload.kind === 'expense' ? 'Gasto' : 'Ingreso' }} ·
                    {{ money(row.payload) }}</strong
                  >
                  <span>{{ row.payload.businessDate }} · {{ row.payload.timezone }}</span>
                  <span>{{ row.account }} · {{ row.category }}</span>
                  @if (row.payload.note) {
                    <p>{{ row.payload.note }}</p>
                  }
                  @if (row.failure) {
                    <p role="alert">
                      {{ row.failure }}. El registro se conserva y no se reintenta automáticamente.
                    </p>
                  }
                  @if (movementHead(row.id); as head) {
                    <fp-correction-editor [movement]="head" />
                  }
                </div>
                <span class="pending-badge">{{ status(row.state) }}</span>
              </article>
            } @empty {
              <h2>
                {{
                  workspace.unlocked()
                    ? rangeInvalid()
                      ? 'Revisa el rango de fechas'
                      : movementItems().length
                        ? 'No hay movimientos con estos filtros'
                        : 'Aún no hay movimientos'
                    : 'Abre tu espacio cifrado'
                }}
              </h2>
              <p>
                {{
                  workspace.unlocked()
                    ? movementItems().length
                      ? 'Ajusta o limpia los filtros para volver a ver tu actividad.'
                      : 'Registra tu primer gasto o ingreso. Sin conexión quedará pendiente.'
                    : 'Desbloquea tu perfil para consultar los movimientos guardados en este dispositivo.'
                }}
              </p>
              @if (workspace.unlocked() && movementItems().length) {
                <button fpButton type="button" (click)="clearFilters()">Limpiar filtros</button>
              } @else {
                <a routerLink="/registro">{{
                  workspace.unlocked() ? 'Registrar movimiento' : 'Abrir espacio cifrado'
                }}</a>
              }
            }
          </section>
        } @else if (view() === 'cuentas') {
          @if (workspace.unlocked()) {
            <fp-catalog-creator />
          }
          <section class="manual-card">
            <h2>Tus cuentas</h2>
            <p>
              Catálogo local: {{ workspace.catalog()?.downloadedAt ?? 'sin descargar' }}. Los saldos
              confirmados se consultan en el servidor; esta vista no calcula un saldo local.
            </p>
            @for (account of workspace.catalog()?.accounts ?? []; track account.id) {
              <article class="pending-row">
                <strong>{{ account.name }}</strong
                ><span
                  >{{ account.currency }} ·
                  {{ account.state === 'active' ? 'Activa' : 'Inactiva' }}</span
                >
              </article>
            } @empty {
              <p>Abre tu espacio y descarga el catálogo de tu sesión para ver tus cuentas.</p>
              <a routerLink="/registro">Abrir espacio</a>
            }
          </section>
          @if (workspace.unlocked()) {
            <section class="manual-card" aria-label="Tus categorías">
              <h2>Tus categorías</h2>
              @for (category of workspace.catalog()?.categories ?? []; track category.id) {
                <p>
                  {{ category.name }} · {{ category.kind === 'expense' ? 'Gasto' : 'Ingreso' }} ·
                  {{ category.state === 'active' ? 'Activa' : 'Archivada' }}
                </p>
              } @empty {
                <p>Crea una categoría de gasto o ingreso para empezar.</p>
              }
            </section>
          }
        } @else if (view() === 'configuracion') {
          <section class="manual-card">
            <h2>Tu acceso</h2>
            <a routerLink="/acceso">Administrar sesión</a>
            <button fpButton (click)="workspace.lock()">Bloquear espacio local</button>
            <h2>Vista de prueba separada</h2>
            <p>Abre una vista con datos ficticios. Tu espacio privado quedará bloqueado.</p>
            <button fpButton (click)="workspace.enterDemo()">Abrir modo DEMO</button>
          </section>
        } @else {
          <section class="manual-card">
            <h2>Esta función llegará más adelante</h2>
            <p>
              No mostramos información ficticia dentro del producto. Esta sección se habilitará
              cuando su dominio financiero y persistencia estén implementados.
            </p>
            <a routerLink="/movimientos">Ver movimientos</a>
          </section>
        }
      </section>
    }
  `,
})
export class ProductScreen {
  readonly workspace = inject(ProductWorkspace);
  readonly view = input('inicio');
  readonly query = signal('');
  readonly currencyFilter = signal<ProductMovementFilters['currency']>('ALL');
  readonly kindFilter = signal<ProductMovementFilters['kind']>('all');
  readonly stateFilter = signal<ProductMovementFilters['state']>('all');
  readonly dateFrom = signal('');
  readonly dateTo = signal('');

  readonly title = computed(
    () =>
      ({
        inicio: 'Inicio',
        movimientos: 'Movimientos',
        cuentas: 'Cuentas',
        configuracion: 'Configuración',
        tarjetas: 'Tarjetas',
        presupuestos: 'Presupuestos',
        analisis: 'Análisis',
      })[this.view()] ?? 'Mi espacio',
  );

  readonly movements = computed(() => {
    const items = new Map<
      string,
      {
        id: string;
        payload: ManualPayload;
        state: string;
        failure?: string;
        head?: MovementVersion;
      }
    >();
    const confirmedIds = new Set<string>();
    for (const change of Object.values(this.workspace.snapshot()?.movements ?? {})) {
      confirmedIds.add(change.movement.id);
      const rootId = change.revision?.rootId ?? change.movement.id;
      const version = change.revision?.version ?? '1';
      if (BigInt(items.get(rootId)?.head?.version ?? '0') >= BigInt(version)) continue;
      items.set(rootId, {
        id: rootId,
        payload: change.movement,
        state: 'confirmed',
        head: movementVersion(change),
      });
    }
    for (const row of this.workspace.rows()) {
      if (confirmedIds.has(row.command.movementId)) continue;
      const failure = this.workspace.snapshot()?.failures[row.command.operationId];
      items.set(row.command.movementId, {
        id: row.command.movementId,
        payload: row.command.payload,
        state: row.state,
        ...(failure ? { failure: `Error ${failure.status}: ${failure.code}` } : {}),
      });
    }
    return [...items.values()].sort(
      (a, b) =>
        b.payload.businessDate.localeCompare(a.payload.businessDate) || a.id.localeCompare(b.id),
    );
  });

  readonly movementItems = computed<ProductMovementItem[]>(() =>
    this.movements().map((row) => ({
      id: row.id,
      payload: row.payload,
      state: row.state,
      account: this.accountName(row.payload.accountId),
      category: this.categoryName(row.payload.categoryId),
      ...(row.failure ? { failure: row.failure } : {}),
    })),
  );

  readonly summary = computed(() => summarizeProductMovements(this.movementItems()));

  readonly filteredMovements = computed(() =>
    filterProductMovements(this.movementItems(), {
      query: this.query(),
      currency: this.currencyFilter(),
      kind: this.kindFilter(),
      state: this.stateFilter(),
      from: this.dateFrom(),
      to: this.dateTo(),
    }),
  );

  readonly rangeInvalid = computed(
    () => !!this.dateFrom() && !!this.dateTo() && this.dateFrom() > this.dateTo(),
  );

  clearFilters() {
    this.query.set('');
    this.currencyFilter.set('ALL');
    this.kindFilter.set('all');
    this.stateFilter.set('all');
    this.dateFrom.set('');
    this.dateTo.set('');
  }

  movementHead(id: string) {
    return this.movements().find((row) => row.id === id)?.head;
  }

  status(state: string) {
    return (
      (
        {
          pending: 'Pendiente',
          sending: 'Sincronizando',
          confirmed: 'Confirmado',
          retryable: 'Pendiente de reintento',
          failed: 'No confirmado',
        } as Record<string, string>
      )[state] ?? state
    );
  }

  stateLabel() {
    return (
      {
        idle: 'Al día',
        syncing: 'Sincronizando',
        offline: 'Sin conexión · guardado local',
        session_required: 'Inicia sesión para sincronizar',
        forbidden: 'Sin permiso para sincronizar',
        retryable: 'Conexión interrumpida · se volverá a intentar',
        locked: 'Espacio bloqueado',
        invalid: 'Sincronización detenida: respuesta no válida',
      } as Record<string, string>
    )[this.workspace.state()];
  }

  exact(currency: string, minor: bigint) {
    return formatMinorExact(currency, minor);
  }

  money(payload: ManualPayload) {
    const value = Money.fromJSON(payload).minorUnits.toString();
    return `${payload.currency} ${value.length > 2 ? value.slice(0, -2) : '0'}.${value.slice(-2).padStart(2, '0')}`;
  }

  accountName(id: string) {
    return this.workspace.catalog()?.accounts.find((a) => a.id === id)?.name ?? 'Cuenta';
  }

  categoryName(id: string) {
    return this.workspace.catalog()?.categories.find((c) => c.id === id)?.name ?? 'Categoría';
  }
}
