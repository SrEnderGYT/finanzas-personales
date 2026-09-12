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

const subscriptionMerchants: readonly [RegExp, string][] = [
  [/\bspotify\b/i, 'Spotify'],
  [/\b(chatgpt|openai)\b/i, 'ChatGPT'],
  [/\bnetflix\b/i, 'Netflix'],
  [/\b(prime video|amazon prime)\b/i, 'Prime Video'],
  [/\byoutube premium\b/i, 'YouTube Premium'],
  [/\b(disney\+?|disney plus)\b/i, 'Disney+'],
  [/\b(hbo max|max\.com|max)\b/i, 'Max'],
  [/\bapple music\b/i, 'Apple Music'],
  [/\bgoogle one\b/i, 'Google One'],
  [/\b(icloud\+?|icloud plus)\b/i, 'iCloud+'],
  [/\bmicrosoft 365\b/i, 'Microsoft 365'],
  [/\bcanva\b/i, 'Canva'],
  [/\badobe\b/i, 'Adobe'],
  [/\bdropbox\b/i, 'Dropbox'],
];

const billedServiceMerchants: readonly [RegExp, string][] = [
  [/\bclaro\b/i, 'Claro'],
  [/\bmovistar\b/i, 'Movistar'],
  [/\bentel\b/i, 'Entel'],
  [/\bwin(?:\.pe)?\b/i, 'WIN'],
  [/\bluz del sur\b/i, 'Luz del Sur'],
  [/\benel\b/i, 'Enel'],
  [/\bsedapal\b/i, 'Sedapal'],
];

const rejectedTransaction =
  /\b(saldo insuficiente|fondos insuficientes|compra rechazada|se rechaz[oó] tu compra|transacci[oó]n rechazada|operaci[oó]n rechazada|operaci[oó]n no realizada|transacci[oó]n denegada|compra denegada|no pudimos procesar|no se pudo procesar|declinad[oa])\b/i;

const marketingOffer =
  /\b(precalifica|precalificaci[oó]n|cr[eé]dito preaprobado|pr[eé]stamo preaprobado|pr[eé]stamo para ti|solicita tu pr[eé]stamo|obt[eé]n tu pr[eé]stamo|100% digital|preventa activa|te extrañamos|hace tiempo no nos visitas|aprovecha esta oferta|oferta exclusiva|promoci[oó]n exclusiva|gana(?:r)?|puntos?|millas?|participa|sorteo|premio|descuentos?|beneficio(?:s)?|ll[eé]vate|regalo con tu compra|pr[oó]xima compra|compra favorita|escoge tu premio|cambia[^\n]{0,80}y gana|pasajes?[^\n]{0,80}desde|desde\s+(?:s\/?\.?|us\$|usd)|hasta\s+[0-9.,]+\s+(?:puntos?|millas?))\b/i;

const subscriptionCancellation =
  /\b(cancelaci[oó]n de (?:tu )?(?:membres[ií]a|suscripci[oó]n)|membres[ií]a (?:ha )?termin[oó]|suscripci[oó]n (?:ha sido )?cancelada|te has desafiliado|desafiliaci[oó]n|dar de baja|dimos de baja|cancelaste (?:tu )?(?:membres[ií]a|suscripci[oó]n))\b/i;

const documentOnly =
  /\b(nuevo comprobante electr[oó]nico|te enviamos tu nuevo comprobante|comprobante electr[oó]nico|boleta electr[oó]nica|documento electr[oó]nico)\b/i;

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
  if (!Number.isFinite(number) || number <= 0 || number > 100_000_000) return undefined;
  return Math.round(number * 100);
}

function parseMoneyToken(token: string, raw: string) {
  const amountMinor = amountToMinor(raw);
  if (amountMinor === undefined) return undefined;
  const upper = token.toUpperCase();
  const currency: 'PEN' | 'USD' =
    upper.includes('US') || upper === 'USD' || upper === '$' ? 'USD' : 'PEN';
  return { amountMinor, currency };
}

function money(text: string) {
  const pattern = /(S\/?\.?|PEN|US\$|USD|\$)\s*([0-9](?:[0-9.,]*[0-9])?)/gi;
  for (const match of text.matchAll(pattern)) {
    const parsed = parseMoneyToken(match[1]!, match[2]!);
    if (parsed) return parsed;
  }
  return undefined;
}

function statementMoney(text: string) {
  const labels =
    /(pago total|total a pagar|monto total|saldo total|pago m[ií]nimo|monto m[ií]nimo|cuota del mes|monto de la cuota)/gi;
  for (const label of text.matchAll(labels)) {
    const start = label.index ?? 0;
    const window = text.slice(start, start + 120);
    const detected = money(window);
    if (detected) return detected;
  }
  return money(text);
}

function namedMatch(text: string, rules: readonly (readonly [RegExp, string])[]) {
  for (const [pattern, name] of rules) if (pattern.test(text)) return name;
  return undefined;
}

function classify(
  text: string,
  hasAmount: boolean,
  recurringMerchant?: string,
  billedServiceMerchant?: string,
): { kind: FinancialMailKind; confidence: number } | undefined {
  if (!hasAmount) return undefined;

  if (
    /\b(estado de cuenta|fecha de corte|pago m[ií]nimo|pago total|total a pagar|saldo (?:de|en) (?:tu )?tarjeta|monto total a pagar)\b/i.test(
      text,
    )
  )
    return { kind: 'card_statement', confidence: 94 };

  const recurringLanguage =
    /\b(cobro recurrente|cargo recurrente|pago recurrente|renovaci[oó]n autom[aá]tica|renovaci[oó]n cobrada|pr[oó]ximo cobro|membres[ií]a mensual|suscripci[oó]n mensual|plan mensual)\b/i.test(
      text,
    );
  if (recurringMerchant && (recurringLanguage || /\b(cargo|cobro|pago|compra)\b/i.test(text)))
    return { kind: 'subscription', confidence: 94 };
  if (recurringLanguage) return { kind: 'subscription', confidence: 89 };

  if (
    /\b(constancia de pago de tarjeta|pago de (?:tu )?tarjeta|pago realizado|pago procesado|pagaste (?:tu )?tarjeta|abonaste (?:a )?(?:tu )?tarjeta)\b/i.test(
      text,
    )
  )
    return { kind: 'payment', confidence: 91 };

  if (
    /\b(compra (?:realizada|aprobada)(?: con (?:tu )?tarjeta)?|consumo (?:realizado|aprobado).*tarjeta|operaci[oó]n.*tarjeta|cargo (?:realizado|procesado).*tarjeta|compra con (?:tu )?tarjeta)\b/i.test(
      text,
    )
  )
    return { kind: 'card_charge', confidence: 92 };

  if (
    /\b(transferencia recibida|dep[oó]sito recibido|abono recibido|pago recibido|sueldo|remuneraci[oó]n|abono en (?:tu )?cuenta)\b/i.test(
      text,
    )
  )
    return { kind: 'income', confidence: 90 };

  if (/\b(transferencia realizada|transferencia enviada|yape|plin)\b/i.test(text))
    return { kind: 'transfer', confidence: 82 };

  if (
    /\b(cuota vencida|cuota por pagar|saldo pendiente|deuda pendiente|vencimiento de cuota|monto de la cuota)\b/i.test(
      text,
    )
  )
    return { kind: 'debt', confidence: 88 };

  if (
    billedServiceMerchant &&
    /\b(recibo|factura|servicio|monto a pagar|importe|vencimiento)\b/i.test(text)
  )
    return { kind: 'expense', confidence: 88 };

  if (
    /\b(compra realizada|consumo realizado|cargo realizado|cargo procesado|retiro realizado|d[eé]bito realizado|pago realizado)\b/i.test(
      text,
    )
  )
    return { kind: 'expense', confidence: 83 };

  return undefined;
}

export function parseFinancialMail(input: FinancialMailInput): ParsedFinancialMail | undefined {
  if (!Number.isFinite(Date.parse(input.receivedAt))) return undefined;
  const sender = compact(input.sender, 512);
  const subject = compact(input.subject, 1024);
  const snippet = compact(input.snippet, 2048);
  const text = `${sender}\n${subject}\n${snippet}`;

  if (
    rejectedTransaction.test(text) ||
    marketingOffer.test(text) ||
    subscriptionCancellation.test(text)
  )
    return undefined;

  const bank = namedMatch(text, institutionRules);
  const recurringMerchant = namedMatch(text, subscriptionMerchants);
  const billedServiceMerchant = namedMatch(text, billedServiceMerchants);
  const statementContext =
    /\b(estado de cuenta|pago m[ií]nimo|pago total|total a pagar|saldo (?:de|en) (?:tu )?tarjeta)\b/i.test(
      text,
    );
  const detectedMoney = statementContext ? statementMoney(text) : money(text);

  if (
    documentOnly.test(text) &&
    !/\b(pago|cargo|compra|consumo|d[eé]bito) (?:realizado|procesado|aprobado)\b/i.test(text)
  )
    return undefined;

  const category = classify(text, Boolean(detectedMoney), recurringMerchant, billedServiceMerchant);
  if (!category || !detectedMoney) return undefined;

  const merchant = recurringMerchant ?? billedServiceMerchant;
  const confidence = Math.min(99, category.confidence + (bank ? 3 : 0));
  const summary = compact(subject || snippet || `${category.kind} detectado`, 512);
  const fingerprint = createHash('sha256')
    .update(
      [
        input.messageId,
        category.kind,
        bank ?? '',
        merchant ?? '',
        detectedMoney.currency,
        detectedMoney.amountMinor.toString(),
      ].join('|'),
    )
    .digest('hex');
  return {
    kind: category.kind,
    ...(bank ? { institution: bank } : {}),
    ...(merchant ? { merchant } : {}),
    currency: detectedMoney.currency,
    amountMinor: detectedMoney.amountMinor,
    occurredAt: new Date(input.receivedAt).toISOString(),
    confidence,
    fingerprint,
    summary,
  };
}
