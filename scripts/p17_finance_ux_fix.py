from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1))


# Parser: tighten promotional filtering and distinguish Interbank Visa Access.
replace(
    "backend/api/src/financial-mail-parser.ts",
    "descuentos?|beneficio(?:s)?|ll[eé]vate|regalo con tu compra",
    "descuentos?|dscto(?:s)?|beneficio(?:s)?|ll[eé]vate|regalo con tu compra",
)
replace(
    "backend/api/src/financial-mail-parser.ts",
    "const subscriptionCancellation =",
    "const interbankAccessLoan = /\\b(?:ibk\\s+)?visa access\\b/i;\n\nconst subscriptionCancellation =",
)
replace(
    "backend/api/src/financial-mail-parser.ts",
    "  if (!hasAmount) return undefined;\n\n  if (\n    /\\b(estado de cuenta",
    "  if (!hasAmount) return undefined;\n\n  // Visa Access de Interbank se modela como préstamo/deuda, no como tarjeta de crédito.\n  if (interbankAccessLoan.test(text)) return { kind: 'debt', confidence: 96 };\n\n  if (\n    /\\b(estado de cuenta",
)

# Gmail: retain at least 90 days so subscriptions can be recognized from recurrence.
replace(
    "backend/api/src/gmail-service.ts",
    "return { state: 'disconnected', scope: GMAIL_READONLY_SCOPE, rangeDays: 30 };",
    "return { state: 'disconnected', scope: GMAIL_READONLY_SCOPE, rangeDays: 90 };",
)
replace(
    "backend/api/src/gmail-service.ts",
    "      rangeDays: Number(value['range_days']),",
    "      rangeDays: Math.max(90, Number(value['range_days'])),",
)
replace(
    "backend/api/src/gmail-service.ts",
    "  async start(rawUserId: string, rangeDays: number) {\n    const id = userId(rawUserId);\n    const state = randomBytes(32).toString('base64url');",
    "  async start(rawUserId: string, rangeDays: number) {\n    const id = userId(rawUserId);\n    const effectiveRangeDays = Math.max(90, rangeDays);\n    const state = randomBytes(32).toString('base64url');",
)
replace(
    "backend/api/src/gmail-service.ts",
    "      [sha256(state), id, rangeDays],",
    "      [sha256(state), id, effectiveRangeDays],",
)
replace(
    "backend/api/src/gmail-service.ts",
    "    const rangeDays = Number(result.rows[0].range_days);",
    "    const rangeDays = Math.max(90, Number(result.rows[0].range_days));",
)

# Gmail review: multi-selection, bulk review and CSV download.
replace(
    "packages/ui/src/gmail-screen.ts",
    '                <option [ngValue]="7">Últimos 7 días</option>\n                <option [ngValue]="30">Últimos 30 días</option>\n                <option [ngValue]="90">Últimos 90 días</option>',
    '                <option [ngValue]="90">Últimos 90 días</option>',
)
replace(
    "packages/ui/src/gmail-screen.ts",
    "          @if (candidateBusy()) {",
    """          @if (!candidateBusy() && candidates().length > 0) {
            <div class="gmail-bulk-toolbar" aria-label="Acciones para elementos seleccionados">
              <label class="gmail-select-all">
                <input
                  type="checkbox"
                  [checked]="allVisibleSelected()"
                  (change)="toggleAllVisible($any($event.target).checked)"
                />
                Seleccionar visibles
              </label>
              <strong>{{ selectedCount() }} seleccionados</strong>
              <div class="gmail-bulk-actions">
                <button
                  fpButton
                  type="button"
                  [disabled]="selectedPendingCount() === 0"
                  (click)="reviewSelected('confirmed')"
                >
                  Confirmar seleccionados
                </button>
                <button
                  fpButton
                  class="secondary"
                  type="button"
                  [disabled]="selectedPendingCount() === 0"
                  (click)="reviewSelected('discarded')"
                >
                  Descartar seleccionados
                </button>
                <button
                  fpButton
                  class="secondary"
                  type="button"
                  [disabled]="selectedCount() === 0"
                  (click)="downloadSelected()"
                >
                  Descargar CSV
                </button>
              </div>
            </div>
          }

          @if (candidateBusy()) {""",
)
replace(
    "packages/ui/src/gmail-screen.ts",
    '                <article class="gmail-candidate">\n                  <div class="candidate-main">\n                    <div class="candidate-heading">',
    """                <article class="gmail-candidate" [class.selected]="isSelected(candidate.id)">
                  <div class="candidate-main">
                    <div class="candidate-heading">
                      <label class="candidate-selector">
                        <input
                          type="checkbox"
                          [checked]="isSelected(candidate.id)"
                          (change)="toggleCandidate(candidate.id, $any($event.target).checked)"
                        />
                        Seleccionar
                      </label>""",
)
replace(
    "packages/ui/src/gmail-screen.ts",
    "  readonly disconnectArmed = signal(false);\n  readonly readonlyScope = GMAIL_READONLY_SCOPE;",
    """  readonly disconnectArmed = signal(false);
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly selectedCount = computed(() => {
    const visible = new Set(this.candidates().map((candidate) => candidate.id));
    return [...this.selectedIds()].filter((id) => visible.has(id)).length;
  });
  readonly selectedPendingCount = computed(() =>
    this.candidates().filter(
      (candidate) => candidate.status === 'pending' && this.selectedIds().has(candidate.id),
    ).length,
  );
  readonly allVisibleSelected = computed(
    () =>
      this.candidates().length > 0 &&
      this.candidates().every((candidate) => this.selectedIds().has(candidate.id)),
  );
  readonly readonlyScope = GMAIL_READONLY_SCOPE;""",
)
replace("packages/ui/src/gmail-screen.ts", "  rangeDays = 30;", "  rangeDays = 90;")
replace(
    "packages/ui/src/gmail-screen.ts",
    "  private money(value: bigint) {",
    """  isSelected(id: string) {
    return this.selectedIds().has(id);
  }

  toggleCandidate(id: string, checked: boolean) {
    const next = new Set(this.selectedIds());
    if (checked) next.add(id);
    else next.delete(id);
    this.selectedIds.set(next);
  }

  toggleAllVisible(checked: boolean) {
    const next = new Set(this.selectedIds());
    for (const candidate of this.candidates()) {
      if (checked) next.add(candidate.id);
      else next.delete(candidate.id);
    }
    this.selectedIds.set(next);
  }

  async reviewSelected(status: 'confirmed' | 'discarded') {
    if (this.candidateBusy()) return;
    const ids = this.candidates()
      .filter((candidate) => candidate.status === 'pending' && this.selectedIds().has(candidate.id))
      .map((candidate) => candidate.id);
    if (ids.length === 0) return;
    this.candidateBusy.set(true);
    this.error.set('');
    try {
      await Promise.all(
        ids.map((id) =>
          this.auth.gmail(
            `candidates/${id}/${status === 'confirmed' ? 'confirm' : 'discard'}`,
            'POST',
          ),
        ),
      );
      this.selectedIds.set(new Set());
      const value = await this.auth.gmail(`candidates?status=${this.candidateView}`, 'GET');
      this.allCandidates.set(normalizeGmailCandidates(value));
      this.message.set(
        status === 'confirmed'
          ? `${ids.length} hallazgo(s) confirmados.`
          : `${ids.length} hallazgo(s) descartados.`,
      );
    } catch {
      this.error.set(
        'No se pudieron actualizar todos los elementos seleccionados. Recarga la bandeja.',
      );
    } finally {
      this.candidateBusy.set(false);
    }
  }

  downloadSelected() {
    const rows = this.candidates().filter((candidate) => this.selectedIds().has(candidate.id));
    if (rows.length === 0) return;
    const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = [
      ['tipo', 'estado', 'institucion', 'comercio', 'moneda', 'importe', 'fecha', 'resumen'],
      ...rows.map((candidate) => [
        this.kindLabel(candidate.kind),
        this.statusLabel(candidate.status),
        candidate.institution ?? '',
        candidate.merchant ?? '',
        candidate.currency ?? '',
        candidate.amountMinor ? this.money(BigInt(candidate.amountMinor)) : '',
        candidate.occurredAt,
        candidate.summary,
      ]),
    ].map((row) => row.map(cell).join(','));
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gmail-finanzas-${this.candidateMonth()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    this.message.set(`${rows.length} elemento(s) exportados a CSV.`);
  }

  private money(value: bigint) {""",
)
replace(
    "packages/ui/src/gmail-screen.ts",
    "      this.allCandidates.set(normalizeGmailCandidates(value));\n    } catch (error) {",
    "      this.allCandidates.set(normalizeGmailCandidates(value));\n      this.selectedIds.set(new Set());\n    } catch (error) {",
)

# Card/product presentation.
replace(
    "packages/ui/src/detected-finances-screen.ts",
    "      if (this.view() === 'debts' && !candidate.institution) return false;",
    "      if (this.view() === 'cards' && this.isAccessLoan(candidate)) return false;\n      if (this.view() === 'debts' && !candidate.institution) return false;",
)
replace(
    "packages/ui/src/detected-finances-screen.ts",
    "        !!item.institution &&\n        ['card_charge', 'card_statement', 'payment'].includes(item.kind),",
    "        !!item.institution &&\n        !this.isAccessLoan(item) &&\n        ['card_charge', 'card_statement', 'payment'].includes(item.kind),",
)
replace(
    "packages/ui/src/detected-finances-screen.ts",
    "      const current = grouped.get(item.institution) ?? { events: 0, pending: 0 };\n      current.events++;\n      if (item.status === 'pending') current.pending++;\n      grouped.set(item.institution, current);",
    "      const product = this.cardProductLabel(item);\n      const current = grouped.get(product) ?? { events: 0, pending: 0 };\n      current.events++;\n      if (item.status === 'pending') current.pending++;\n      grouped.set(product, current);",
)
replace(
    "packages/ui/src/detected-finances-screen.ts",
    "  ngOnInit() {",
    """  isAccessLoan(item: GmailFinancialCandidate) {
    return item.institution === 'Interbank' && /\b(?:ibk\s+)?visa access\b/i.test(item.summary);
  }

  cardProductLabel(item: GmailFinancialCandidate) {
    const institution = item.institution ?? 'Tarjeta';
    const text = `${item.summary} ${item.merchant ?? ''}`;
    if (/\bvisa infinite sapphire\b|\bsapphire\b/i.test(text))
      return `${institution} Visa Infinite Sapphire`;
    if (/\bvisa platinum\b/i.test(text)) return `${institution} Visa Platinum`;
    if (/\bmastercard\b/i.test(text)) return `${institution} Mastercard`;
    return institution;
  }

  ngOnInit() {""",
)
replace(
    "packages/ui/src/detected-finances-screen.ts",
    "        ? 'Cobros recurrentes reales detectados por importe y proveedor, no promociones ni bajas.'",
    "        ? 'Cobros recurrentes reales detectados en una ventana mínima de 90 días, por importe y proveedor; no promociones ni bajas.'",
)

# Inicio: category analysis based on confirmed monthly expenses only.
replace(
    "packages/ui/src/product-screen.ts",
    '            <section class="manual-card">\n              <header class="product-section-heading">\n                <div>\n                  <h2>Actividad reciente</h2>',
    """            <section class="manual-card expense-chart-card" aria-label="Distribución de gastos del mes">
              <header class="product-section-heading">
                <div>
                  <h2>En qué se va tu dinero este mes</h2>
                  <p>Distribución por categoría usando únicamente gastos confirmados.</p>
                </div>
                <a routerLink="/analisis">Abrir análisis</a>
              </header>
              @for (row of monthlyCategories().slice(0, 8); track row.currency + row.category) {
                <article class="expense-chart-row">
                  <div class="expense-chart-label">
                    <strong>{{ row.category }}</strong>
                    <span>{{ exact(row.currency, row.minor) }}</span>
                  </div>
                  <div class="expense-chart-track" aria-hidden="true">
                    <span [style.width.%]="categoryShare(row.currency, row.minor)"></span>
                  </div>
                  <small>
                    {{ categoryShare(row.currency, row.minor) }}% de tus gastos {{ row.currency }}
                  </small>
                </article>
              } @empty {
                <p class="empty-local">Confirma consumos para construir el gráfico del mes.</p>
              }
            </section>

            <section class="manual-card">
              <header class="product-section-heading">
                <div>
                  <h2>Actividad reciente</h2>""",
)
replace(
    "packages/ui/src/product-screen.ts",
    "  clearFilters() {",
    """  categoryShare(currency: string, minor: bigint) {
    const total = this.monthlyCategories()
      .filter((row) => row.currency === currency)
      .reduce((sum, row) => sum + row.minor, 0n);
    if (total <= 0n || minor <= 0n) return 0;
    return Math.max(1, Math.min(100, Number((minor * 100n) / total)));
  }

  clearFilters() {""",
)

# Styles.
Path("packages/ui/src/gmail-screen.css").write_text(
    Path("packages/ui/src/gmail-screen.css").read_text()
    + """

.gmail-bulk-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin: 14px 0 18px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, #635bff 6%, var(--surface, #fff));
}

.gmail-select-all,
.candidate-selector {
  display: inline-flex !important;
  flex-direction: row !important;
  align-items: center;
  gap: 8px !important;
  margin: 0 !important;
  font-weight: 700;
}

.gmail-select-all input,
.candidate-selector input {
  width: 18px;
  height: 18px;
  accent-color: #635bff;
}

.gmail-bulk-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.gmail-candidate.selected {
  border-color: color-mix(in srgb, #635bff 65%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, #635bff 12%, transparent);
}

@media (max-width: 760px) {
  .gmail-bulk-actions,
  .gmail-bulk-actions > button {
    width: 100%;
  }
}
"""
)
Path("packages/ui/src/manual-screen.css").write_text(
    Path("packages/ui/src/manual-screen.css").read_text()
    + """

.expense-chart-card {
  margin: 18px 0;
}

.expense-chart-row {
  padding: 14px 0;
  border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}

.expense-chart-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
}

.expense-chart-label span,
.expense-chart-row small {
  font-size: 0.82rem;
  opacity: 0.75;
}

.expense-chart-track {
  width: 100%;
  height: 12px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 9%, transparent);
}

.expense-chart-track > span {
  display: block;
  height: 100%;
  min-width: 4px;
  border-radius: inherit;
  background: #635bff;
}

.expense-chart-row small {
  display: block;
  margin-top: 6px;
}
"""
)

# Migrate existing Gmail range/product semantics and clear pending false positives.
Path("backend/api/migrations/025_gmail_90d_products_cleanup.sql").write_text(
    """-- Use a minimum three-month Gmail history for recurring-subscription detection.
UPDATE app.gmail_connections
SET range_days = 90,
    updated_at = now()
WHERE range_days < 90;

-- Interbank Visa Access belongs to the loan/debt view, not credit cards.
UPDATE app.gmail_financial_candidates
SET kind = 'debt',
    confidence = GREATEST(confidence, 96)
WHERE institution = 'Interbank'
  AND summary ~* '(^|[^[:alnum:]])(IBK[[:space:]]+)?Visa Access([^[:alnum:]]|$)'
  AND status <> 'discarded';

-- Preserve reviewed history; remove only pending commercial false positives.
DELETE FROM app.gmail_financial_candidates
WHERE status = 'pending'
  AND summary ~* '(gana(?:r)?|puntos?|millas?|sacar[[:space:]]+millas|participa|sorteo|premio|descuentos?|dscto|oferta|promoci[oó]n|beneficio|preventa|ll[eé]vate|regalo con tu compra|pr[oó]xima compra|compra favorita|cashback.*(?:sorteo|premio|gana)|cambia.*y gana|pasajes?.*desde)';
"""
)

# Regression tests for exact newly reported examples and Visa Access semantics.
replace(
    "tests/gmail-ingestion.test.ts",
    "  it('classifies a card-payment receipt as payment, never as income', () => {",
    """  it('ignores additional Plin, miles and discount promotions from the review inbox', () => {
    expect(
      mail(
        'Hoy tenemos sesión de cómo sacar millas con plin sin que te baneen! Los veo a las 9PM!',
        'Reserva tu acceso por S/ 9.00.',
        'Comunidad <promo@example.com>',
      ),
    ).toBeUndefined();
    expect(
      mail(
        'Gana hasta S/300 con Plin BBVA',
        'Participa usando Plin.',
        'BBVA <beneficios@bbva.pe>',
      ),
    ).toBeUndefined();
    expect(
      mail(
        '¡Llévate S/100 de dscto en pisos para tu hogar!',
        'Compra desde hoy.',
        'Tienda <promo@example.com>',
      ),
    ).toBeUndefined();
  });

  it('treats Interbank Visa Access as debt, not as a credit card', () => {
    expect(
      mail(
        'IBK Visa Access - deuda total',
        'Tu deuda total de Visa Access es S/ 6,332.05.',
        'Interbank <avisos@interbank.pe>',
      ),
    ).toMatchObject({ kind: 'debt', institution: 'Interbank', amountMinor: 633205 });
  });

  it('classifies a card-payment receipt as payment, never as income', () => {""",
)
