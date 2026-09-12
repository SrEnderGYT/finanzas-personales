export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly' as const;

export type GmailConnectionState = 'disconnected' | 'connected' | 'reauthorization_required';

export interface GmailConnectionSnapshot {
  state: GmailConnectionState;
  email?: string;
  scope: typeof GMAIL_READONLY_SCOPE;
  rangeDays: number;
  lastSyncAt?: string;
  coverageFrom?: string;
  coverageTo?: string;
}

export interface GmailOAuthStart {
  authorizationUrl: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('GMAIL_INVALID_RESPONSE');
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('GMAIL_INVALID_RESPONSE');
}

function optionalInstant(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new Error('GMAIL_INVALID_RESPONSE');
  return value;
}

function coverageDate(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('GMAIL_INVALID_RESPONSE');
  return value;
}

export function gmailRangeDays(value: unknown): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1 || value > 365)
    throw new Error('GMAIL_INVALID_RANGE');
  return value;
}

export function normalizeGmailConnection(value: unknown): GmailConnectionSnapshot {
  const input = record(value);
  exactKeys(input, [
    'state',
    'email',
    'scope',
    'rangeDays',
    'lastSyncAt',
    'coverageFrom',
    'coverageTo',
  ]);
  if (
    input['state'] !== 'disconnected' &&
    input['state'] !== 'connected' &&
    input['state'] !== 'reauthorization_required'
  )
    throw new Error('GMAIL_INVALID_RESPONSE');
  if (input['scope'] !== GMAIL_READONLY_SCOPE) throw new Error('GMAIL_INVALID_SCOPE');
  const rangeDays = gmailRangeDays(input['rangeDays']);
  const lastSyncAt = optionalInstant(input['lastSyncAt']);
  const coverageFrom = coverageDate(input['coverageFrom']);
  const coverageTo = coverageDate(input['coverageTo']);
  if ((coverageFrom && !coverageTo) || (!coverageFrom && coverageTo))
    throw new Error('GMAIL_INVALID_RESPONSE');
  if (coverageFrom && coverageTo && coverageFrom > coverageTo)
    throw new Error('GMAIL_INVALID_RESPONSE');
  if (input['state'] === 'connected') {
    if (
      typeof input['email'] !== 'string' ||
      input['email'].length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input['email'])
    )
      throw new Error('GMAIL_INVALID_RESPONSE');
  } else if (input['email'] !== undefined && typeof input['email'] !== 'string') {
    throw new Error('GMAIL_INVALID_RESPONSE');
  }
  return {
    state: input['state'],
    scope: GMAIL_READONLY_SCOPE,
    rangeDays,
    ...(typeof input['email'] === 'string' ? { email: input['email'] } : {}),
    ...(lastSyncAt ? { lastSyncAt } : {}),
    ...(coverageFrom ? { coverageFrom } : {}),
    ...(coverageTo ? { coverageTo } : {}),
  };
}

export function normalizeGmailOAuthStart(value: unknown): GmailOAuthStart {
  const input = record(value);
  exactKeys(input, ['authorizationUrl']);
  if (typeof input['authorizationUrl'] !== 'string') throw new Error('GMAIL_INVALID_RESPONSE');
  const url = new URL(input['authorizationUrl']);
  if (
    url.origin !== 'https://accounts.google.com' ||
    url.pathname !== '/o/oauth2/v2/auth' ||
    url.username ||
    url.password
  )
    throw new Error('GMAIL_INVALID_AUTHORIZATION_URL');
  const scopes = new Set((url.searchParams.get('scope') ?? '').split(/\s+/).filter(Boolean));
  if (!scopes.has(GMAIL_READONLY_SCOPE)) throw new Error('GMAIL_INVALID_SCOPE');
  return { authorizationUrl: url.href };
}
