from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, new: str, label: str) -> str:
    a = text.find(start)
    b = text.find(end, a + len(start)) if a >= 0 else -1
    if a < 0 or b < 0:
        raise SystemExit(f'{label}: anchors missing')
    return text[:a] + new + text[b:]

# Gmail service: broader 90-day recovery, label-aware parsing, stale-pending reconciliation.
p = Path('backend/api/src/gmail-service.ts')
t = p.read_text()
t = replace_once(t, 'options.maxMessages ?? 1500', 'options.maxMessages ?? 5000', 'gmail max messages')
t = replace_once(t, "url.searchParams.set('maxResults', '100');", "url.searchParams.set('maxResults', '250');", 'gmail page size')
t = replace_once(
    t,
    "url.searchParams.set('q', `after:${isoDate(from).replaceAll('-', '/')}`);",
    "url.searchParams.set('q', `after:${isoDate(from).replaceAll('-', '/')} -category:promotions -in:spam -in:trash`);",
    'gmail query quality',
)
t = replace_once(
    t,
    "    const snippet = text(data['snippet'], 2048);\n",
    "    const snippet = text(data['snippet'], 2048);\n    const labels = Array.isArray(data['labelIds'])\n      ? data['labelIds'].filter((value): value is string => typeof value === 'string').slice(0, 64)\n      : [];\n",
    'gmail labels',
)
t = replace_once(
    t,
    "      receivedAt: receivedAt.toISOString(),\n    });",
    "      receivedAt: receivedAt.toISOString(),\n      labels,\n    });",
    'parser labels',
)
t = replace_once(
    t,
    "    await this.pool.query(\n      `INSERT INTO app.gmail_financial_candidates(\n         id,user_id,source_message_id,kind,institution,merchant,currency,amount_minor,\n         occurred_at,confidence,fingerprint,summary\n       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)\n       ON CONFLICT(user_id,fingerprint) DO NOTHING`,\n",
    "    await this.pool.query(\n      `DELETE FROM app.gmail_financial_candidates\n        WHERE user_id=$1 AND source_message_id=$2 AND status='pending' AND fingerprint<>$3`,\n      [id, messageId, candidate.fingerprint],\n    );\n    await this.pool.query(\n      `INSERT INTO app.gmail_financial_candidates(\n         id,user_id,source_message_id,kind,institution,merchant,currency,amount_minor,\n         occurred_at,confidence,fingerprint,summary\n       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)\n       ON CONFLICT(user_id,fingerprint) DO UPDATE SET\n         kind=EXCLUDED.kind,institution=EXCLUDED.institution,merchant=EXCLUDED.merchant,\n         currency=EXCLUDED.currency,amount_minor=EXCLUDED.amount_minor,\n         occurred_at=EXCLUDED.occurred_at,confidence=EXCLUDED.confidence,summary=EXCLUDED.summary\n       WHERE app.gmail_financial_candidates.status='pending'`,\n",
    'candidate reconciliation',
)
p.write_text(t)

# Gmail review UI: hide obvious non-movements even while an older API is deployed.
p = Path('packages/ui/src/gmail-screen.ts')
t = p.read_text()
t = replace_once(
    t,
    "import { SyncHttpError } from '../../shared/src/sync-engine';\n",
    "import { SyncHttpError } from '../../shared/src/sync-engine';\nimport { isReviewableGmailCandidate } from '../../shared/src/gmail-semantics';\n",
    'gmail semantics import',
)
t = replace_once(
    t,
    "        Boolean(candidate.amountMinor && candidate.currency) &&\n        limaMonth(new Date(candidate.occurredAt)) === this.candidateMonth(),",
    "        isReviewableGmailCandidate(candidate) &&\n        limaMonth(new Date(candidate.occurredAt)) === this.candidateMonth(),",
    'gmail client safety',
)
t = replace_once(
    t,
    "      payment: 'Pago de tarjeta',\n      unknown: 'Por revisar',",
    "      payment: 'Pago de tarjeta',\n      refund: 'Devolución / reverso',\n      unknown: 'Por revisar',",
    'gmail refund label',
)
p.write_text(t)

# Detected financial views: apply same safety layer and show refunds in card activity.
p = Path('packages/ui/src/detected-finances-screen.ts')
t = p.read_text()
t = replace_once(
    t,
    "} from '../../shared/src/gmail-candidates';\n",
    "} from '../../shared/src/gmail-candidates';\nimport { isReviewableGmailCandidate } from '../../shared/src/gmail-semantics';\n",
    'detected semantics import',
)
t = replace_once(
    t,
    "type CardKindFilter = 'all' | 'card_charge' | 'payment' | 'card_statement';",
    "type CardKindFilter = 'all' | 'card_charge' | 'payment' | 'card_statement' | 'refund';",
    'detected filter type',
)
t = replace_once(
    t,
    '                <option value="payment">Pagos</option>\n                <option value="card_statement">Deuda / estado</option>',
    '                <option value="payment">Pagos</option>\n                <option value="refund">Devoluciones</option>\n                <option value="card_statement">Deuda / estado</option>',
    'detected refund option',
)
t = t.replace("? ['card_charge', 'card_statement', 'payment']", "? ['card_charge', 'card_statement', 'payment', 'refund']")
t = replace_once(
    t,
    "        candidate.status === 'discarded' ||\n        !allowed.has(candidate.kind) ||",
    "        candidate.status === 'discarded' ||\n        !isReviewableGmailCandidate(candidate) ||\n        !allowed.has(candidate.kind) ||",
    'detected period safety',
)
t = replace_once(
    t,
    "        item.status !== 'discarded' &&\n        !!item.institution &&",
    "        item.status !== 'discarded' &&\n        isReviewableGmailCandidate(item) &&\n        !!item.institution &&",
    'detected card safety',
)
t = t.replace("['card_charge', 'card_statement', 'payment'].includes(item.kind)", "['card_charge', 'card_statement', 'payment', 'refund'].includes(item.kind)")
t = replace_once(
    t,
    "if (['all', 'card_charge', 'payment', 'card_statement'].includes(value))",
    "if (['all', 'card_charge', 'payment', 'card_statement', 'refund'].includes(value))",
    'detected filter setter',
)
t = replace_once(
    t,
    "      payment: 'Pago de tarjeta',\n      unknown: 'Por revisar',",
    "      payment: 'Pago de tarjeta',\n      refund: 'Devolución / reverso',\n      unknown: 'Por revisar',",
    'detected refund label',
)
p.write_text(t)

# Product dashboard: professional analytics and automatic category mapping.
p = Path('packages/ui/src/product-screen.ts')
t = p.read_text()
t = replace_once(
    t,
    "} from './product-insights';\n",
    "} from './product-insights';\nimport { FinanceDashboard } from './finance-dashboard';\nimport { automaticCategory, isDashboardGmailMovement } from '../../shared/src/gmail-semantics';\n",
    'dashboard imports',
)
t = replace_once(
    t,
    '  imports: [FormsModule, RouterLink, Screen, CorrectionEditor, CatalogCreator, ...UI_PRIMITIVES],',
    '  imports: [FormsModule, RouterLink, Screen, CorrectionEditor, CatalogCreator, FinanceDashboard, ...UI_PRIMITIVES],',
    'dashboard component import',
)
start = "            @if (summary().currencies.length) {\n"
end = '            <section class="manual-card">\n              <header class="product-section-heading">\n                <div>\n                  <h2>Actividad reciente</h2>'
replacement = "            <fp-finance-dashboard [rows]=\"movementItems()\" />\n\n"
t = replace_between(t, start, end, replacement, 'dashboard template')
old_map = """    for (const item of this.workspace.gmailConfirmed()) {
      if (!item.currency || !item.amountMinor) continue;
      const kind =
        item.kind === 'income'
          ? 'income'
          : ['expense', 'card_charge', 'subscription'].includes(item.kind)
            ? 'expense'
            : undefined;
      if (!kind) continue;
"""
new_map = """    for (const item of this.workspace.gmailConfirmed()) {
      if (!isDashboardGmailMovement(item) || !item.currency || !item.amountMinor) continue;
      const kind = item.kind === 'income' ? 'income' : 'expense';
"""
t = replace_once(t, old_map, new_map, 'dashboard gmail mapping')
old_category = """        account: item.institution ?? item.merchant ?? 'Gmail',
        category:
          kind === 'income'
            ? 'Ingreso detectado'
            : item.kind === 'subscription'
              ? 'Suscripción'
              : 'Consumo detectado',
"""
new_category = """        account: item.institution ?? item.merchant ?? 'Gmail',
        category: automaticCategory(item),
"""
t = replace_once(t, old_category, new_category, 'dashboard category mapping')
p.write_text(t)

# Parser regression adjustment for known recurring plan wording.
p = Path('backend/api/src/financial-mail-parser.ts')
t = p.read_text()
t = replace_once(
    t,
    "    /\\b(cobro recurrente (?:realizado|procesado)?|cargo recurrente (?:realizado|procesado)?|pago recurrente (?:realizado|procesado)?|renovaci[oó]n (?:autom[aá]tica )?(?:cobrada|procesada|realizada)|membres[ií]a mensual (?:cobrada|renovada)|suscripci[oó]n mensual (?:cobrada|renovada)|plan mensual (?:cobrado|renovado))\\b/i.test(\n",
    "    /\\b(cobro recurrente(?: realizado| procesado)?|cargo recurrente(?: realizado| procesado)?|pago recurrente(?: realizado| procesado)?|renovaci[oó]n (?:autom[aá]tica )?(?:cobrada|procesada|realizada)|se realiz[oó] el cobro recurrente|membres[ií]a mensual[^\\n]{0,100}(?:cobrada|renovada|se renov[oó])|suscripci[oó]n mensual[^\\n]{0,100}(?:cobrada|renovada|se renov[oó])|plan mensual[^\\n]{0,100}(?:cobrado|renovado|se renov[oó]))\\b/i.test(\n",
    'recurring language',
)
p.write_text(t)

# Existing parser test: an invoice alone is not an executed expense.
p = Path('tests/gmail-ingestion.test.ts')
t = p.read_text()
t = replace_once(
    t,
    "function mail(subject: string, snippet: string, sender = 'BCP <avisos@bcp.com.pe>') {\n  return parseFinancialMail({\n    messageId: `${subject}-${snippet}`.slice(0, 128),\n    sender,\n    subject,\n    snippet,\n    receivedAt,\n  });\n}",
    "function mail(\n  subject: string,\n  snippet: string,\n  sender = 'BCP <avisos@bcp.com.pe>',\n  labels: readonly string[] = [],\n) {\n  return parseFinancialMail({\n    messageId: `${subject}-${snippet}`.slice(0, 128),\n    sender,\n    subject,\n    snippet,\n    receivedAt,\n    labels,\n  });\n}",
    'test helper labels',
)
old_test = """  it('keeps billed services with an amount without treating bank receipts as expenses', () => {
    expect(
      mail(
        'Recibo Claro - Setiembre 998270930',
        'Tu recibo Claro del mes tiene un importe de S/ 29.90.',
        'Claro <recibos@claro.com.pe>',
      ),
    ).toMatchObject({
      kind: 'expense',
      merchant: 'Claro',
      currency: 'PEN',
      amountMinor: 2990,
    });
  });
"""
new_test = """  it('does not turn invoices into expenses unless an executed payment is explicit', () => {
    expect(
      mail(
        'Recibo Claro - Setiembre',
        'Tu recibo del mes tiene un importe de S/ 29.90 y vence pronto.',
        'Claro <recibos@example.test>',
      ),
    ).toBeUndefined();
    expect(
      mail(
        'Pago de servicio realizado',
        'Tu pago realizado de Claro por S/ 29.90 fue completado.',
        'Claro <avisos@example.test>',
      ),
    ).toMatchObject({ kind: 'expense', merchant: 'Claro', currency: 'PEN', amountMinor: 2990 });
  });
"""
t = replace_once(t, old_test, new_test, 'invoice regression')
insert_before = "  it('encrypts refresh tokens with user-bound authenticated encryption', () => {\n"
extra = """  it('separates refunds, pending notices, receipts and debit-card expenses', () => {
    expect(
      mail(
        'Realizamos una devolución de una operación a tu Tarjeta de Débito',
        'Se ha devuelto el monto de S/ 143.21 a tu cuenta. Monto total devuelto S/ 143.21.',
      ),
    ).toMatchObject({ kind: 'refund', currency: 'PEN', amountMinor: 14321 });

    expect(
      mail(
        'Realizaste un consumo con tu Tarjeta de Débito',
        'Realizaste un consumo de S/ 41.70 con tu Tarjeta de Débito en SUPERMERCADO CENTRAL. Por tu seguridad, revisa los datos.',
      ),
    ).toMatchObject({ kind: 'expense', merchant: 'SUPERMERCADO CENTRAL', amountMinor: 4170 });

    expect(
      mail(
        'Tu suscripción está por vencer',
        'La siguiente suscripción vencerá pronto. Plan mensual S/ 24.90.',
        'Proveedor <notices@example.test>',
      ),
    ).toBeUndefined();

    expect(
      mail(
        'Error de pago. Está pendiente el pago de tu viaje.',
        'Total S/ 18.40. Aún no se pagó este viaje.',
        'Movilidad <receipts@example.test>',
      ),
    ).toBeUndefined();

    expect(
      mail(
        'Has recibido una BOLETA Nro. TEST-001 de COMERCIO EJEMPLO',
        'Facturación electrónica. MONTO TOTAL: PEN 78.30.',
        'Documentos <no-reply@example.test>',
      ),
    ).toBeUndefined();
  });

  it('uses Gmail promotion labels and extracts merchants from bank notifications', () => {
    expect(
      mail(
        'Beneficio especial para ti',
        'Compra desde S/ 120.00.',
        'Banco <marketing@example.test>',
        ['CATEGORY_PROMOTIONS'],
      ),
    ).toBeUndefined();

    expect(
      mail(
        'Realizaste un consumo con tu Tarjeta Interbank Visa Platinum',
        'Tarjeta: ****0000 Comercio: TIENDA EJEMPLO Monto: S/. 64.20 Fecha: 01/09/2026',
        'Interbank <avisos@example.test>',
      ),
    ).toMatchObject({ kind: 'card_charge', merchant: 'TIENDA EJEMPLO', amountMinor: 6420 });

    expect(
      mail('Retiro de tu guardadito', 'Retiraste de tu guardadito S/ 52.40 hacia tu cuenta.'),
    ).toMatchObject({ kind: 'transfer', amountMinor: 5240 });
  });

"""
t = replace_once(t, insert_before, extra + insert_before, 'new semantic regressions')
p.write_text(t)
