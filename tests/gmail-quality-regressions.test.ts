import { describe, expect, it } from 'vitest';
import { parseFinancialMail } from '../backend/api/src/financial-mail-parser';

const receivedAt = '2026-09-01T15:00:00.000Z';

function parse(subject: string, snippet: string, sender = 'Banco <avisos@example.test>') {
  return parseFinancialMail({
    messageId: `${subject}-${snippet}`.slice(0, 128),
    sender,
    subject,
    snippet,
    receivedAt,
  });
}

describe('Gmail financial quality regressions', () => {
  it('ignores non-executed due and scheduled-payment notices even with amounts', () => {
    expect(
      parse('Tu pago está por vencer', 'Tienes un pago por vencer de S/ 82.40. Revísalo a tiempo.'),
    ).toBeUndefined();
    expect(
      parse('Próximo vencimiento', 'Tu cobro programado de S/ 31.90 vence en 3 días.'),
    ).toBeUndefined();
  });

  it('ignores loyalty campaigns and promotional amounts outside Promotions', () => {
    expect(
      parse('Canjea tus puntos hoy', 'Acumula beneficios y obtén hasta S/ 250.00 en premios.'),
    ).toBeUndefined();
    expect(
      parse('Campaña exclusiva', 'Usa tu tarjeta y participa. Cupón de S/ 60.00 disponible.'),
    ).toBeUndefined();
  });

  it('classifies completed returns and reversals as refunds, never expenses', () => {
    expect(
      parse('Te devolvimos una compra', 'Te devolvimos S/ 42.50 a tu tarjeta. Operación completada.'),
    ).toMatchObject({ kind: 'refund', currency: 'PEN', amountMinor: 4250 });
    expect(
      parse('Retorno de compra procesado', 'Retorno de una compra por US$ 12.30 a tu tarjeta.'),
    ).toMatchObject({ kind: 'refund', currency: 'USD', amountMinor: 1230 });
  });

  it('ignores cancelled or non-completed operations', () => {
    expect(
      parse('Operación anulada', 'La operación por S/ 90.00 fue anulada y no se realizó el cobro.'),
    ).toBeUndefined();
    expect(
      parse('Intento de compra', 'Intento de compra por S/ 14.90. El pago no fue completado.'),
    ).toBeUndefined();
  });
});
