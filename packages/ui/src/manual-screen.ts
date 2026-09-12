import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AUTH_CLIENT } from './auth-provider';
import { ProductWorkspace } from './product-workspace';
import { UI_PRIMITIVES } from './primitives';
import {
  Money,
  financialDate,
  localDate,
  manualAmount,
  normalizeManual,
  validateManualReferences,
  type CatalogEnvelope,
  type ManualCatalog,
} from '../../domain/src';

@Component({
  selector: 'fp-manual-screen',
  imports: [FormsModule, RouterLink, ...UI_PRIMITIVES],
  styleUrl: './manual-screen.css',
  template: `
    <section class="manual-page">
      <header class="page-heading">
        <div>
          <p class="eyebrow">REGISTRAR MOVIMIENTO</p>
          <h1>Registrar movimiento</h1>
          <p>
            Agrega un gasto o ingreso directamente a tu cuenta. No necesitas desbloquear otra
            bóveda.
          </p>
        </div>
        <a routerLink="/movimientos">Volver a movimientos</a>
      </header>

      @if (busy() && !catalog()) {
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
            Guardar movimiento
          </button>
          <p class="zone-note">
            Se registra en tu cuenta autenticada y aparece en Movimientos al confirmarse el
            servidor.
          </p>
        </form>
      }
      <p class="manual-feedback" role="status" aria-live="polite">{{ message() }}</p>
    </section>
  `,
})
export class ManualScreen implements OnInit {
  readonly auth = inject(AUTH_CLIENT);
  readonly workspace = inject(ProductWorkspace);
  readonly catalog = signal<ManualCatalog | undefined>(undefined);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly errors = signal<Record<string, string>>({});
  ownerId = '';
  kind: 'expense' | 'income' = 'expense';
  accountId = '';
  categoryId = '';
  amount = '';
  businessDate = localDate(new Date(), 'America/Lima');
  note = '';

  ngOnInit() {
    void this.load();
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

  setKind(kind: 'expense' | 'income') {
    if (this.busy()) return;
    this.kind = kind;
    this.categoryId = '';
  }

  private envelope(command: CatalogEnvelope['command']): CatalogEnvelope {
    return {
      operationId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      schemaVersion: 1,
      baseVersion: '0',
      command,
    };
  }

  private async ensureDefaults(loaded: { ownerId: string; catalog: ManualCatalog }) {
    const signal = AbortSignal.timeout(15000);
    if (!loaded.catalog.accounts.length) {
      await this.auth.createCatalog(
        loaded.ownerId,
        this.envelope({
          type: 'account.create',
          id: crypto.randomUUID(),
          payload: {
            name: 'Principal PEN',
            type: 'other',
            currency: 'PEN',
            state: 'active',
            position: 0,
          },
        }),
        signal,
      );
      await this.auth.createCatalog(
        loaded.ownerId,
        this.envelope({
          type: 'account.create',
          id: crypto.randomUUID(),
          payload: {
            name: 'Principal USD',
            type: 'other',
            currency: 'USD',
            state: 'active',
            position: 1,
          },
        }),
        signal,
      );
    }
    if (!loaded.catalog.categories.length) {
      const defaults = [
        ['Alimentación', 'expense'],
        ['Transporte', 'expense'],
        ['Servicios', 'expense'],
        ['Compras', 'expense'],
        ['Otros gastos', 'expense'],
        ['Ingresos', 'income'],
      ] as const;
      for (const [name, kind] of defaults)
        await this.auth.createCatalog(
          loaded.ownerId,
          this.envelope({
            type: 'category.create',
            id: crypto.randomUUID(),
            payload: {
              name,
              kind,
              state: 'active',
              position: defaults.findIndex((x) => x[0] === name),
            },
          }),
          signal,
        );
    }
  }

  async load() {
    if (!this.auth.signedIn || this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    try {
      let loaded = await this.auth.manualCatalog();
      if (!loaded.catalog.accounts.length || !loaded.catalog.categories.length) {
        await this.ensureDefaults(loaded);
        loaded = await this.auth.manualCatalog();
      }
      this.ownerId = loaded.ownerId;
      this.catalog.set(loaded.catalog);
      this.workspace.catalog.set(loaded.catalog);
      this.workspace.remoteOwner.set(loaded.ownerId);
      this.workspace.unlocked.set(true);
      if (!this.accountId) this.accountId = this.activeAccounts()[0]?.id ?? '';
      this.message.set('Cuentas y categorías listas.');
    } catch {
      this.message.set('No pudimos cargar tus cuentas y categorías. Reintenta en unos segundos.');
    } finally {
      this.busy.set(false);
    }
  }

  async save() {
    const catalog = this.catalog();
    if (this.busy() || !catalog || !this.ownerId) return;
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
          operationId: crypto.randomUUID(),
          movementId: crypto.randomUUID(),
          deviceId: crypto.randomUUID(),
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
      this.busy.set(true);
      await this.auth.syncApi(this.ownerId).send(command, AbortSignal.timeout(15000));
      this.amount = '';
      this.note = '';
      this.message.set('Movimiento guardado y confirmado.');
      await this.workspace.openRemote();
    } catch {
      this.message.set(
        'No pudimos guardar el movimiento. Revisa los datos o tu conexión e inténtalo nuevamente.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
