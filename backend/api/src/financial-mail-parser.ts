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
  | 'refund'
  | 'unknown';

export interface FinancialMailInput {
  messageId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  labels?: readonly string[];
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
  /\b(saldo insuficiente|fondos insuficientes|compra rechazada|se rechaz[oó] tu compra|transacci[oó]n rechazada|operaci[oó]n rechazada|operaci[oó]n no realizada|transacci[oó]n denegada|compra denegada|no pudimos procesar|no se pudo procesar|declinad[oa]|error (?:en el |de )?pago|pago pendiente|tiene un pago pendiente|a[uú]n no se pag[oó]|no se realiz[oó] el pago)\b/i;

const marketingOffer =
  /\b(precalifica|precalificaci[oó]n|cr[eé]dito preaprobado|pr[eé]stamo preaprobado|pr[eé]stamo para ti|solicita tu pr[eé]stamo|obt[eé]n tu pr[eé]stamo|100% digital|preventa activa|te extrañamos|hace tiempo no nos visitas|aprovecha esta oferta|oferta exclusiva|promoci[oó]n exclusiva|gana(?:r)?|puntos?|millas?|participa|sorteo|premio|descuentos?|dscto(?:s)?|beneficio(?:s)?|ll[eé]vate|regalo con tu compra|pr[oó]xima compra|compra favorita|escoge tu premio|cambia[^\n]{0,80}y gana|pasajes?[^\n]{0,80}desde|desde\s+(?:s\/?\.?|us\$|usd)|hasta\s+[0-9.,]+\s+(?:puntos?|millas?)|prueba[^\n]{0,80}sin costo|promo(?:s)? exclusiva(?:s)?)\b/i;

const surveyOrServiceMessage =
  /\b(encuesta|tu opini[oó]n|conocer tu opini[oó]n|califica tu experiencia|ay[uú]danos a mejorar|queremos brindarte el mejor producto|respuesta a reclamo|certificado de no adeudo)\b/i;

const futureNotice =
  /\b(tu suscripci[oó]n est[aá] por vencer|suscripci[oó]n vencer[aá] pronto|vencimiento de la suscripci[oó]n|se cobrar[aá] ma[nñ]ana|se cobrar[aá] en \d+ d[ií]as?|faltan \d+ d[ií]as? para (?:el )?cobro|pr[oó]ximo cobro|recordatorio de pago|vence pronto)\b/i;

const interbankAccessLoan = /\b(?:ibk\s+)?visa access\b/i;

const subscriptionCancellation =
  /\b(cancelaci[oó]n de (?:tu )?(?:membres[ií]a|suscripci[oó]n)|membres[ií]a (?:ha )?termin[oó]|suscripci[oó]n (?:ha sido )?cancelada|te has desafiliado|desafiliaci[oó]n|dar de baja|dimos de baja|cancelaste (?:tu )?(?:membres[ií]a|suscripci[oó]n))\b/i;

const documentOnly =
  /\b(has recibido una boleta|facturaci[oó]n electr[oó]nica|nuevo comprobante electr[oó]nico|te enviamos tu nuevo comprobante|comprobante electr[oó]nico|boleta electr[oó]nica|documento electr[oó]nico)\b/i;

const refundExecuted =
  /\b(realizamos (?:una )?devoluci[oó]n|se ha devuelto (?:el )?monto|monto total devuelto|devoluci[oó]n (?:realizada|procesada|completada)|reembolso (?:realizado|procesado|completado)|reversi[oó]n (?:realizada|procesada)|reverso (?:realizado|procesado)|extorno (?:realizado|procesado))\b/i;

const savingsTransfer =
  /\b(retiro (?:de|desde) tu guardadito|retiraste (?:dinero )?(?:de|desde) tu guardadito|moviste dinero (?:de|desde) tu ahorro|transferiste (?:de|desde) tu ahorro)\b/i;

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

function merchantFromBankNotification(text: string) {
  const patterns = [
    /\bcomercio\s*:\s*([^\n]{2,120}?)(?=\s+(?:monto|importe|fecha|hora)\s*:|$)/i,
    /\b(?:consumo|compra)\s+de\s+(?:s\/?\.?|pen|us\$|usd|\$)\s*[0-9.,]+[^\n]{0,80}?\ben\s+(.{2,120}?)(?=\.\s*(?:por tu seguridad|datos de la operaci[oó]n)|$)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const merchant = compact(match[1].replace(/[|<>]/g, ' '), 120);
    if (merchant) return merchant;
  }
  return undefined;
}

function classify(
  text: string,
  hasAmount: boolean,
  recurringMerchant?: string,
  billedServiceMerchant?: string,
): { kind: FinancialMailKind; confidence: number } | undefined {
  if (!hasAmount) return undefined;

  if (refundExecuted.test(text)) return { kind: 'refund', confidence: 98 };
  if (savingsTransfer.test(text)) return { kind: 'transfer', confidence: 95 };

  // Visa Access de Interbank se modela como préstamo/deuda, no como tarjeta de crédito.
  if (interbankAccessLoan.test(text)) return { kind: 'debt', confidence: 96 };

  if (
    /\b(estado de cuenta|fecha de corte|pago m[ií]nimo|pago total|total a pagar|saldo (?:de|en) (?:tu )?tarjeta|monto total a pagar)\b/i.test(
      text,
    )
  )
    return { kind: 'card_statement', confidence: 94 };

  const recurringExecuted =
    /\b(cobro recurrente(?: realizado| procesado)?|cargo recurrente(?: realizado| procesado)?|pago recurrente(?: realizado| procesado)?|renovaci[oó]n (?:autom[aá]tica )?(?:cobrada|procesada|realizada)|se realiz[oó] el cobro recurrente|membres[ií]a mensual[^\n]{0,100}(?:cobrada|renovada|se renov[oó])|suscripci[oó]n mensual[^\n]{0,100}(?:cobrada|renovada|se renov[oó])|plan mensual[^\n]{0,100}(?:cobrado|renovado|se renov[oó]))\b/i.test(
      text,
    );
  const receiptForKnownSubscription =
    Boolean(recurringMerchant) &&
    /\b(recibo|factura|renovaci[oó]n|se renov[oó]|membres[ií]a|suscripci[oó]n)\b/i.test(text) &&
    !futureNotice.test(text);
  if (recurringMerchant && (recurringExecuted || receiptForKnownSubscription))
    return { kind: 'subscription', confidence: 94 };
  if (recurringExecuted) return { kind: 'subscription', confidence: 89 };

  if (
    /\b(constancia de pago de tarjeta|pago de (?:tu )?tarjeta (?:realizado|procesado|completado)|pagaste (?:tu )?tarjeta|abonaste (?:a )?(?:tu )?tarjeta)\b/i.test(
      text,
    )
  )
    return { kind: 'payment', confidence: 93 };

  const executedCardActivity =
    /\b(compra (?:realizada|aprobada)(?: con (?:tu )?tarjeta)?|consumo (?:realizado|aprobado)|realizaste un consumo|cargo (?:realizado|procesado).*tarjeta|compra con (?:tu )?tarjeta)\b/i.test(
      text,
    );
  if (executedCardActivity && /\btarjeta de d[eé]bito\b/i.test(text))
    return { kind: 'expense', confidence: 96 };
  if (
    executedCardActivity &&
    /\b(tarjeta de cr[eé]dito|tarjeta interbank|visa platinum|visa infinite|mastercard|diners|cmr)\b/i.test(
      text,
    )
  )
    return { kind: 'card_charge', confidence: 96 };
  if (executedCardActivity && /\btarjeta\b/i.test(text))
    return { kind: 'card_charge', confidence: 90 };

  if (
    /\b(transferencia recibida|dep[oó]sito recibido|abono recibido|pago recibido|sueldo|remuneraci[oó]n|abono en (?:tu )?cuenta)\b/i.test(
      text,
    )
  )
    return { kind: 'income', confidence: 90 };

  if (
    /\b(transferencia realizada|transferencia enviada|enviaste (?:un )?(?:yape|plin)|realizaste (?:un )?(?:yape|plin))\b/i.test(
      text,
    )
  )
    return { kind: 'transfer', confidence: 88 };

  if (
    /\b(cuota vencida|cuota por pagar|saldo pendiente|deuda pendiente|vencimiento de cuota|monto de la cuota)\b/i.test(
      text,
    )
  )
    return { kind: 'debt', confidence: 88 };

  if (
    billedServiceMerchant &&
    /\b(pago (?:realizado|procesado|completado)|cargo (?:realizado|procesado)|se debit[oó]|pagaste|cancelaste el recibo)\b/i.test(
      text,
    )
  )
    return { kind: 'expense', confidence: 92 };

  if (
    /\b(compra realizada|consumo realizado|cargo realizado|cargo procesado|retiro realizado|d[eé]bito realizado|pago realizado)\b/i.test(
      text,
    )
  )
    return { kind: 'expense', confidence: 84 };

  return undefined;
}

export function parseFinancialMail(input: FinancialMailInput): ParsedFinancialMail | undefined {
  if (!Number.isFinite(Date.parse(input.receivedAt))) return undefined;
  if (input.labels?.includes('CATEGORY_PROMOTIONS')) return undefined;

  const sender = compact(input.sender, 512);
  const subject = compact(input.subject, 1024);
  const snippet = compact(input.snippet, 2048);
  const text = `${sender}\n${subject}\n${snippet}`;

  if (
    rejectedTransaction.test(text) ||
    marketingOffer.test(text) ||
    surveyOrServiceMessage.test(text) ||
    futureNotice.test(text) ||
    subscriptionCancellation.test(text) ||
    documentOnly.test(text)
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
  const category = classify(text, Boolean(detectedMoney), recurringMerchant, billedServiceMerchant);
  if (!category || !detectedMoney) return undefined;

  const merchant = recurringMerchant ?? billedServiceMerchant ?? merchantFromBankNotification(text);
  const confidence = Math.min(99, category.confidence + (bank ? 2 : 0));
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
