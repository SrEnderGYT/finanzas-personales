import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProductWorkspace } from './product-workspace';
import { Screen } from './screen';
import { UI_PRIMITIVES } from './primitives';
import { Money, type ManualPayload, type MovementVersion } from '../../domain/src';
import { CorrectionEditor } from './correction-editor';

@Component({
  selector: 'fp-product-screen',
  imports: [RouterLink, Screen, CorrectionEditor, ...UI_PRIMITIVES],
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
            <p>Tu información financiera, separada por moneda.</p>
          </div>
          <a fpButton routerLink="/registro">Registrar movimiento</a>
        </header>
        @if (view() === 'movimientos') {
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
          <section class="manual-card" aria-label="Lista de movimientos">
            @for (row of movements(); track row.id) {
              <article class="pending-row" [attr.data-state]="row.state">
                <div>
                  <strong
                    >{{ row.payload.kind === 'expense' ? 'Gasto' : 'Ingreso' }} ·
                    {{ money(row.payload) }}</strong
                  >
                  <span>{{ row.payload.businessDate }} · {{ row.payload.timezone }}</span>
                  <span
                    >{{ accountName(row.payload.accountId) }} ·
                    {{ categoryName(row.payload.categoryId) }}</span
                  >
                  @if (row.payload.note) {
                    <p>{{ row.payload.note }}</p>
                  }
                  @if (row.failure) {
                    <p role="alert">
                      {{ row.failure }}. El registro se conserva y no se reintenta automáticamente.
                    </p>
                  }
                  @if (row.head) {
                    <fp-correction-editor [movement]="row.head" />
                  }
                </div>
                <span class="pending-badge">{{ status(row.state) }}</span>
              </article>
            } @empty {
              <h2>
                {{ workspace.unlocked() ? 'Aún no hay movimientos' : 'Abre tu espacio cifrado' }}
              </h2>
              <p>
                {{
                  workspace.unlocked()
                    ? 'Registra tu primer gasto o ingreso. Sin conexión quedará pendiente.'
                    : 'Desbloquea tu perfil para consultar los movimientos guardados en este dispositivo.'
                }}
              </p>
              <a routerLink="/registro">{{
                workspace.unlocked() ? 'Registrar movimiento' : 'Abrir espacio cifrado'
              }}</a>
            }
          </section>
        } @else if (view() === 'cuentas') {
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
            <h2>
              {{
                view() === 'inicio'
                  ? 'Empieza con tus movimientos'
                  : 'Esta función llegará más adelante'
              }}
            </h2>
            <p>
              Ya puedes registrar gastos e ingresos y revisar su confirmación. La analítica de
              Inicio estará disponible en una fase posterior.
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
        head: { rootId, version, movementId: change.movement.id, payload: change.movement },
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
