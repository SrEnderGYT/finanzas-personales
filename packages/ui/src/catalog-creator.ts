import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { normalizeCatalog, type CatalogEnvelope } from '../../domain/src';
import { CatalogCreation } from '../../shared/src/catalog-creation';
import { ProductWorkspace } from './product-workspace';
import { UI_PRIMITIVES } from './primitives';

@Component({
  selector: 'fp-catalog-creator',
  imports: [FormsModule, ...UI_PRIMITIVES],
  styleUrl: './manual-screen.css',
  template: `
    <section class="manual-card" aria-label="Crear cuenta o categoría">
      <h2>Preparar tus cuentas y categorías</h2>
      <p>Requiere conexión y una sesión vigente. Las cuentas se crean sin saldo inicial.</p>
      @if (intent()) {
        <p>
          Alta por comprobar: {{ pendingName() }}. Conservamos el mismo identificador al reintentar.
        </p>
        <button fpButton (click)="send()" [disabled]="busy()">Comprobar alta pendiente</button>
      } @else {
        <form (ngSubmit)="create()" aria-label="Nueva cuenta o categoría">
          <fieldset [disabled]="busy() || !ready()">
            <label
              >Crear
              <select name="catalog-entity" [(ngModel)]="entity">
                <option value="account">Cuenta</option>
                <option value="category">Categoría</option>
              </select>
            </label>
            <label
              >Nombre<input fpInput name="catalog-name" [(ngModel)]="name" maxlength="80" required
            /></label>
            @if (entity === 'account') {
              <label
                >Tipo de cuenta<select name="catalog-type" [(ngModel)]="accountType">
                  <option value="savings">Ahorros</option>
                  <option value="current">Corriente</option>
                  <option value="cash">Efectivo</option>
                  <option value="wallet">Billetera</option>
                  <option value="investment">Inversión</option>
                  <option value="other">Otro</option>
                </select></label
              >
              <label
                >Moneda<select name="catalog-currency" [(ngModel)]="currency">
                  <option value="PEN">PEN · Soles</option>
                  <option value="USD">USD · Dólares</option>
                </select></label
              >
            } @else {
              <label
                >Uso de categoría<select name="catalog-kind" [(ngModel)]="kind">
                  <option value="expense">Gasto</option>
                  <option value="income">Ingreso</option>
                </select></label
              >
            }
            <button fpButton type="submit">
              Crear {{ entity === 'account' ? 'cuenta' : 'categoría' }}
            </button>
          </fieldset>
        </form>
      }
      <p role="status">{{ message() }}</p>
    </section>
  `,
})
export class CatalogCreator implements OnInit {
  readonly workspace = inject(ProductWorkspace);
  readonly busy = signal(false);
  readonly ready = signal(false);
  readonly intent = signal<CatalogEnvelope | undefined>(undefined);
  readonly message = signal('');
  entity = 'account';
  name = '';
  accountType = 'cash';
  currency = 'PEN';
  kind = 'expense';
  async ngOnInit() {
    const epoch = this.workspace.epoch;
    try {
      const session = this.workspace.session;
      if (!session?.vault.unlocked) return;
      const row = await new CatalogCreation(session.vault).read();
      if (epoch !== this.workspace.epoch) return;
      if (row && !row.value.completed) this.intent.set(row.value.command);
      this.ready.set(true);
    } catch {
      this.message.set('No se pudo leer el alta cifrada. Se conserva el almacenamiento existente.');
    }
  }
  pendingName() {
    const command = this.intent()?.command;
    return command && 'payload' in command ? command.payload.name : '';
  }
  async create() {
    if (this.busy() || !this.ready()) return;
    try {
      this.intent.set(
        normalizeCatalog({
          operationId: crypto.randomUUID(),
          deviceId: crypto.randomUUID(),
          schemaVersion: 1,
          baseVersion: '0',
          command: {
            type: this.entity === 'account' ? 'account.create' : 'category.create',
            id: crypto.randomUUID(),
            payload: {
              name: this.name,
              state: 'active',
              position: 0,
              ...(this.entity === 'account'
                ? { type: this.accountType, currency: this.currency }
                : { kind: this.kind }),
            },
          },
        }),
      );
      await this.send();
    } catch {
      this.message.set(
        'Revisa el nombre, tipo y moneda. El nombre admite hasta 80 caracteres sin controles.',
      );
    }
  }
  async send() {
    const session = this.workspace.session,
      command = this.intent(),
      epoch = this.workspace.epoch;
    if (this.busy() || !session?.vault.unlocked || !command) return;
    this.busy.set(true);
    this.message.set('');
    try {
      const queue = new CatalogCreation(session.vault);
      await queue.prepare(command);
      if (epoch !== this.workspace.epoch || !session.vault.unlocked) return;
      if (!navigator.onLine) throw new Error('OFFLINE');
      await this.workspace.auth.createCatalog(
        session.vault.profile.ownerId,
        command,
        AbortSignal.timeout(15000),
      );
      const loaded = await this.workspace.auth.manualCatalog();
      if (epoch !== this.workspace.epoch || loaded.ownerId !== session.vault.profile.ownerId)
        return;
      await session.saveCatalog(loaded.catalog);
      await queue.complete(command);
      if (epoch !== this.workspace.epoch) return;
      this.workspace.catalog.set(loaded.catalog);
      this.intent.set(undefined);
      this.name = '';
      this.message.set('Alta confirmada. El catálogo cifrado está actualizado.');
    } catch {
      if (epoch === this.workspace.epoch)
        this.message.set(
          'No se pudo comprobar el alta. Conservamos la propuesta para reintentar con conexión y sesión vigente.',
        );
    } finally {
      this.busy.set(false);
    }
  }
}
