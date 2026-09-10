import { Component, inject, signal, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { AUTH_CLIENT } from './auth-provider';
import { ProductWorkspace } from './product-workspace';
import { UI_PRIMITIVES } from './primitives';
import { ManualSession, DEMO_PROFILE, demoManualCatalog } from '../../shared/src/manual-session';
import { type OutboxRecord } from '../../shared/src/manual-outbox';
import { type LocalProfile } from '../../shared/src/product-vault';
import {
  Money,
  manualAmount,
  normalizeManual,
  validateManualReferences,
  canonical,
  financialDate,
  localDate,
  type ManualCatalog,
  type ManualCommand,
} from '../../domain/src';
@Component({
  selector: 'fp-manual-screen',
  imports: [FormsModule, RouterLink, ...UI_PRIMITIVES],
  styleUrl: './manual-screen.css',
  template: ` <section class="manual-page">
    <header>
      <p class="eyebrow">REGISTRAR MOVIMIENTO</p>
      <h1>Tu movimiento, guardado.</h1>
      <p>Gastos e ingresos con fecha explícita. Primero se guardan en tu espacio cifrado.</p>
    </header>
    <p class="mode-banner">
      {{
        session?.vault?.profile?.mode === 'product'
          ? 'Perfil de producto · confirmación mediante sincronización'
          : 'DEMO · Usa únicamente datos ficticios en esta vista'
      }}
    </p>
    @if (!unlocked()) {
      <div class="manual-card">
        <h2>Abre tu espacio cifrado</h2>
        <p>La clave local protege tus pendientes. No es una contraseña bancaria.</p>
        <div class="profile-actions">
          <button fpButton type="button" [disabled]="busy()" (click)="openDemo()">
            Probar con datos DEMO
          </button>
          @if (auth.enabled) {
            <a routerLink="/acceso">Iniciar sesión</a
            ><button
              fpButton
              type="button"
              [disabled]="busy() || !auth.signedIn"
              (click)="onlineProfile()"
            >
              Preparar perfil conectado
            </button>
          }
        </div>
        @for (profile of profiles; track profile.ownerId + profile.environment) {
          @if (profile.mode === 'product') {
            <button fpButton type="button" [disabled]="busy()" (click)="openProfile(profile)">
              Perfil local {{ profile.ownerId.slice(0, 8) }}
            </button>
          }
        }
        @if (session) {
          <form (ngSubmit)="unlock()">
            <label
              >{{ native ? 'PIN local (6–12 dígitos)' : 'Frase local (mínimo 12 caracteres)'
              }}<input
                fpInput
                name="credential"
                type="password"
                autocomplete="off"
                [(ngModel)]="credential"
                required /></label
            ><button fpButton type="submit" [disabled]="busy()">
              {{ existing() ? 'Desbloquear' : 'Crear espacio cifrado' }}
            </button>
          </form>
        }
      </div>
    } @else {
      <div class="local-toolbar">
        <span>{{
          catalog()?.downloadedAt
            ? 'Catálogo descargado: ' + catalog()?.downloadedAt
            : 'Sin catálogo local'
        }}</span
        ><button fpButton type="button" (click)="lock()">Bloquear</button>
        @if (session?.vault?.profile?.mode === 'product') {
          <button
            fpButton
            type="button"
            [disabled]="busy() || !auth.signedIn"
            (click)="refreshCatalog()"
          >
            Actualizar catálogo
          </button>
        }
      </div>
      <div class="manual-grid">
        <form class="manual-card" (ngSubmit)="save()" novalidate>
          <h2>Registrar movimiento</h2>
          <fieldset>
            <legend>Tipo</legend>
            <div class="kind-switch">
              <button
                type="button"
                [class.selected]="kind === 'expense'"
                (click)="setKind('expense')"
              >
                Gasto</button
              ><button
                type="button"
                [class.selected]="kind === 'income'"
                (click)="setKind('income')"
              >
                Ingreso
              </button>
            </div>
          </fieldset>
          <label
            >Cuenta<select fpSelect name="account" [(ngModel)]="accountId" [disabled]="busy()">
              <option value="">Seleccionar cuenta</option>
              @for (a of activeAccounts(); track a.id) {
                <option [value]="a.id">{{ a.name }} · {{ a.currency }}</option>
              }
            </select></label
          ><small class="field-error">{{ errors()['account'] }}</small>
          <label
            >Categoría<select fpSelect name="category" [(ngModel)]="categoryId" [disabled]="busy()">
              <option value="">Seleccionar categoría</option>
              @for (c of compatibleCategories(); track c.id) {
                <option [value]="c.id">{{ c.name }}</option>
              }
            </select></label
          ><small class="field-error">{{ errors()['category'] }}</small>
          <div class="field-pair">
            <label
              >Importe {{ currency()
              }}<input
                fpInput
                name="amount"
                inputmode="decimal"
                autocomplete="off"
                [(ngModel)]="amount"
                [disabled]="busy()"
                placeholder="0,00" /></label
            ><label
              >Fecha financiera<input
                fpInput
                type="date"
                name="date"
                [(ngModel)]="businessDate"
                [disabled]="busy()"
                required
            /></label>
          </div>
          <small class="field-error">{{ errors()['amount'] }} {{ errors()['date'] }}</small>
          <p class="zone-note">Zona horaria: America/Lima · Se conserva con el movimiento.</p>
          <label
            >Nota opcional<textarea
              fpInput
              name="note"
              maxlength="500"
              rows="3"
              [(ngModel)]="note"
              [disabled]="busy()"
            ></textarea></label
          ><small class="field-error">{{ errors()['note'] }}</small>
          @if (!activeAccounts().length || !compatibleCategories().length) {
            <p>
              No hay cuentas o categorías compatibles en la copia local. Prepara el catálogo
              mediante P07 y vuelve a descargarlo.
            </p>
          }
          <button
            class="save-manual"
            fpButton
            type="submit"
            [disabled]="busy() || !activeAccounts().length || !compatibleCategories().length"
          >
            Guardar pendiente
          </button>
          @if (hasIntent) {
            <button fpButton type="button" [disabled]="busy()" (click)="restoreIntent()">
              Restaurar datos del intento
            </button>
          }
          <p class="zone-note">
            El saldo solo cambia tras la confirmación del servidor. Sin conexión permanece
            pendiente.
          </p>
        </form>
        <section class="manual-card">
          <h2>Pendientes de este dispositivo</h2>
          <p>{{ rows().length }} operación(es) guardada(s)</p>
          @for (row of rows(); track row.command.operationId) {
            <article class="pending-row">
              <div>
                <strong
                  >{{ row.command.payload.kind === 'expense' ? 'Gasto' : 'Ingreso' }} ·
                  {{ displayMoney(row) }}</strong
                ><span
                  >{{ row.command.payload.businessDate }} · {{ row.command.payload.timezone }}</span
                >
                @if (row.command.payload.note) {
                  <p>{{ row.command.payload.note }}</p>
                }
              </div>
              <span class="pending-badge">{{
                row.state === 'pending' ? 'Pendiente local' : row.state
              }}</span>
            </article>
          } @empty {
            <p class="empty-local">
              Aún no tienes pendientes. Tu primer registro aparecerá aquí después del guardado
              cifrado.
            </p>
          }
        </section>
      </div>
    }
    <p class="manual-feedback" role="status" aria-live="polite">{{ message() }}</p>
  </section>`,
})
export class ManualScreen implements OnDestroy {
  readonly auth = inject(AUTH_CLIENT);
  readonly workspace = inject(ProductWorkspace);
  readonly native = Capacitor.isNativePlatform();
  readonly busy = signal(false);
  readonly unlocked = this.workspace.unlocked;
  readonly existing = signal(false);
  readonly catalog = this.workspace.catalog;
  readonly rows = this.workspace.rows;
  readonly message = signal('');
  readonly errors = signal<Record<string, string>>({});
  get session() {
    return this.workspace.session;
  }
  set session(value: ManualSession | undefined) {
    this.workspace.session = value;
  }
  profiles: LocalProfile[] = [];
  credential = '';
  kind: 'expense' | 'income' = 'expense';
  accountId = '';
  categoryId = '';
  amount = '';
  businessDate = localDate(new Date(), 'America/Lima');
  note = '';
  private get generation() {
    return this.workspace.epoch;
  }
  private intent: ManualCommand | undefined;
  private initialCatalog: ManualCatalog | undefined;
  private readonly unsubscribe: () => void;
  private nativeListener: Promise<{ remove: () => Promise<void> }> | undefined;
  private readonly visibility = () => {
    if (document.hidden) this.lock();
  };
  constructor() {
    try {
      this.profiles = ManualSession.profiles();
    } catch {
      this.message.set('No se pudo leer el registro local. No se borraron datos.');
    }
    document.addEventListener('visibilitychange', this.visibility);
    this.unsubscribe = this.auth.onSessionChange(() => this.lock());
    if (this.native)
      this.nativeListener = App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) this.lock();
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
  setKind(kind: 'expense' | 'income') {
    if (this.busy()) return;
    this.kind = kind;
    this.categoryId = '';
  }
  displayMoney(row: OutboxRecord) {
    const m = Money.fromJSON(row.command.payload),
      abs = m.minorUnits.toString();
    return `${m.currency} ${abs.length > 2 ? abs.slice(0, -2) : '0'}.${abs.slice(-2).padStart(2, '0')}`;
  }
  async openDemo() {
    this.workspace.enterDemo();
    await this.openProfile(DEMO_PROFILE, demoManualCatalog());
  }
  async onlineProfile() {
    await this.action(async () => {
      const loaded = await this.auth.manualCatalog();
      await this.openProfile(
        { ownerId: loaded.ownerId, environment: this.auth.catalogEnvironment, mode: 'product' },
        loaded.catalog,
      );
    });
  }
  async openProfile(profile: LocalProfile, catalog?: ManualCatalog) {
    this.lock();
    if (
      profile.mode === 'product' &&
      this.auth.signedIn &&
      !this.auth.canUseOwner(profile.ownerId)
    ) {
      this.message.set('Prepara el perfil conectado de la sesión actual antes de abrirlo.');
      return;
    }
    if (profile.mode === 'product') this.workspace.enterProduct();
    const gen = this.generation;
    await this.action(async () => {
      await this.session?.vault.close();
      const session = await ManualSession.open(profile);
      if (gen !== this.generation) {
        await session.vault.close();
        return;
      }
      this.session = session;
      this.existing.set(await session.vault.exists());
      this.initialCatalog = catalog;
    });
  }
  async unlock() {
    const session = this.session;
    if (!session) return;
    const gen = this.generation;
    await this.action(async () => {
      if (this.existing()) await session.unlock(this.credential);
      else await session.create(this.credential);
      if (gen !== this.generation) {
        session.vault.lock();
        return;
      }
      this.credential = '';
      this.existing.set(true);
      if (this.initialCatalog) {
        await session.saveCatalog(this.initialCatalog);
        this.initialCatalog = undefined;
      }
      const catalog = await session.catalog(),
        rows = await session.outbox.list();
      if (gen !== this.generation) return;
      this.catalog.set(catalog);
      this.rows.set(rows);
      this.unlocked.set(true);
      this.profiles = ManualSession.profiles();
      this.message.set('Espacio desbloqueado. Los pendientes se conservan en este dispositivo.');
      void this.workspace.syncNow();
    });
  }
  async refreshCatalog() {
    const session = this.session;
    if (!session) return;
    const gen = this.generation;
    await this.action(async () => {
      const loaded = await this.auth.manualCatalog();
      if (gen !== this.generation || loaded.ownerId !== session.vault.profile.ownerId)
        throw new Error('Perfil distinto');
      await session.saveCatalog(loaded.catalog);
      if (gen !== this.generation) return;
      this.catalog.set(loaded.catalog);
      this.message.set('Catálogo local actualizado.');
    });
  }
  lock() {
    this.workspace.lock();
    this.unlocked.set(false);
    this.catalog.set(undefined);
    this.rows.set([]);
    this.credential = '';
    this.amount = '';
    this.note = '';
    this.accountId = '';
    this.categoryId = '';
    this.intent = undefined;
    this.errors.set({});
    this.message.set('Espacio bloqueado. Los pendientes cifrados permanecen guardados.');
  }
  async save() {
    if (this.busy() || !this.session || !this.catalog()) return;
    const errors: Record<string, string> = {};
    if (!this.accountId) errors['account'] = 'Elige una cuenta.';
    if (!this.categoryId) errors['category'] = 'Elige una categoría compatible.';
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
    const p = {
      kind: this.kind,
      accountId: this.accountId,
      categoryId: this.categoryId,
      ...money.toJSON(),
      businessDate: this.businessDate,
      timezone: 'America/Lima',
      ...(this.note ? { note: this.note } : {}),
    };
    let candidate: ManualCommand;
    try {
      candidate = normalizeManual(
        {
          operationId: this.intent?.operationId ?? crypto.randomUUID(),
          movementId: this.intent?.movementId ?? crypto.randomUUID(),
          deviceId: this.intent?.deviceId ?? crypto.randomUUID(),
          schemaVersion: 1,
          baseVersion: '0',
          payload: p,
        },
        { now: () => new Date() },
      );
      validateManualReferences(candidate, this.catalog()!);
    } catch {
      this.message.set('Revisa la cuenta y categoría compatibles y los datos del movimiento.');
      return;
    }
    if (this.intent && canonical(this.intent.payload) !== canonical(candidate.payload)) {
      this.message.set(
        'Restaura los datos del intento anterior antes de reintentar; conservamos su identificador.',
      );
      return;
    }
    this.intent = candidate;
    const session = this.session,
      catalog = this.catalog()!,
      gen = this.generation,
      command = this.intent;
    await this.action(async () => {
      await session.outbox.enqueue(command, catalog);
      const rows = await session.outbox.list();
      if (gen !== this.generation) return;
      this.rows.set(rows);
      this.intent = undefined;
      this.amount = '';
      this.note = '';
      this.message.set('Guardado en este dispositivo. Pendiente de envío.');
      void this.workspace.syncNow();
    });
  }
  get hasIntent() {
    return !!this.intent;
  }
  restoreIntent() {
    if (!this.intent) return;
    const p = this.intent.payload;
    this.kind = p.kind;
    this.accountId = p.accountId;
    this.categoryId = p.categoryId;
    this.businessDate = p.businessDate;
    this.note = p.note ?? '';
    const n = p.amountMinor;
    this.amount = (n.length > 2 ? n.slice(0, -2) : '0') + '.' + n.slice(-2).padStart(2, '0');
  }
  private async action(work: () => Promise<void>) {
    this.busy.set(true);
    try {
      await work();
    } catch {
      this.message.set(
        'No se completó la operación. Revisa los datos o desbloquea de nuevo; no se borraron pendientes.',
      );
    } finally {
      this.busy.set(false);
    }
  }
  ngOnDestroy() {
    if (this.session?.vault.profile.mode !== 'product') this.lock();
    this.credential = '';
    this.intent = undefined;
    this.unsubscribe();
    document.removeEventListener('visibilitychange', this.visibility);
    void this.nativeListener?.then((l) => l.remove());
    if (this.session?.vault.profile.mode !== 'product') void this.session?.vault.close();
  }
}
