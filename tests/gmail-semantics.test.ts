import { describe, expect, it } from 'vitest';
import type { GmailFinancialCandidate } from '../packages/shared/src/gmail-candidates';
import {
  automaticCategory,
  isDashboardGmailMovement,
  isReviewableGmailCandidate,
} from '../packages/shared/src/gmail-semantics';

function candidate(
  kind: GmailFinancialCandidate['kind'],
  summary: string,
  merchant?: string,
): GmailFinancialCandidate {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sourceMessageId: 'test-message',
    kind,
    currency: 'PEN',
    amountMinor: '2500',
    occurredAt: '2026-09-10T15:00:00.000Z',
    createdAt: '2026-09-10T15:00:00.000Z',
    confidence: 95,
    status: 'confirmed',
    summary,
    ...(merchant ? { merchant } : {}),
  };
}

describe('Gmail finance semantics', () => {
  it('keeps an executed subscription as an expense-class dashboard movement', () => {
    const row = candidate('subscription', 'Renovación cobrada de tu plan mensual', 'Spotify');
    expect(isReviewableGmailCandidate(row)).toBe(true);
    expect(isDashboardGmailMovement(row)).toBe(true);
    expect(automaticCategory(row)).toBe('Suscripciones');
  });

  it('filters future, failed and document-only notices even when they contain an amount', () => {
    for (const summary of [
      'Tu suscripción está por vencer',
      'Error de pago. Pago pendiente',
      'Has recibido una BOLETA electrónica',
      'Se cobrará mañana',
    ]) {
      const row = candidate('expense', summary);
      expect(isReviewableGmailCandidate(row)).toBe(false);
      expect(isDashboardGmailMovement(row)).toBe(false);
    }
  });

  it('categorizes common merchants without user-maintained mappings', () => {
    expect(automaticCategory(candidate('expense', 'Compra realizada', 'Rappi'))).toBe(
      'Comida y delivery',
    );
    expect(automaticCategory(candidate('expense', 'Compra realizada', 'Wong'))).toBe(
      'Supermercado',
    );
    expect(automaticCategory(candidate('expense', 'Compra realizada', 'Uber'))).toBe(
      'Transporte',
    );
    expect(automaticCategory(candidate('card_charge', 'Compra realizada', 'LATAM'))).toBe(
      'Viajes',
    );
  });

  it('does not count refunds as new income or expense', () => {
    const row = candidate('refund', 'Devolución procesada');
    expect(isReviewableGmailCandidate(row)).toBe(true);
    expect(isDashboardGmailMovement(row)).toBe(false);
    expect(automaticCategory(row)).toBe('Devoluciones');
  });
});
