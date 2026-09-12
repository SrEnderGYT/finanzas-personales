import { describe, expect, it } from 'vitest';
import { parseFinancialMail } from '../backend/api/src/financial-mail-parser';
import { GmailSecrets } from '../backend/api/src/gmail-secrets';
import { normalizeGmailCandidates } from '../packages/shared/src/gmail-candidates';

const USER = '10000000-0000-4000-8000-000000000001';
const receivedAt = '2026-09-12T03:00:00.000Z';

function mail(subject: string, snippet: string, sender = 'BCP <avisos@bcp.com.pe>') {
  return parseFinancialMail({
    messageId: `${subject}-${snippet}`.slice(0, 128),
    sender,
    subject,
    snippet,
    receivedAt,
  });
}

describe('financial Gmail ingestion', () => {
  it('classifies a confirmed BCP card charge with the exact amount', () => {
    const parsed = mail(
      'Compra realizada con tu tarjeta',
      'Registramos una compra con tu tarjeta por S/ 186.50.',
    );
    expect(parsed).toMatchObject({
      kind: 'card_charge',
      institution: 'BCP',
      currency: 'PEN',
      amountMinor: 18650,
      occurredAt: receivedAt,
    });
    expect(parsed?.confidence).toBeGreaterThanOrEqual(90);
  });

  it('ignores rejected attempts even when the subject says compra', () => {
    expect(
      mail(
        'Se rechazó tu compra por Saldo insuficiente',
        'La compra con tu tarjeta por S/ 95.00 no pudo realizarse por saldo insuficiente.',
      ),
    ).toBeUndefined();
  });

  it('ignores loan offers, presales, win-back promotions and pure electronic receipts', () => {
    expect(
      mail(
        '¡No dejes pasar tu préstamo! Precalifica 100% digital',
        'Solicita tu préstamo de hasta S/ 20,000.',
      ),
    ).toBeUndefined();
    expect(mail('🚨 Preventa activa: Duna Parte 3 🎟️', 'Compra tus entradas hoy.')).toBeUndefined();
    expect(mail('Hace tiempo no nos visitas 🥺 ¡Te extrañamos!', 'Tenemos ofertas para ti.')).toBeUndefined();
    expect(
      mail(
        'BCP - ¡Te enviamos tu nuevo comprobante electrónico! - BA04-78012010',
        'Ya puedes consultar tu comprobante electrónico.',
      ),
    ).toBeUndefined();
  });

  it('keeps billed services with an amount without treating bank receipts as expenses', () => {
    expect(
      mail(
        'Recibo Claro - Setiembre 998270930',
        'Tu recibo Claro del mes tiene un importe de S/ 29.90.',
        'Claro <recibos@claro.com.pe>',
      ),
    ).toMatchObject({
      kind: 'expense',
      merchant: 'Claro',
      currency: 'PEN',
      amountMinor: 2990,
    });
  });

  it('detects recurring services from real recurring-charge language and known merchants', () => {
    expect(
      mail(
        'Tu pago recurrente de Spotify',
        'Se realizó el cobro recurrente de Spotify por S/ 20.90.',
        'Spotify <billing@spotify.com>',
      ),
    ).toMatchObject({
      kind: 'subscription',
      merchant: 'Spotify',
      currency: 'PEN',
      amountMinor: 2090,
    });

    expect(
      mail(
        'Renovación de ChatGPT',
        'Tu plan mensual de ChatGPT se renovó por US$ 20.00.',
        'OpenAI <noreply@openai.com>',
      ),
    ).toMatchObject({
      kind: 'subscription',
      merchant: 'ChatGPT',
      currency: 'USD',
      amountMinor: 2000,
    });
  });

  it('ignores subscription cancellations, expirations and unsubscribe notices', () => {
    expect(
      mail(
        'Cancelación de tu membresía a Prime for Young Adult',
        'Tu membresía fue cancelada.',
        'Amazon <store-news@amazon.com>',
      ),
    ).toBeUndefined();
    expect(mail('Tu membresía de Prime terminó', 'Puedes volver cuando quieras.')).toBeUndefined();
    expect(mail('Te has desafiliado con éxito de YANGO', 'La afiliación fue cancelada.')).toBeUndefined();
  });

  it('uses card statements as card debt and prefers the total payable amount', () => {
    expect(
      mail(
        'Tu estado de cuenta BCP está listo',
        'Pago total S/ 1,845.70. Pago mínimo S/ 184.57. Vence este mes.',
      ),
    ).toMatchObject({
      kind: 'card_statement',
      institution: 'BCP',
      currency: 'PEN',
      amountMinor: 184570,
    });
  });

  it('requires a detected amount for financial candidates', () => {
    expect(mail('Compra realizada con tu tarjeta', 'Tu compra fue realizada correctamente.')).toBeUndefined();
    expect(mail('Estado de cuenta disponible', 'Revisa el detalle de tu estado de cuenta.')).toBeUndefined();
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
          occurredAt: receivedAt,
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
