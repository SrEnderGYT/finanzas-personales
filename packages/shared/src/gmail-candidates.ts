export type GmailFinancialKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'card_charge'
  | 'card_statement'
  | 'subscription'
  | 'debt'
  | 'payment'
  | 'unknown';

export type GmailCandidateStatus = 'pending' | 'confirmed' | 'discarded';

export interface GmailFinancialCandidate {
  id: string;
  sourceMessageId: string;
  kind: GmailFinancialKind;
  institution?: string;
  merchant?: string;
  currency?: 'PEN' | 'USD';
  amountMinor?: string;
  occurredAt: string;
  dueAt?: string;
  confidence: number;
  status: GmailCandidateStatus;
  summary: string;
  createdAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set<GmailFinancialKind>([
  'expense',
  'income',
  'transfer',
  'card_charge',
  'card_statement',
  'subscription',
  'debt',
  'payment',
  'unknown',
]);
const STATUSES = new Set<GmailCandidateStatus>(['pending', 'confirmed', 'discarded']);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('GMAIL_CANDIDATE_INVALID');
  return value as Record<string, unknown>;
}

function optionalText(value: unknown, max: number) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error('GMAIL_CANDIDATE_INVALID');
  return value;
}

function instant(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new Error('GMAIL_CANDIDATE_INVALID');
  return value;
}

export function normalizeGmailCandidates(value: unknown): GmailFinancialCandidate[] {
  const input = record(value);
  if (Object.keys(input).some((key) => key !== 'items') || !Array.isArray(input['items']))
    throw new Error('GMAIL_CANDIDATE_INVALID');
  if (input['items'].length > 500) throw new Error('GMAIL_CANDIDATE_INVALID');
  const seen = new Set<string>();
  return input['items'].map((raw) => {
    const row = record(raw);
    const id = row['id'];
    const sourceMessageId = row['sourceMessageId'];
    const kind = row['kind'];
    const status = row['status'];
    const confidence = row['confidence'];
    const summary = row['summary'];
    if (
      typeof id !== 'string' ||
      !UUID.test(id) ||
      seen.has(id) ||
      typeof sourceMessageId !== 'string' ||
      !sourceMessageId ||
      sourceMessageId.length > 128 ||
      typeof kind !== 'string' ||
      !KINDS.has(kind as GmailFinancialKind) ||
      typeof status !== 'string' ||
      !STATUSES.has(status as GmailCandidateStatus) ||
      typeof confidence !== 'number' ||
      !Number.isInteger(confidence) ||
      confidence < 0 ||
      confidence > 100 ||
      typeof summary !== 'string' ||
      !summary.trim() ||
      summary.length > 512
    )
      throw new Error('GMAIL_CANDIDATE_INVALID');
    seen.add(id);
    const currency = row['currency'];
    if (currency !== undefined && currency !== 'PEN' && currency !== 'USD')
      throw new Error('GMAIL_CANDIDATE_INVALID');
    const amountMinor = row['amountMinor'];
    if (amountMinor !== undefined && (typeof amountMinor !== 'string' || !/^\d{1,20}$/.test(amountMinor)))
      throw new Error('GMAIL_CANDIDATE_INVALID');
    const dueAt = row['dueAt'];
    if (dueAt !== undefined && (typeof dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)))
      throw new Error('GMAIL_CANDIDATE_INVALID');
    return {
      id,
      sourceMessageId,
      kind: kind as GmailFinancialKind,
      status: status as GmailCandidateStatus,
      confidence,
      summary,
      occurredAt: instant(row['occurredAt']),
      createdAt: instant(row['createdAt']),
      ...(optionalText(row['institution'], 160) ? { institution: row['institution'] as string } : {}),
      ...(optionalText(row['merchant'], 240) ? { merchant: row['merchant'] as string } : {}),
      ...(currency ? { currency } : {}),
      ...(amountMinor ? { amountMinor } : {}),
      ...(dueAt ? { dueAt } : {}),
    };
  });
}
