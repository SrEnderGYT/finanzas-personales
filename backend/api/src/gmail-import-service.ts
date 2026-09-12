import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { identifier } from '@finanzas/domain';
import { UserDatabase } from './database';
import { SyncService } from './sync/service';

export interface GmailImportChoices {
  accountId: string;
  categoryId: string;
  note?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stableUuid(value: string) {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function limaDate(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const take = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const date = `${take('year')}-${take('month')}-${take('day')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('GMAIL_IMPORT_DATE');
  return date;
}

function safeNote(value: string) {
  const note = value.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!note || /[\p{Cc}\p{Cf}]/u.test(note)) throw new Error('GMAIL_IMPORT_NOTE');
  return note;
}

export class GmailImportService {
  constructor(
    private readonly authPool: Pool,
    private readonly database: UserDatabase,
  ) {}

  async import(userIdRaw: string, candidateId: string, choices: GmailImportChoices) {
    const userId = identifier(userIdRaw);
    if (!UUID.test(candidateId)) throw new Error('GMAIL_IMPORT_CANDIDATE');
    identifier(choices.accountId);
    identifier(choices.categoryId);

    const result = await this.authPool.query<{
      kind: string;
      institution: string | null;
      currency: 'PEN' | 'USD' | null;
      amount_minor: string | null;
      occurred_at: Date;
      status: string;
      summary: string;
    }>(
      `SELECT kind,institution,currency,amount_minor::text,occurred_at,status,summary
         FROM app.gmail_financial_candidates
        WHERE user_id=$1 AND id=$2`,
      [userId, candidateId],
    );
    const row = result.rows[0];
    if (!row || !['pending', 'confirmed'].includes(row.status))
      throw new Error('GMAIL_IMPORT_CANDIDATE');
    const kind = row.kind === 'income' ? 'income' : ['expense', 'card_charge', 'subscription'].includes(row.kind) ? 'expense' : undefined;
    if (!kind || !row.currency || !row.amount_minor || BigInt(row.amount_minor) <= 0n)
      throw new Error('GMAIL_IMPORT_NOT_POSTABLE');

    const seed = `${userId}:${candidateId}`;
    const summary = safeNote(
      choices.note ?? `${row.institution ? `${row.institution} · ` : ''}${row.summary}`,
    );
    const occurredAt = row.occurred_at.toISOString();
    const command = {
      operationId: stableUuid(`gmail:operation:${seed}`),
      movementId: stableUuid(`gmail:movement:${seed}`),
      deviceId: stableUuid(`gmail:device:${userId}`),
      schemaVersion: 1,
      baseVersion: '0',
      payload: {
        kind,
        accountId: choices.accountId,
        categoryId: choices.categoryId,
        currency: row.currency,
        amountMinor: row.amount_minor,
        businessDate: limaDate(row.occurred_at),
        timezone: 'America/Lima',
        occurredAt,
        note: summary,
      },
    };

    const confirmation = await new SyncService(this.database).execute(userId, command);
    await this.authPool.query(
      `UPDATE app.gmail_financial_candidates
          SET status='confirmed',reviewed_at=coalesce(reviewed_at,now())
        WHERE user_id=$1 AND id=$2 AND status IN ('pending','confirmed')`,
      [userId, candidateId],
    );
    return { ...confirmation, candidateId };
  }
}
