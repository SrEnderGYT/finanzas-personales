from pathlib import Path
import re


def replace(path: str, old: str, new: str, count: int = 1):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing patch anchor: {path}: {old[:80]!r}')
    text2 = text.replace(old, new, count)
    p.write_text(text2)

# 1) Gmail: a monetary amount inside marketing copy is never enough to create a candidate.
replace(
    'backend/api/src/financial-mail-parser.ts',
    "const marketingOffer =\n  /\\b(precalifica|precalificaci[oó]n|cr[eé]dito preaprobado|pr[eé]stamo preaprobado|pr[eé]stamo para ti|solicita tu pr[eé]stamo|obt[eé]n tu pr[eé]stamo|100% digital|preventa activa|te extrañamos|hace tiempo no nos visitas|aprovecha esta oferta|oferta exclusiva|promoci[oó]n exclusiva)\\b/i;",
    "const marketingOffer =\n  /\\b(precalifica|precalificaci[oó]n|cr[eé]dito preaprobado|pr[eé]stamo preaprobado|pr[eé]stamo para ti|solicita tu pr[eé]stamo|obt[eé]n tu pr[eé]stamo|100% digital|preventa activa|te extrañamos|hace tiempo no nos visitas|aprovecha esta oferta|oferta exclusiva|promoci[oó]n exclusiva|gana(?:r)?|puntos?|millas?|participa|sorteo|premio|descuentos?|beneficio(?:s)?|ll[eé]vate|regalo con tu compra|pr[oó]xima compra|compra favorita|escoge tu premio|cambia[^\\n]{0,80}y gana|pasajes?[^\\n]{0,80}desde|desde\\s+(?:s\\/?\\.?|us\\$|usd)|hasta\\s+[0-9.,]+\\s+(?:puntos?|millas?))\\b/i;",
)

# Reclassification must also remove a previous pending candidate for the same Gmail message.
replace(
    'backend/api/src/gmail-service.ts',
    "    const candidate = parseFinancialMail(input);\n    if (!candidate) return;",
    "    const candidate = parseFinancialMail(input);\n    if (!candidate) {\n      await this.pool.query(\n        `DELETE FROM app.gmail_financial_candidates\n         WHERE user_id=$1 AND source_message_id=$2 AND status='pending'`,\n        [userId, input.messageId],\n      );\n      return;\n    }",
)

# Exact regressions from the user's screenshots.
tests = Path('tests/gmail-ingestion.test.ts')
t = tests.read_text()
anchor = "  it('keeps billed services with an amount without treating bank receipts as expenses', () => {"
insert = r'''  it('ignores promotional amounts, prizes, miles, discounts and teaser prices', () => {
    const promotional = [
      ['¡Gana hasta 3,000 Puntos BBVA!', 'Compra hoy y participa por S/ 50.00 en beneficios.', 'BBVA <beneficios@bbva.pe>'],
      ['Tu próxima compra para la casa está aquí', 'Encuentra productos desde S/ 406.00.', 'Tienda <promo@tienda.pe>'],
      ['German, llévate 1 camioneta o S/5,000 en efectivo', 'Participa en nuestro sorteo.', 'Interbank <beneficios@interbank.pe>'],
      ['German, participa por 1 Millón de Millas', 'Compra y participa. Premio referencial S/ 100.00.', 'BCP <beneficios@bcp.com.pe>'],
      ['¡Descuentos por todos lados!', 'Beneficios de hasta S/ 1,000.', 'Banco Ripley <promo@ripley.com.pe>'],
      ['Recibe un regalo con tu compra en tienda', 'Compra desde S/ 2,026.00 y participa.', 'Tienda <promo@tienda.pe>'],
      ['German, escoge tu premio: S/80 Cashback o sorteo S/2,000', 'Elige tu premio.', 'BCP <beneficios@bcp.com.pe>'],
      ['Cambia $150 y gana', 'Participa por premios cambiando US$ 150.00.', 'Interbank <beneficios@interbank.pe>'],
      ['Pasajes nacionales desde USD 35', 'Oferta válida por tiempo limitado.', 'Aerolínea <promo@example.com>'],
    ] as const;
    for (const [subject, snippet, sender] of promotional)
      expect(mail(subject, snippet, sender)).toBeUndefined();
  });

  it('classifies a card-payment receipt as payment, never as income', () => {
    expect(
      mail(
        'Constancia de Pago de Tarjeta de Crédito Propia - Servicio de Notificaciones BCP',
        'Tu pago de tarjeta por S/ 100.00 fue procesado correctamente.',
      ),
    ).toMatchObject({ kind: 'payment', institution: 'BCP', currency: 'PEN', amountMinor: 10000 });
  });

'''
if anchor not in t:
    raise SystemExit('gmail test anchor missing')
tests.write_text(t.replace(anchor, insert + anchor, 1))

# 2) Cards: the card/bank catalog is historical; only the activity list follows the month filter.
p = Path('packages/ui/src/detected-finances-screen.ts')
s = p.read_text()
s = s.replace(
    "      if (!allowed.has(candidate.kind) || !candidate.amountMinor || !candidate.currency)\n        return false;",
    "      if (\n        candidate.status === 'discarded' ||\n        !allowed.has(candidate.kind) ||\n        !candidate.amountMinor ||\n        !candidate.currency\n      )\n        return false;",
    1,
)
s = s.replace(
    "  readonly institutionOptions = computed(() =>\n    [\n      ...new Set(this.periodRows().flatMap((item) => (item.institution ? [item.institution] : []))),\n    ].sort((a, b) => a.localeCompare(b)),\n  );",
    "  readonly allCardRows = computed(() =>\n    this.candidates().filter(\n      (item) =>\n        item.status !== 'discarded' &&\n        !!item.institution &&\n        ['card_charge', 'card_statement', 'payment'].includes(item.kind),\n    ),\n  );\n\n  readonly institutionOptions = computed(() =>\n    [...new Set(this.allCardRows().map((item) => item.institution!))].sort((a, b) =>\n      a.localeCompare(b),\n    ),\n  );",
    1,
)
old_institutions = r'''  readonly institutions = computed(() => {
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
  });'''
new_institutions = r'''  readonly institutions = computed(() => {
    const grouped = new Map<string, { events: number; pending: number }>();
    for (const item of this.allCardRows()) {
      if (!item.institution) continue;
      const current = grouped.get(item.institution) ?? { events: 0, pending: 0 };
      current.events++;
      if (item.status === 'pending') current.pending++;
      grouped.set(item.institution, current);
    }
    return [...grouped.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));
  });'''
if old_institutions not in s:
    raise SystemExit('institution block missing')
p.write_text(s.replace(old_institutions, new_institutions, 1))

# 3) Authenticated product becomes server-first. Local vault remains optional/offline only.
p = Path('packages/ui/src/product-workspace.ts')
s = p.read_text()
s = s.replace(
    "import { CorrectionQueue, type CorrectionRecord } from '../../shared/src/correction-queue';",
    "import { CorrectionQueue, type CorrectionRecord } from '../../shared/src/correction-queue';\nimport {\n  normalizeGmailCandidates,\n  type GmailFinancialCandidate,\n} from '../../shared/src/gmail-candidates';",
    1,
)
s = s.replace(
    "  readonly correcting = signal(false);",
    "  readonly correcting = signal(false);\n  readonly gmailConfirmed = signal<GmailFinancialCandidate[]>([]);\n  readonly remoteOwner = signal('');\n  readonly remoteLoading = signal(false);",
    1,
)
s = s.replace(
    "    this.auth.onSessionChange(() => {\n      this.lock();\n      this.product.set(this.auth.enabled || this.auth.signedIn);\n    });",
    "    this.auth.onSessionChange(() => {\n      this.lock();\n      this.product.set(this.auth.enabled || this.auth.signedIn);\n      if (this.auth.signedIn) void this.openRemote();\n    });",
    1,
)
s = s.replace(
    "    document.addEventListener('visibilitychange', () => {\n      if (document.hidden) this.lock();\n    });",
    "    document.addEventListener('visibilitychange', () => {\n      if (document.hidden && this.session?.vault.unlocked) this.lock();\n    });",
    1,
)
s = s.replace(
    "    if (Capacitor.isNativePlatform())\n      void App.addListener('appStateChange', ({ isActive }) => {\n        if (!isActive) this.lock();\n        else if (!['forbidden', 'invalid'].includes(this.state())) void this.syncNow();\n      });",
    "    if (Capacitor.isNativePlatform())\n      void App.addListener('appStateChange', ({ isActive }) => {\n        if (!isActive && this.session?.vault.unlocked) this.lock();\n        else if (isActive && !['forbidden', 'invalid'].includes(this.state())) void this.syncNow();\n      });\n    if (this.auth.signedIn) void this.openRemote();",
    1,
)
s = s.replace(
    "    this.corrections.set([]);\n    this.state.set('locked');",
    "    this.corrections.set([]);\n    this.gmailConfirmed.set([]);\n    this.remoteOwner.set('');\n    this.state.set('locked');",
    1,
)
remote_method = r'''  async openRemote() {
    if (!this.auth.signedIn || this.remoteLoading()) return;
    this.remoteLoading.set(true);
    this.state.set('syncing');
    this.error.set('');
    const epoch = this.epoch;
    try {
      const loaded = await this.auth.manualCatalog();
      if (epoch !== this.epoch) return;
      const api = this.auth.syncApi(loaded.ownerId);
      const snapshot: SyncSnapshot = { version: 1, movements: {}, retries: {}, failures: {} };
      let cursor: string | undefined;
      let generation: string | undefined;
      for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
        const page = await api.pull(cursor, AbortSignal.timeout(15000));
        if (epoch !== this.epoch) return;
        if (generation && generation !== page.cursorGeneration)
          throw new Error('La historia financiera cambió durante la descarga.');
        generation = page.cursorGeneration;
        for (const change of page.changes) snapshot.movements[change.movement.id] = change;
        cursor = page.nextCursor;
        snapshot.cursor = page.nextCursor;
        snapshot.generation = page.cursorGeneration;
        if (!page.hasMore) break;
        if (pageNumber === 99) throw new Error('La historia financiera es demasiado extensa.');
      }
      snapshot.lastSync = new Date().toISOString();
      let gmail: GmailFinancialCandidate[] = [];
      try {
        gmail = normalizeGmailCandidates(await this.auth.gmail('candidates?status=confirmed', 'GET'));
      } catch {
        // Gmail is optional; ledger/manual movements must continue loading without it.
      }
      if (epoch !== this.epoch) return;
      this.remoteOwner.set(loaded.ownerId);
      this.catalog.set(loaded.catalog);
      this.snapshot.set(snapshot);
      this.rows.set([]);
      this.gmailConfirmed.set(gmail);
      this.unlocked.set(true);
      this.state.set('idle');
    } catch {
      if (epoch === this.epoch) {
        this.unlocked.set(false);
        this.state.set('invalid');
        this.error.set('No pudimos cargar tus finanzas desde el servidor. Reintenta en unos segundos.');
      }
    } finally {
      this.remoteLoading.set(false);
    }
  }

'''
marker = "  async refresh() {"
if marker not in s:
    raise SystemExit('workspace refresh anchor missing')
s = s.replace(marker, remote_method + marker, 1)
s = s.replace(
    "  async syncNow() {\n    const session = this.session;\n    if (!session?.vault.unlocked || session.vault.profile.mode !== 'product') return;",
    "  async syncNow() {\n    const session = this.session;\n    if (!session?.vault.unlocked || session.vault.profile.mode !== 'product') {\n      if (this.auth.signedIn) await this.openRemote();\n      return;\n    }",
    1,
)
p.write_text(s)

# Always render the real product after authentication; ProductWorkspace handles loading state.
Path('packages/ui/src/latest-screen.ts').write_text(r'''import { Component, inject, input } from '@angular/core';
import { ProductWorkspace } from './product-workspace';
import { ProductScreen } from './product-screen';

@Component({
  selector: 'fp-latest-screen',
  imports: [ProductScreen],
  template: `<fp-product-screen [view]="view()" />`,
})
export class LatestScreen {
  readonly workspace = inject(ProductWorkspace);
  readonly view = input('inicio');

  constructor() {
    this.workspace.enterProduct();
    if (this.workspace.auth.signedIn) void this.workspace.openRemote();
  }
}
''')

# 4) Manual movement: online session writes directly to the server. No second passphrase.
Path('packages/ui/src/manual-screen.ts').write_text(r'''import { Component, inject, OnInit, signal } from '@angular/core';
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
          <p>Agrega un gasto o ingreso directamente a tu cuenta. No necesitas desbloquear otra bóveda.</p>
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
              <button type="button" [class.selected]="kind === 'expense'" (click)="setKind('expense')">Gasto</button>
              <button type="button" [class.selected]="kind === 'income'" (click)="setKind('income')">Ingreso</button>
            </div>
          </fieldset>

          <label>Cuenta
            <select fpSelect name="account" [(ngModel)]="accountId" [disabled]="busy()">
              <option value="">Seleccionar cuenta</option>
              @for (a of activeAccounts(); track a.id) {
                <option [value]="a.id">{{ a.name }} · {{ a.currency }}</option>
              }
            </select>
          </label>
          <small class="field-error">{{ errors()['account'] }}</small>

          <label>Categoría
            <select fpSelect name="category" [(ngModel)]="categoryId" [disabled]="busy()">
              <option value="">Seleccionar categoría</option>
              @for (c of compatibleCategories(); track c.id) {
                <option [value]="c.id">{{ c.name }}</option>
              }
            </select>
          </label>
          <small class="field-error">{{ errors()['category'] }}</small>

          <div class="field-pair">
            <label>Importe {{ currency() }}
              <input fpInput name="amount" inputmode="decimal" autocomplete="off" [(ngModel)]="amount" [disabled]="busy()" placeholder="0,00" />
            </label>
            <label>Fecha financiera
              <input fpInput type="date" name="date" [(ngModel)]="businessDate" [disabled]="busy()" required />
            </label>
          </div>
          <small class="field-error">{{ errors()['amount'] }} {{ errors()['date'] }}</small>

          <label>Nota opcional
            <textarea fpInput name="note" maxlength="500" rows="3" [(ngModel)]="note" [disabled]="busy()"></textarea>
          </label>
          <small class="field-error">{{ errors()['note'] }}</small>

          @if (!activeAccounts().length || !compatibleCategories().length) {
            <p>No encontramos un catálogo utilizable. <a routerLink="/cuentas">Administrar cuentas y categorías</a></p>
          }

          <button fpButton type="submit" [disabled]="busy() || !activeAccounts().length || !compatibleCategories().length">
            Guardar movimiento
          </button>
          <p class="zone-note">Se registra en tu cuenta autenticada y aparece en Movimientos al confirmarse el servidor.</p>
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
    return this.catalog()?.categories.filter((c) => c.state === 'active' && c.kind === this.kind) ?? [];
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
          payload: { name: 'Principal PEN', type: 'other', currency: 'PEN', state: 'active', position: 0 },
        }),
        signal,
      );
      await this.auth.createCatalog(
        loaded.ownerId,
        this.envelope({
          type: 'account.create',
          id: crypto.randomUUID(),
          payload: { name: 'Principal USD', type: 'other', currency: 'USD', state: 'active', position: 1 },
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
            payload: { name, kind, state: 'active', position: defaults.findIndex((x) => x[0] === name) },
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
      financialDate({ businessDate: this.businessDate, timezone: 'America/Lima' }, { now: () => new Date() });
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
      this.message.set('No pudimos guardar el movimiento. Revisa los datos o tu conexión e inténtalo nuevamente.');
    } finally {
      this.busy.set(false);
    }
  }
}
''')

# 5) Product screen: load server data, merge confirmed Gmail purchases/income and enable real analysis/budget views.
p = Path('packages/ui/src/product-screen.ts')
s = p.read_text()
s = s.replace(
    "              <h2>Abre tu espacio cifrado</h2>\n              <p>\n                Inicia sesión y desbloquea tu perfil local para ver información confirmada y\n                pendientes de este dispositivo.\n              </p>\n              <a routerLink=\"/registro\">Abrir espacio cifrado</a>",
    "              <h2>Cargando tus finanzas…</h2>\n              <p>Estamos consultando tus movimientos, cuentas y confirmaciones de Gmail.</p>\n              <button fpButton type=\"button\" (click)=\"workspace.openRemote()\">Reintentar</button>",
    1,
)
s = s.replace("                    : 'Abre tu espacio cifrado'", "                    : 'Cargando movimientos'", 1)
s = s.replace(
    "                    : 'Desbloquea tu perfil para consultar los movimientos guardados en este dispositivo.'",
    "                    : 'Estamos cargando los movimientos confirmados de tu cuenta.'",
    1,
)
s = s.replace(
    "                  workspace.unlocked() ? 'Registrar movimiento' : 'Abrir espacio cifrado'",
    "                  workspace.unlocked() ? 'Registrar movimiento' : 'Reintentar carga'",
    1,
)
# Cuentas wording no longer claims local-only catalog.
s = s.replace(
    "              Catálogo local: {{ workspace.catalog()?.downloadedAt ?? 'sin descargar' }}. Los saldos\n              confirmados se consultan en el servidor; esta vista no calcula un saldo local.",
    "              Catálogo de tu cuenta: {{ workspace.catalog()?.downloadedAt ?? 'cargando' }}. Cuentas y categorías se consultan con tu sesión activa.",
    1,
)
s = s.replace(
    "              <p>Abre tu espacio y descarga el catálogo de tu sesión para ver tus cuentas.</p>\n              <a routerLink=\"/registro\">Abrir espacio</a>",
    "              <p>No encontramos cuentas todavía.</p>\n              <a routerLink=\"/registro\">Preparar cuentas</a>",
    1,
)
# Merge accounting-relevant confirmed Gmail candidates into the movement model.
pat = re.compile(r"  readonly movementItems = computed<ProductMovementItem\[\]>\(\(\) =>\n    this\.movements\(\)\.map\(\(row\) => \(\{.*?\n  \);\n\n  readonly summary", re.S)
m = pat.search(s)
if not m:
    raise SystemExit('movementItems block missing')
new_block = r'''  readonly movementItems = computed<ProductMovementItem[]>(() => {
    const rows: ProductMovementItem[] = this.movements().map((row) => ({
      id: row.id,
      payload: row.payload,
      state: row.state,
      account: this.accountName(row.payload.accountId),
      category: this.categoryName(row.payload.categoryId),
      ...(row.failure ? { failure: row.failure } : {}),
    }));
    for (const item of this.workspace.gmailConfirmed()) {
      if (!item.currency || !item.amountMinor) continue;
      const kind =
        item.kind === 'income'
          ? 'income'
          : ['expense', 'card_charge', 'subscription'].includes(item.kind)
            ? 'expense'
            : undefined;
      if (!kind) continue;
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(item.occurredAt));
      rows.push({
        id: `gmail:${item.id}`,
        payload: {
          kind,
          accountId: '00000000-0000-4000-8000-000000000001',
          categoryId: '00000000-0000-4000-8000-000000000002',
          currency: item.currency,
          amountMinor: item.amountMinor,
          businessDate: date,
          timezone: 'America/Lima',
          occurredAt: item.occurredAt,
          note: item.summary,
        },
        state: 'confirmed',
        account: item.institution ?? item.merchant ?? 'Gmail',
        category:
          kind === 'income'
            ? 'Ingreso detectado'
            : item.kind === 'subscription'
              ? 'Suscripción'
              : 'Consumo detectado',
      });
    }
    return rows.sort(
      (a, b) =>
        b.payload.businessDate.localeCompare(a.payload.businessDate) || a.id.localeCompare(b.id),
    );
  });

  readonly summary'''
s = s[:m.start()] + new_block + s[m.end():]
# Functional monthly analysis / budget summaries.
summary_anchor = "  readonly summary = computed(() => summarizeProductMovements(this.movementItems()));"
extra = r'''  readonly summary = computed(() => summarizeProductMovements(this.movementItems()));
  readonly monthKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  readonly monthlyItems = computed(() =>
    this.movementItems().filter(
      (row) => row.state === 'confirmed' && row.payload.businessDate.startsWith(this.monthKey),
    ),
  );
  readonly monthlySummary = computed(() => summarizeProductMovements(this.monthlyItems()));
  readonly monthlyCategories = computed(() => {
    const values = new Map<string, { category: string; currency: string; minor: bigint }>();
    for (const row of this.monthlyItems()) {
      if (row.payload.kind !== 'expense') continue;
      const key = `${row.payload.currency}:${row.category}`;
      const current = values.get(key) ?? { category: row.category, currency: row.payload.currency, minor: 0n };
      current.minor += BigInt(row.payload.amountMinor);
      values.set(key, current);
    }
    return [...values.values()].sort((a, b) => (a.minor > b.minor ? -1 : a.minor < b.minor ? 1 : a.category.localeCompare(b.category)));
  });'''
if summary_anchor not in s:
    raise SystemExit('summary anchor missing')
s = s.replace(summary_anchor, extra, 1)
# Add analysis/budget branches before configuration.
config_anchor = "        } @else if (view() === 'configuracion') {"
branches = r'''        } @else if (view() === 'presupuestos') {
          <section class="product-currency-grid">
            @for (currency of monthlySummary().currencies; track currency.currency) {
              <article class="manual-card currency-summary">
                <p class="eyebrow">{{ currency.currency }}</p>
                <h2>Gasto confirmado del mes</h2>
                <strong>{{ exact(currency.currency, currency.expenseMinor) }}</strong>
                <p>{{ currency.confirmedCount }} movimiento(s) confirmado(s) en el periodo.</p>
              </article>
            } @empty {
              <article class="manual-card"><h2>Sin gasto confirmado este mes</h2><p>Los consumos que confirmes aparecerán aquí automáticamente.</p></article>
            }
          </section>
          <section class="manual-card">
            <h2>Seguimiento por categoría</h2>
            @for (row of monthlyCategories(); track row.currency + row.category) {
              <article class="pending-row"><strong>{{ row.category }}</strong><span>{{ exact(row.currency, row.minor) }}</span></article>
            } @empty {
              <p>Aún no hay categorías con consumo confirmado este mes.</p>
            }
            <p class="zone-note">Esta vista usa gasto real confirmado. Los límites mensuales personalizados se incorporarán sin inventar montos.</p>
          </section>
        } @else if (view() === 'analisis') {
          <section class="product-currency-grid">
            @for (currency of summary().currencies; track currency.currency) {
              <article class="manual-card currency-summary">
                <p class="eyebrow">{{ currency.currency }}</p>
                <h2>Resumen confirmado</h2>
                <dl class="money-summary">
                  <div><dt>Ingresos</dt><dd>{{ exact(currency.currency, currency.incomeMinor) }}</dd></div>
                  <div><dt>Gastos</dt><dd>{{ exact(currency.currency, currency.expenseMinor) }}</dd></div>
                  <div><dt>Balance registrado</dt><dd>{{ exact(currency.currency, currency.balanceMinor) }}</dd></div>
                </dl>
              </article>
            } @empty {
              <article class="manual-card"><h2>Aún no hay datos confirmados</h2><p>Confirma consumos o registra un movimiento para comenzar el análisis.</p></article>
            }
          </section>
          <section class="manual-card">
            <h2>Gasto del mes por categoría</h2>
            @for (row of monthlyCategories(); track row.currency + row.category) {
              <article class="pending-row"><strong>{{ row.category }}</strong><span>{{ exact(row.currency, row.minor) }}</span></article>
            } @empty {
              <p>Sin gasto confirmado para analizar en el mes actual.</p>
            }
          </section>
''' + config_anchor
if config_anchor not in s:
    raise SystemExit('configuration anchor missing')
s = s.replace(config_anchor, branches, 1)
# Begin loading remote state as soon as the screen is constructed.
class_anchor = "  readonly dateTo = signal('');\n\n  readonly title"
s = s.replace(
    class_anchor,
    "  readonly dateTo = signal('');\n\n  constructor() {\n    if (this.workspace.auth.signedIn) void this.workspace.openRemote();\n  }\n\n  readonly title",
    1,
)
p.write_text(s)

print('P17 product repair staged')
