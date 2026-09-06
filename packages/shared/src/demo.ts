import type { Currency } from './index';

export const DEMO_TODAY = '2026-09-06';
export const RANGE_OPTIONS = [
  'Hoy',
  '7 días',
  '15 días',
  'Este mes',
  'Mes anterior',
  '3 meses',
  '6 meses',
  '1 año',
  'Personalizado',
] as const;
export type RangeLabel = (typeof RANGE_OPTIONS)[number];
export interface DemoTransaction {
  id: string;
  demo: true;
  date: string;
  merchant: string;
  category: string;
  account: string;
  bank: string;
  currency: Currency;
  minor: string;
  kind: 'expense' | 'income' | 'payment' | 'transfer';
  icon: string;
}
export const DEMO_TRANSACTIONS: readonly DemoTransaction[] = [
  {
    id: 'd1',
    demo: true,
    date: '2026-09-06',
    merchant: 'Mercado del barrio',
    category: 'Supermercado',
    account: 'Cuenta diaria',
    bank: 'Banco DEMO',
    currency: 'PEN',
    minor: '18650',
    kind: 'expense',
    icon: '▦',
  },
  {
    id: 'd2',
    demo: true,
    date: '2026-09-05',
    merchant: 'Café de la esquina',
    category: 'Restaurante',
    account: 'Cuenta diaria',
    bank: 'Banco DEMO',
    currency: 'PEN',
    minor: '2850',
    kind: 'expense',
    icon: '☕',
  },
  {
    id: 'd3',
    demo: true,
    date: '2026-09-04',
    merchant: 'Movilidad urbana',
    category: 'Transporte',
    account: 'Cuenta diaria',
    bank: 'Banco DEMO',
    currency: 'PEN',
    minor: '4200',
    kind: 'expense',
    icon: '↗',
  },
  {
    id: 'd4',
    demo: true,
    date: '2026-09-03',
    merchant: 'Internet hogar DEMO',
    category: 'Servicios',
    account: 'Visa DEMO',
    bank: 'Banco DEMO',
    currency: 'PEN',
    minor: '12900',
    kind: 'expense',
    icon: '⌁',
  },
  {
    id: 'd5',
    demo: true,
    date: '2026-09-02',
    merchant: 'Ingreso de muestra',
    category: 'Ingreso',
    account: 'Cuenta diaria',
    bank: 'Banco DEMO',
    currency: 'PEN',
    minor: '620000',
    kind: 'income',
    icon: '↓',
  },
  {
    id: 'd6',
    demo: true,
    date: '2026-09-02',
    merchant: 'Estudio digital DEMO',
    category: 'Tecnología',
    account: 'Cuenta USD',
    bank: 'Banco DEMO',
    currency: 'USD',
    minor: '2400',
    kind: 'expense',
    icon: '◇',
  },
  {
    id: 'd7',
    demo: true,
    date: '2026-09-01',
    merchant: 'Abono Visa DEMO',
    category: 'Deudas',
    account: 'Cuenta diaria',
    bank: 'Banco DEMO',
    currency: 'PEN',
    minor: '35000',
    kind: 'payment',
    icon: '↔',
  },
  {
    id: 'd8',
    demo: true,
    date: '2026-08-28',
    merchant: 'Librería Horizonte',
    category: 'Educación',
    account: 'Cuenta diaria',
    bank: 'Banco DEMO',
    currency: 'PEN',
    minor: '9600',
    kind: 'expense',
    icon: '▤',
  },
  {
    id: 'd9',
    demo: true,
    date: '2026-08-22',
    merchant: 'Compra de muestra',
    category: 'Compras',
    account: 'Cuenta USD',
    bank: 'Banco DEMO',
    currency: 'USD',
    minor: '4500',
    kind: 'expense',
    icon: '◈',
  },
];
export const CATEGORIES = [
  'Alimentación',
  'Restaurante',
  'Supermercado',
  'Transporte',
  'Taxi',
  'Combustible',
  'Vivienda',
  'Alquiler',
  'Servicios',
  'Tecnología',
  'Educación',
  'Salud',
  'Entretenimiento',
  'Viajes',
  'Ropa',
  'Compras',
  'Suscripciones',
  'Deudas',
  'Ahorro',
  'Otros',
];

/** Demo formatting only. Real Money/ledger is deliberately reserved for P06. */
export function formatMinor(minor: string | bigint, currency: Currency): string {
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '−' : ''}${currency === 'PEN' ? 'S/ ' : 'US$ '}${new Intl.NumberFormat('es-PE').format(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')}`;
}
export function parseDemoAmount(text: string): string {
  if (!/^\d{1,10}([.,]\d{1,2})?$/.test(text.trim()))
    throw new Error('Escribe un importe positivo con hasta dos decimales.');
  const [whole = '0', fraction = ''] = text.trim().replace(',', '.').split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount <= 0n) throw new Error('El importe debe ser mayor que cero.');
  return amount.toString();
}
export function rangeDates(label: RangeLabel, start = '', end = ''): [string, string] {
  const today = new Date(`${DEMO_TODAY}T12:00:00Z`);
  const date = (d: Date) => d.toISOString().slice(0, 10);
  const begin = new Date(today);
  switch (label) {
    case 'Hoy':
      return [DEMO_TODAY, DEMO_TODAY];
    case '7 días':
      begin.setUTCDate(begin.getUTCDate() - 6);
      break;
    case '15 días':
      begin.setUTCDate(begin.getUTCDate() - 14);
      break;
    case 'Este mes':
      begin.setUTCDate(1);
      break;
    case 'Mes anterior':
      return [date(new Date(Date.UTC(2026, 7, 1))), date(new Date(Date.UTC(2026, 8, 0)))];
    case '3 meses':
      begin.setUTCDate(1);
      begin.setUTCMonth(begin.getUTCMonth() - 2);
      break;
    case '6 meses':
      begin.setUTCDate(1);
      begin.setUTCMonth(begin.getUTCMonth() - 5);
      break;
    case '1 año':
      begin.setUTCDate(1);
      begin.setUTCMonth(begin.getUTCMonth() - 11);
      break;
    case 'Personalizado': {
      const valid = (s: string) =>
        /^\d{4}-\d{2}-\d{2}$/.test(s) &&
        !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) &&
        date(new Date(`${s}T12:00:00Z`)) === s;
      if (!valid(start) || !valid(end) || start > end)
        throw new Error('Selecciona un rango válido: inicio anterior o igual al fin.');
      return [start, end];
    }
  }
  return [date(begin), DEMO_TODAY];
}
export function filterDemo(
  rows: readonly DemoTransaction[],
  currency: Currency,
  range: [string, string],
  query = '',
): DemoTransaction[] {
  const q = query.toLocaleLowerCase('es');
  return rows.filter(
    (r) =>
      r.currency === currency &&
      r.date >= range[0] &&
      r.date <= range[1] &&
      [
        r.merchant,
        r.category,
        r.account,
        r.bank,
        r.date,
        r.currency,
        r.kind,
        formatMinor(r.minor, r.currency),
      ]
        .join(' ')
        .toLocaleLowerCase('es')
        .includes(q),
  );
}
export function demoTotals(rows: readonly DemoTransaction[]): {
  income: bigint;
  expense: bigint;
  balance: bigint;
} {
  const currencies = new Set(rows.map((r) => r.currency));
  if (currencies.size > 1) throw new Error('No se pueden sumar monedas distintas.');
  const total = (kind: DemoTransaction['kind']) =>
    rows.filter((r) => r.kind === kind).reduce((n, r) => n + BigInt(r.minor), 0n);
  const income = total('income'),
    expense = total('expense');
  return { income, expense, balance: income - expense };
}
