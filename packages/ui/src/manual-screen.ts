import { Component, inject, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AUTH_CLIENT } from './auth-provider';
import { ProductWorkspace } from './product-workspace';
import { UI_PRIMITIVES } from './primitives';
import { DeviceAccess } from './device-access';
import {
  Money,
  financialDate,
  localDate,
  manualAmount,
  normalizeManual,
  validateManualReferences,
  canonical,
  type ManualCommand,
} from '../../domain/src';

@Component({
  selector: 'fp-manual-screen',
  imports: [FormsModule, RouterLink, DeviceAccess, ...UI_PRIMITIVES],
  styleUrl: './manual-screen.css',
  template: `
    <section class="manual-page">
      <header class="page-heading">
        <div>
          <p class="eyebrow">REGISTRAR MOVIMIENTO</p>
          <h1>Registrar movimiento</h1>
          <p>
            Registra un gasto o ingreso. Se conserva cifrado antes de enviarlo y solo se confirma
            cuando el servidor devuelve su recibo.
          </p>
        </div>
        <a routerLink="/movimientos">Volver a movimientos</a>
      </header>

      @if (!workspace.localReady()) {
        <fp-device-access />
      } @else if (busy() && !catalog()) {
        <section class="manual-card product-empty-state" role="status">
          <h2>Preparando tus cuentas y categorías…</h2>
          <p>Usamos tu sesión activa para cargar el catálogo financiero.</p>
        </section>
      } @else {
        <form class="manual-card" (ngSubmit)="save()" novalidate>
          <h2>Nuevo movimiento</h2>
          <fieldset>
            <legend>Tipo</legend>
            <div class="kind-switch">
              <button
                type="button"
                [class.selected]="kind === 'expense'"
                (click)="setKind('expense')"
              >
                Gasto
              </button>
              <button
                type="button"
                [class.selected]="kind === 'income'"
                (click)="setKind('income')"
              >
                Ingreso
              </button>
            </div>
          </fieldset>

          <label
            >Cuenta
            <select fpSelect name="account" [(ngModel)]="accountId" [disabled]="busy()">
              <option value="">Seleccionar cuenta</option>
              @for (a of activeAccounts(); track a.id) {
                <option [value]="a.id">{{ a.name }} · {{ a.currency }}</option>
              }
            </select>
          </label>
          <small class="field-error">{{ errors()['account'] }}</small>

          <label
            >Categoría
            <select fpSelect name="category" [(ngModel)]="categoryId" [disabled]="busy()">
              <option value="">Seleccionar categoría</option>
              @for (c of compatibleCategories(); track c.id) {
                <option [value]="c.id">{{ c.name }}</option>
              }
            </select>
          </label>
          <small class="field-error">{{ errors()['category'] }}</small>

          <div class="field-pair">
            <label
              >Importe {{ currency() }}
              <input
                fpInput
                name="amount"
                inputmode="decimal"
                autocomplete="off"
                [(ngModel)]="amount"
                [disabled]="busy()"
                placeholder="0,00"
              />
            </label>
            <label
              >Fecha financiera
              <input
                fpInput
                type="date"
                name="date"
                [(ngModel)]="businessDate"
                [disabled]="busy()"
                required
              />
            </label>
          </div>
          <small class="field-error">{{ errors()['amount'] }} {{ errors()['date'] }}</small>

          <label
            >Nota opcional
            <textarea
              fpInput
              name="note"
              maxlength="500"
              rows="3"
              [(ngModel)]="note"
              [disabled]="busy()"
            ></textarea>
          </label>
          <small class="field-error">{{ errors()['note'] }}</small>

          @if (!activeAccounts().length || !compatibleCategories().length) {
            <p>
              No encontramos un catálogo utilizable.
              <a routerLink="/cuentas">Administrar cuentas y categorías</a>
            </p>
          }

          <button
            fpButton
            type="submit"
            [disabled]="busy() || !activeAccounts().length || !compatibleCategories().length"
          >
            Guardar pendiente
          </button>
          <p class="zone-note">
            Fecha financiera obligatoria · America/Lima. Sin conexión permanece pendiente en este
            dispositivo; los pendientes no alteran los saldos confirmados.
          </p>
        </form>
      }
      <p class="manual-feedback" role="status" aria-live="polite">{{ message() }}</p>
      @if (workspace.localReady()) {
        <section class="manual-card" aria-label="Registros guardados en este dispositivo">
          @for (row of workspace.rows(); track row.command.operationId) {
            <article class="pending-row">
              <strong>{{ row.command.payload.kind === 'expense' ? 'Gasto' : 'Ingreso' }}</strong>
              <span>{{ displayMoney(row.command) }}</span>
              <span
                >{{ row.command.payload.businessDate }} · {{ row.command.payload.timezone }}</span
              >
              <span>{{
                row.state === 'confirmed' ? 'Confirmado' : 'Pendiente de confirmación'
              }}</span>
            </article>
          }
        </section>
      }
    </section>
  `,
})
export class ManualScreen {
  readonly auth = inject(AUTH_CLIENT);
  readonly workspace = inject(ProductWorkspace);
  readonly catalog = this.workspace.catalog;
  readonly busy = signal(false);
  readonly message = signal('');
  readonly errors = signal<Record<string, string>>({});
  private intent: ManualCommand | undefined;
  kind: 'expense' | 'income' = 'expense';
  accountId = '';
  categoryId = '';
  amount = '';
  businessDate = localDate(new Date(), 'America/Lima');
  note = '';

  constructor() {
    effect(() => {
      if (!this.workspace.localReady()) {
        this.intent = undefined;
        this.amount = '';
        this.note = '';
        this.accountId = '';
        this.categoryId = '';
        this.errors.set({});
        this.message.set('');
      }
    });
  }

  activeAccounts() {
    return this.catalog()?.accounts.filter((a) => a.state === 'active') ?? [];
  }

  compatibleCategories() {
    return (
      this.catalog()?.categories.filter((c) => c.state === 'active' && c.kind === this.kind) ?? []
    );
  }

  currency() {
    return this.activeAccounts().find((a) => a.id === this.accountId)?.currency ?? 'PEN';
  }
  displayMoney(command: ManualCommand) {
    const n = command.payload.amountMinor;
    return `${command.payload.currency} ${n.length > 2 ? n.slice(0, -2) : '0'}.${n.slice(-2).padStart(2, '0')}`;
  }

  setKind(kind: 'expense' | 'income') {
    if (this.busy()) return;
    this.kind = kind;
    this.categoryId = '';
  }

  async save() {
    const catalog = this.catalog();
    const session = this.workspace.session,
      epoch = this.workspace.epoch;
    if (this.busy() || !catalog || !session || !this.workspace.localReady()) return;
    const errors: Record<string, string> = {};
    if (!this.accountId) errors['account'] = 'Elige una cuenta.';
    if (!this.categoryId) errors['category'] = 'Elige una categoría.';
    let money: Money | undefined;
    try {
      money = manualAmount(this.amount, this.currency());
    } catch {
      errors['amount'] = 'Introduce un importe positivo con hasta dos decimales.';
    }
    try {
      financialDate(
        { businessDate: this.businessDate, timezone: 'America/Lima' },
        { now: () => new Date() },
      );
    } catch {
      errors['date'] = 'Introduce una fecha válida, no futura.';
    }
    if ([...this.note].length > 500 || /[\p{Cc}\p{Cf}]/u.test(this.note))
      errors['note'] = 'La nota no puede superar 500 caracteres ni contener controles.';
    this.errors.set(errors);
    if (Object.keys(errors).length || !money) return;

    try {
      const command = normalizeManual(
        {
          operationId: this.intent?.operationId ?? crypto.randomUUID(),
          movementId: this.intent?.movementId ?? crypto.randomUUID(),
          deviceId: this.intent?.deviceId ?? crypto.randomUUID(),
          schemaVersion: 1,
          baseVersion: '0',
          payload: {
            kind: this.kind,
            accountId: this.accountId,
            categoryId: this.categoryId,
            ...money.toJSON(),
            businessDate: this.businessDate,
            timezone: 'America/Lima',
            ...(this.note.trim() ? { note: this.note.trim() } : {}),
          },
        },
        { now: () => new Date() },
      );
      validateManualReferences(command, catalog);
      if (this.intent && canonical(this.intent) !== canonical(command)) {
        this.message.set(
          'Conserva los datos del intento anterior al reintentar. Su identificador no cambia.',
        );
        return;
      }
      this.intent = command;
      this.busy.set(true);
      await session.outbox.enqueue(command, catalog);
      if (epoch !== this.workspace.epoch) return;
      this.intent = undefined;
      this.amount = '';
      this.note = '';
      this.message.set('Guardado en este dispositivo. Pendiente de envío.');
      await this.workspace.refresh();
      if (epoch === this.workspace.epoch) void this.workspace.syncNow();
    } catch {
      if (epoch === this.workspace.epoch)
        this.message.set(
          'No pudimos comprobar el guardado local. Conserva los datos y reintenta; no se enviará un duplicado.',
        );
    } finally {
      this.busy.set(false);
    }
  }
}
