import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { GMAIL_READONLY_SCOPE, type GmailConnectionService } from './gmail-controller';
import { GmailSecrets } from './gmail-secrets';
import { parseFinancialMail } from './financial-mail-parser';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^[^\s]{1,4096}$/;

interface GmailServiceOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  appReturnUrl: string;
  maxMessages?: number;
  transport?: typeof fetch;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function userId(value: string) {
  if (!UUID.test(value)) throw new Error('Invalid Gmail user');
  return value.toLowerCase();
}

function plainHttpsUrl(value: string, name: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error(`${name} must use HTTPS`);
  return url;
}

function text(value: unknown, max: number) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Gmail response');
  return value as Record<string, unknown>;
}

export class LiveGmailService implements GmailConnectionService {
  private readonly transport: typeof fetch;
  private readonly redirectUri: string;
  private readonly appReturnUrl: string;
  private readonly maxMessages: number;

  constructor(
    private readonly pool: Pool,
    private readonly secrets: GmailSecrets,
    private readonly options: GmailServiceOptions,
  ) {
    if (!options.clientId || options.clientId.length > 512)
      throw new Error('Invalid Gmail client id');
    if (!options.clientSecret || options.clientSecret.length > 1024)
      throw new Error('Invalid Gmail client secret');
    this.redirectUri = plainHttpsUrl(options.redirectUri, 'Gmail redirect URI').href;
    this.appReturnUrl = plainHttpsUrl(options.appReturnUrl, 'Gmail app return URL').href;
    this.maxMessages = Math.min(Math.max(options.maxMessages ?? 1500, 100), 5000);
    this.transport = options.transport ?? fetch;
  }

  async connection(rawUserId: string) {
    const id = userId(rawUserId);
    const row = await this.pool.query(
      `SELECT email,scope,range_days,state,last_sync_at,coverage_from,coverage_to
         FROM app.gmail_connections WHERE user_id=$1`,
      [id],
    );
    if (row.rowCount === 0)
      return { state: 'disconnected', scope: GMAIL_READONLY_SCOPE, rangeDays: 30 };
    const value = row.rows[0] as Record<string, unknown>;
    return {
      state: value['state'],
      scope: GMAIL_READONLY_SCOPE,
      rangeDays: Number(value['range_days']),
      ...(typeof value['email'] === 'string' ? { email: value['email'] } : {}),
      ...(value['last_sync_at'] instanceof Date
        ? { lastSyncAt: value['last_sync_at'].toISOString() }
        : {}),
      ...(value['coverage_from'] instanceof Date
        ? { coverageFrom: isoDate(value['coverage_from']) }
        : typeof value['coverage_from'] === 'string'
          ? { coverageFrom: value['coverage_from'].slice(0, 10) }
          : {}),
      ...(value['coverage_to'] instanceof Date
        ? { coverageTo: isoDate(value['coverage_to']) }
        : typeof value['coverage_to'] === 'string'
          ? { coverageTo: value['coverage_to'].slice(0, 10) }
          : {}),
    };
  }

  async start(rawUserId: string, rangeDays: number) {
    const id = userId(rawUserId);
    const state = randomBytes(32).toString('base64url');
    await this.pool.query(
      'DELETE FROM app.gmail_oauth_flows WHERE expires_at <= now() OR user_id=$1',
      [id],
    );
    await this.pool.query(
      `INSERT INTO app.gmail_oauth_flows(state_hash,user_id,range_days)
       VALUES($1,$2,$3)`,
      [sha256(state), id, rangeDays],
    );
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GMAIL_READONLY_SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'false');
    url.searchParams.set('state', state);
    return { authorizationUrl: url.href };
  }

  async complete(state: string, code: string) {
    if (!STATE.test(state) || !CODE.test(code)) throw new Error('Invalid Gmail callback');
    const client = await this.pool.connect();
    let authorization: { id: string; rangeDays: number } | undefined;
    try {
      await client.query('BEGIN');
      const flow = await client.query(
        `SELECT user_id,range_days FROM app.gmail_oauth_flows
         WHERE state_hash=$1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
        [sha256(state)],
      );
      if (flow.rowCount !== 1) throw new Error('Gmail authorization expired');
      const id = userId(String(flow.rows[0].user_id));
      const rangeDays = Number(flow.rows[0].range_days);
      await client.query('UPDATE app.gmail_oauth_flows SET used_at=now() WHERE state_hash=$1', [
        sha256(state),
      ]);
      await client.query('COMMIT');
      authorization = { id, rangeDays };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    if (!authorization) throw new Error('Gmail authorization expired');
    const { id, rangeDays } = authorization;
    const token = await this.exchangeCode(code);
    const profile = await this.profile(token.accessToken);
    await this.pool.query(
      `INSERT INTO app.gmail_connections(
          user_id,email,scope,range_days,refresh_token_envelope,state,updated_at
       ) VALUES($1,$2,$3,$4,$5,'connected',now())
       ON CONFLICT(user_id) DO UPDATE SET
         email=EXCLUDED.email,
         scope=EXCLUDED.scope,
         range_days=EXCLUDED.range_days,
         refresh_token_envelope=EXCLUDED.refresh_token_envelope,
         state='connected',
         updated_at=now()`,
      [id, profile, GMAIL_READONLY_SCOPE, rangeDays, this.secrets.seal(id, token.refreshToken)],
    );
    await this.sync(id);
    return this.appReturnUrl;
  }

  async sync(rawUserId: string) {
    const id = userId(rawUserId);
    const result = await this.pool.query(
      `SELECT refresh_token_envelope,range_days,state FROM app.gmail_connections WHERE user_id=$1`,
      [id],
    );
    if (result.rowCount !== 1 || result.rows[0].state !== 'connected')
      throw new Error('Gmail is not connected');
    const refreshToken = this.secrets.open(id, result.rows[0].refresh_token_envelope);
    let accessToken: string;
    try {
      accessToken = await this.refresh(refreshToken);
    } catch (error) {
      await this.pool.query(
        `UPDATE app.gmail_connections SET state='reauthorization_required',updated_at=now() WHERE user_id=$1`,
        [id],
      );
      throw error;
    }
    const rangeDays = Number(result.rows[0].range_days);
    const now = new Date();
    const from = new Date(now.getTime() - rangeDays * 86_400_000);
    let pageToken: string | undefined;
    let processed = 0;
    do {
      const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
      url.searchParams.set('maxResults', '100');
      url.searchParams.set('includeSpamTrash', 'false');
      url.searchParams.set('q', `after:${isoDate(from).replaceAll('-', '/')}`);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const page = jsonRecord(await this.googleJson(url, accessToken));
      const messages = Array.isArray(page['messages']) ? page['messages'] : [];
      for (const item of messages) {
        if (processed >= this.maxMessages) break;
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const messageId = text((item as Record<string, unknown>)['id'], 128);
        if (!messageId) continue;
        await this.ingestMessage(id, messageId, accessToken);
        processed++;
      }
      pageToken =
        processed < this.maxMessages && typeof page['nextPageToken'] === 'string'
          ? page['nextPageToken']
          : undefined;
    } while (pageToken);
    await this.pool.query(
      `UPDATE app.gmail_connections SET
         last_sync_at=now(),coverage_from=$2::date,coverage_to=$3::date,updated_at=now()
       WHERE user_id=$1`,
      [id, isoDate(from), isoDate(now)],
    );
  }

  async disconnect(rawUserId: string) {
    const id = userId(rawUserId);
    await this.pool.query('DELETE FROM app.gmail_oauth_flows WHERE user_id=$1', [id]);
    await this.pool.query(
      `UPDATE app.gmail_connections SET
         refresh_token_envelope=NULL,email=NULL,state='disconnected',last_sync_at=NULL,
         coverage_from=NULL,coverage_to=NULL,updated_at=now()
       WHERE user_id=$1`,
      [id],
    );
  }

  async candidates(rawUserId: string, status = 'pending') {
    const id = userId(rawUserId);
    if (!['pending', 'confirmed', 'discarded', 'all'].includes(status))
      throw new Error('Invalid candidate status');
    const result = await this.pool.query(
      `SELECT id,source_message_id,kind,institution,merchant,currency,amount_minor,
              occurred_at,due_at,confidence,status,summary,created_at
         FROM app.gmail_financial_candidates
        WHERE user_id=$1 AND ($2='all' OR status=$2)
        ORDER BY occurred_at DESC,id DESC LIMIT 500`,
      [id, status],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      sourceMessageId: String(row.source_message_id),
      kind: String(row.kind),
      ...(typeof row.institution === 'string' ? { institution: row.institution } : {}),
      ...(typeof row.merchant === 'string' ? { merchant: row.merchant } : {}),
      ...(typeof row.currency === 'string' ? { currency: row.currency } : {}),
      ...(row.amount_minor !== null ? { amountMinor: String(row.amount_minor) } : {}),
      occurredAt: new Date(row.occurred_at).toISOString(),
      ...(row.due_at
        ? {
            dueAt:
              row.due_at instanceof Date ? isoDate(row.due_at) : String(row.due_at).slice(0, 10),
          }
        : {}),
      confidence: Number(row.confidence),
      status: String(row.status),
      summary: String(row.summary),
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async review(rawUserId: string, candidateId: string, status: 'confirmed' | 'discarded') {
    const id = userId(rawUserId);
    if (!UUID.test(candidateId)) throw new Error('Invalid Gmail candidate');
    const result = await this.pool.query(
      `UPDATE app.gmail_financial_candidates SET status=$3,reviewed_at=now()
        WHERE user_id=$1 AND id=$2 AND status='pending'`,
      [id, candidateId, status],
    );
    if (result.rowCount !== 1) throw new Error('Gmail candidate is no longer pending');
  }

  private async ingestMessage(id: string, messageId: string, accessToken: string) {
    const url = new URL(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
    );
    url.searchParams.set('format', 'metadata');
    for (const header of ['From', 'Subject', 'Date'])
      url.searchParams.append('metadataHeaders', header);
    const data = jsonRecord(await this.googleJson(url, accessToken));
    const payload =
      data['payload'] && typeof data['payload'] === 'object' && !Array.isArray(data['payload'])
        ? (data['payload'] as Record<string, unknown>)
        : {};
    const headers = Array.isArray(payload['headers']) ? payload['headers'] : [];
    const header = (name: string) => {
      const found = headers.find(
        (value) =>
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          String((value as Record<string, unknown>)['name']).toLowerCase() === name.toLowerCase(),
      ) as Record<string, unknown> | undefined;
      return text(found?.['value'], name === 'Subject' ? 1024 : 512);
    };
    const sender = header('From');
    const subject = header('Subject');
    const snippet = text(data['snippet'], 2048);
    const internal =
      typeof data['internalDate'] === 'string' && /^\d{10,16}$/.test(data['internalDate'])
        ? Number(data['internalDate'])
        : NaN;
    const fallbackDate = Date.parse(header('Date'));
    const receivedAt = new Date(Number.isFinite(internal) ? internal : fallbackDate);
    if (!Number.isFinite(receivedAt.getTime())) return;
    const threadId = text(data['threadId'], 128) || null;
    const contentHash = sha256([sender, subject, snippet, receivedAt.toISOString()].join('\u0000'));
    await this.pool.query(
      `INSERT INTO app.gmail_messages(
         user_id,message_id,thread_id,sender,subject,snippet,received_at,content_hash
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(user_id,message_id) DO UPDATE SET
         thread_id=EXCLUDED.thread_id,sender=EXCLUDED.sender,subject=EXCLUDED.subject,
         snippet=EXCLUDED.snippet,received_at=EXCLUDED.received_at,content_hash=EXCLUDED.content_hash`,
      [id, messageId, threadId, sender, subject, snippet, receivedAt.toISOString(), contentHash],
    );
    const candidate = parseFinancialMail({
      messageId,
      sender,
      subject,
      snippet,
      receivedAt: receivedAt.toISOString(),
    });
    if (!candidate) return;
    await this.pool.query(
      `INSERT INTO app.gmail_financial_candidates(
         id,user_id,source_message_id,kind,institution,merchant,currency,amount_minor,
         occurred_at,confidence,fingerprint,summary
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(user_id,fingerprint) DO NOTHING`,
      [
        randomUUID(),
        id,
        messageId,
        candidate.kind,
        candidate.institution ?? null,
        candidate.merchant ?? null,
        candidate.currency ?? null,
        candidate.amountMinor ?? null,
        candidate.occurredAt,
        candidate.confidence,
        candidate.fingerprint,
        candidate.summary,
      ],
    );
  }

  private async exchangeCode(code: string) {
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
      code,
    });
    const response = await this.transport('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const data = (await response.json().catch(() => null)) as TokenResponse | null;
    if (!response.ok || !data) throw new Error('Google did not accept the Gmail authorization');
    if (
      typeof data.access_token !== 'string' ||
      typeof data.refresh_token !== 'string' ||
      !data.refresh_token ||
      typeof data.scope !== 'string' ||
      !new Set(data.scope.split(/\s+/)).has(GMAIL_READONLY_SCOPE)
    )
      throw new Error('Google did not return the required Gmail readonly grant');
    return { accessToken: data.access_token, refreshToken: data.refresh_token };
  }

  private async refresh(refreshToken: string) {
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const response = await this.transport('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const data = (await response.json().catch(() => null)) as TokenResponse | null;
    if (!response.ok || !data || typeof data.access_token !== 'string')
      throw new Error('Gmail authorization must be renewed');
    return data.access_token;
  }

  private async profile(accessToken: string) {
    const data = jsonRecord(
      await this.googleJson(
        new URL('https://gmail.googleapis.com/gmail/v1/users/me/profile'),
        accessToken,
      ),
    );
    const email = text(data['emailAddress'], 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid Gmail profile');
    return email;
  }

  private async googleJson(url: URL, accessToken: string) {
    const response = await this.transport(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Gmail request failed (${response.status})`);
    return response.json() as Promise<unknown>;
  }
}
