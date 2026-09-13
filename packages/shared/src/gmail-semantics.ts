import type { GmailFinancialCandidate } from './gmail-candidates';

export type AutomaticFinanceCategory =
  | 'Ingresos'
  | 'Comida y delivery'
  | 'Supermercado'
  | 'Transporte'
  | 'Viajes'
  | 'Suscripciones'
  | 'Servicios'
  | 'Entretenimiento'
  | 'Compras'
  | 'Hogar'
  | 'Salud'
  | 'Educación'
  | 'Seguros y finanzas'
  | 'Devoluciones'
  | 'Otros';

function fold(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es-PE')
    .replace(/\s+/g, ' ')
    .trim();
}

const NON_MOVEMENT =
  /\b(gana(?:r)?|sorteo|premio|millas?|puntos?|descuentos?|dscto|promocion|oferta|beneficio|preventa|encuesta|tu opinion|califica tu experiencia|por vencer|vencera pronto|se cobrara (?:manana|en \d+ dias?)|faltan \d+ dias? para el cobro|error (?:en el )?pago|pago pendiente|aun no se pago|no se pudo procesar|has recibido una boleta|facturacion electronica|nuevo comprobante electronico|comprobante electronico|certificado de no adeudo|respuesta a reclamo)\b/i;

const CATEGORY_RULES: readonly [RegExp, AutomaticFinanceCategory][] = [
  [
    /\b(rappi|pedidosya|delivery|restaurant|restaurante|caf[eé]|starbucks|kfc|bembos|mcdonald|burger king|papa john|pizza hut)\b/i,
    'Comida y delivery',
  ],
  [/\b(wong|plaza vea|pvea|tottus|metro|vivanda|makro|vega|mass|supermercado)\b/i, 'Supermercado'],
  [
    /\b(uber|didi|yango|cabify|taxi|rides?|beat|inDrive|pasaje urbano|metropolitano)\b/i,
    'Transporte',
  ],
  [
    /\b(latam|jetsmart|sky airline|avianca|airbnb|booking|hotel|hostel|aerolinea|aerol[ií]nea|pasajes?|vuelo)\b/i,
    'Viajes',
  ],
  [
    /\b(chatgpt|openai|spotify|netflix|prime video|amazon prime|disney\+?|hbo|max\.com|youtube premium|icloud|google one|microsoft 365|canva|adobe|dropbox)\b/i,
    'Suscripciones',
  ],
  [
    /\b(luz del sur|enel|sedapal|claro|movistar|entel|win(?:\.pe)?|internet|telefon[ií]a|electricidad|agua)\b/i,
    'Servicios',
  ],
  [
    /\b(cinemark|cineplanet|steam|playstation|xbox|nintendo|hoyoverse|teatro|concierto|ticketmaster)\b/i,
    'Entretenimiento',
  ],
  [/\b(sodimac|promart|maestro|decoraci[oó]n|muebles?|hogar)\b/i, 'Hogar'],
  [/\b(inkafarma|mifarma|farmacia|cl[ií]nica|hospital|laboratorio|doctor|salud)\b/i, 'Salud'],
  [/\b(upc|universidad|udemy|coursera|platzi|curso|educaci[oó]n|instituto)\b/i, 'Educación'],
  [/\b(seguro|interseguro|pac[ií]fico|rimac|mapfre|prima|desgravamen)\b/i, 'Seguros y finanzas'],
  [
    /\b(amazon|mercadolibre|mercado libre|falabella|ripley|oechsle|h&m|zara|ecomputer|izipay|izi\*)\b/i,
    'Compras',
  ],
];

export function isObviousNonMovement(candidate: GmailFinancialCandidate) {
  return NON_MOVEMENT.test(fold(`${candidate.summary} ${candidate.merchant ?? ''}`));
}

export function isReviewableGmailCandidate(candidate: GmailFinancialCandidate) {
  if (!candidate.amountMinor || !candidate.currency) return false;
  return !isObviousNonMovement(candidate);
}

export function isDashboardGmailMovement(candidate: GmailFinancialCandidate) {
  if (!isReviewableGmailCandidate(candidate)) return false;
  return (
    candidate.kind === 'expense' || candidate.kind === 'card_charge' || candidate.kind === 'income'
  );
}

export function automaticCategory(candidate: GmailFinancialCandidate): AutomaticFinanceCategory {
  if (candidate.kind === 'income') return 'Ingresos';
  if (candidate.kind === 'refund') return 'Devoluciones';
  if (candidate.kind === 'subscription') return 'Suscripciones';

  const text = `${candidate.merchant ?? ''} ${candidate.summary}`;
  for (const [pattern, category] of CATEGORY_RULES) if (pattern.test(text)) return category;
  return 'Otros';
}
