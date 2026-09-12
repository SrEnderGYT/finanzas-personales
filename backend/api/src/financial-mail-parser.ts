import { createHash } from 'node:crypto';

export type FinancialMailKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'card_charge'
  | 'card_statement'
  | 'subscription'
  | 'debt'
  | 'payment'
  | 'unknown';

export interface FinancialMailInput {
  messageId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string;
}

export interface ParsedFinancialMail {
  kind: FinancialMailKind;
  institution?: string;
  merchant?: string;
  currency?: 'PEN' | 'USD';
  amountMinor?: number;
  occurredAt: string;
  confidence: number;
  fingerprint: string;
  summary: string;
}

const institutionRules: readonly [RegExp, string][] = [
  [/\b(bcp|viabcp|banco de credito|banco de crédito)\b/i, 'BCP'],
  [/\bbbva\b/i, 'BBVA'],
  [/\binterbank\b/i, 'Interbank'],
  [/\bscotiabank\b/i, 'Scotiabank'],
  [/\bbanbif\b/i, 'BanBif'],
  [/\bbanco de la nacion|banco de la nación\b/i, 'Banco de la Nación'],
  [/\bbanco falabella|cmr\b/i, 'Banco Falabella'],
  [/\btarjeta oh|financiera oh|oh!\b/i, 'Tarjeta oh!'],
  [/\b(io|io card|tarjeta io)\b/i, 'iO'],
  [/\bdiners\b/i, 'Diners Club'],
  [/\bripley\b/i, 'Banco Ripley'],
];

function compact(value: string, max = 512) {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function amountToMinor(raw: string): number | undefined {
  let value = raw.replace(/\s/g, '');
  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    value = value.split(thousands).join('').replace(decimal, '.');
  } else if (comma >= 0) {
    const decimals = value.length - comma - 1;
    value = decimals === 1 || decimals === 2 ? value.replace(',', '.') : value.replace(/,/g, '');
  } else if (dot >= 0) {
    const decimals = value.length - dot - 1;
    if (decimals !== 1 && decimals !== 2) value = value.replace(/\./g, '');
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100_000_000) return undefined;
  return Math.round(number * 100);
}

function money(text: string) {
  const pattern = /(S\/?\.?|PEN|US\$|USD|\$)\s*([0-9][0-9.,]*)/gi;
  for (const match of text.matchAll(pattern)) {
    const amountMinor = amountToMinor(match[2]!);
    if (amountMinor === undefined) continue;
    const token = match[1]!.toUpperCase();
    const currency: 'PEN' | 'USD' =
      token.includes('US') || token === 'USD' || token === '$' ? 'USD' : 'PEN';
    return { amountMinor, currency };
  }
  return {};
}

function classify(text: string): { kind: FinancialMailKind; confidence: number } | undefined {
  if (/estado de cuenta|fecha de corte|pago m[ií]nimo|l[ií]nea de cr[eé]dito/i.test(text))
    return { kind: 'card_statement', confidence: 90 };
  if (
    /suscripci[oó]n|membres[ií]a|renovaci[oó]n autom[aá]tica|pago recurrente|pr[oó]ximo cobro/i.test(
      text,
    )
  )
    return { kind: 'subscription', confidence: 88 };
  if (
    /pr[eé]stamo|deuda|cuota (?:mensual|pendiente|por pagar)|saldo pendiente|vencimiento de (?:cuota|cr[eé]dito)/i.test(
      text,
    )
  )
    return { kind: 'debt', confidence: 86 };
  if (
    /compra (?:con|realizada).*tarjeta|consumo.*tarjeta|operaci[oó]n.*tarjeta|cargo.*tarjeta/i.test(
      text,
    )
  )
    return { kind: 'card_charge', confidence: 89 };
  if (
    /abono|dep[oó]sito|transferencia recibida|ingreso|pago recibido|sueldo|remuneraci[oó]n/i.test(
      text,
    )
  )
    return { kind: 'income', confidence: 82 };
  if (/transferencia|yape|plin/i.test(text)) return { kind: 'transfer', confidence: 74 };
  if (/pago realizado|pagaste|pago procesado|pago de tarjeta/i.test(text))
    return { kind: 'payment', confidence: 78 };
  if (/compra|consumo|cargo|retiro|d[eé]bito|recibo|factura|pago/i.test(text))
    return { kind: 'expense', confidence: 72 };
  return undefined;
}

function institution(text: string) {
  for (const [pattern, name] of institutionRules) if (pattern.test(text)) return name;
  return undefined;
}

export function parseFinancialMail(input: FinancialMailInput): ParsedFinancialMail | undefined {
  if (!Number.isFinite(Date.parse(input.receivedAt))) return undefined;
  const sender = compact(input.sender, 512);
  const subject = compact(input.subject, 1024);
  const snippet = compact(input.snippet, 2048);
  const text = `${sender}\n${subject}\n${snippet}`;
  const category = classify(text);
  if (!category) return undefined;
  const detectedMoney = money(text);
  const bank = institution(text);
  const confidence = Math.min(
    99,
    category.confidence + (detectedMoney.amountMinor !== undefined ? 5 : 0) + (bank ? 3 : 0),
  );
  const summary = compact(subject || snippet || `${category.kind} detectado`, 512);
  const fingerprint = createHash('sha256')
    .update(
      [
        input.messageId,
        category.kind,
        bank ?? '',
        detectedMoney.currency ?? '',
        detectedMoney.amountMinor?.toString() ?? '',
      ].join('|'),
    )
    .digest('hex');
  return {
    kind: category.kind,
    ...(bank ? { institution: bank } : {}),
    ...(detectedMoney.currency ? { currency: detectedMoney.currency } : {}),
    ...(detectedMoney.amountMinor !== undefined ? { amountMinor: detectedMoney.amountMinor } : {}),
    occurredAt: new Date(input.receivedAt).toISOString(),
    confidence,
    fingerprint,
    summary,
  };
}
