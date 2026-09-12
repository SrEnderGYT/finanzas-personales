import { describe, expect, it } from 'vitest';
import { parseFinancialMail } from '../backend/api/src/financial-mail-parser';
import { GmailSecrets } from '../backend/api/src/gmail-secrets';
import { normalizeGmailCandidates } from '../packages/shared/src/gmail-candidates';

const USER = '10000000-0000-4000-8000-000000000001';

describe('financial Gmail ingestion', () => {
  it('classifies a BCP card charge without creating a confirmed movement', () => {
    const parsed = parseFinancialMail({
      messageId: 'message-1',
      sender: 'BCP <avisos@bcp.com.pe>',
      subject: 'Compra realizada con tu tarjeta',
      snippet: 'Registramos una compra con tu tarjeta por S/ 186.50.',
      receivedAt: '2026-09-12T03:00:00.000Z',
    });
    expect(parsed).toMatchObject({
      kind: 'card_charge',
      institution: 'BCP',
      currency: 'PEN',
      amountMinor: 18650,
      occurredAt: '2026-09-12T03:00:00.000Z',
    });
    expect(parsed?.confidence).toBeGreaterThanOrEqual(90);
  });

  it('detects subscriptions and debts conservatively and ignores unrelated mail', () => {
    expect(
      parseFinancialMail({
        messageId: 'message-2',
        sender: 'Servicio <billing@example.test>',
        subject: 'Renovación automática de tu suscripción',
        snippet: 'Tu próximo cobro será de US$ 9.99.',
        receivedAt: '2026-09-11T03:00:00.000Z',
      }),
    ).toMatchObject({ kind: 'subscription', currency: 'USD', amountMinor: 999 });

    expect(
      parseFinancialMail({
        messageId: 'message-3',
        sender: 'Banco de la Nación <avisos@example.test>',
        subject: 'Vencimiento de cuota de crédito',
        snippet: 'Tu saldo pendiente incluye una cuota de S/ 350.00.',
        receivedAt: '2026-09-10T03:00:00.000Z',
      }),
    ).toMatchObject({ kind: 'debt', institution: 'Banco de la Nación', amountMinor: 35000 });

    expect(
      parseFinancialMail({
        messageId: 'message-4',
        sender: 'newsletter@example.test',
        subject: 'Noticias de la semana',
        snippet: 'Cinco artículos que pueden interesarte.',
        receivedAt: '2026-09-09T03:00:00.000Z',
      }),
    ).toBeUndefined();
  });

  it('encrypts refresh tokens with user-bound authenticated encryption', () => {
    const secrets = new GmailSecrets(Buffer.alloc(32, 7));
    const envelope = secrets.seal(USER, 'synthetic-refresh-token');
    expect(JSON.stringify(envelope)).not.toContain('synthetic-refresh-token');
    expect(secrets.open(USER, envelope)).toBe('synthetic-refresh-token');
    expect(() => secrets.open('20000000-0000-4000-8000-000000000002', envelope)).toThrow();
  });

  it('rejects malformed financial candidate payloads before rendering them', () => {
    const valid = normalizeGmailCandidates({
      items: [
        {
          id: '10000000-0000-4000-8000-000000000010',
          sourceMessageId: 'gmail-message',
          kind: 'subscription',
          institution: 'Proveedor',
          currency: 'PEN',
          amountMinor: '12900',
          occurredAt: '2026-09-12T03:00:00.000Z',
          confidence: 92,
          status: 'pending',
          summary: 'Renovación de servicio',
          createdAt: '2026-09-12T03:01:00.000Z',
        },
      ],
    });
    expect(valid[0]?.amountMinor).toBe('12900');
    expect(() =>
      normalizeGmailCandidates({ items: [{ ...valid[0], amountMinor: '-1' }] }),
    ).toThrow();
    expect(() =>
      normalizeGmailCandidates({ items: [{ ...valid[0], status: 'approved' }] }),
    ).toThrow();
  });
});
