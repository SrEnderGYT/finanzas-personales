import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0)
    throw new Error(`Patch anchor is not unique: ${label}`);
  return `${source.slice(0, index)}${after}${source.slice(index + before.length)}`;
}

const gmailPath = 'backend/api/src/gmail-service.ts';
let gmail = readFileSync(gmailPath, 'utf8');
gmail = replaceOnce(gmail, "const CODE = /^[^\\s]{1,4096}$/;\n\ninterface GmailServiceOptions", "const CODE = /^[^\\s]{1,4096}$/;\nconst FINANCIAL_HISTORY_DAYS = 365;\n\ninterface GmailServiceOptions", 'history constant');
gmail = replaceOnce(gmail, "return { state: 'disconnected', scope: GMAIL_READONLY_SCOPE, rangeDays: 90 };", "return { state: 'disconnected', scope: GMAIL_READONLY_SCOPE, rangeDays: FINANCIAL_HISTORY_DAYS };", 'disconnected history');
gmail = replaceOnce(gmail, "rangeDays: Math.max(90, Number(value['range_days'])),", "rangeDays: Math.max(FINANCIAL_HISTORY_DAYS, Number(value['range_days'])),", 'connection history');
gmail = replaceOnce(gmail, 'const effectiveRangeDays = Math.max(90, rangeDays);', 'const effectiveRangeDays = Math.min(365, Math.max(FINANCIAL_HISTORY_DAYS, rangeDays));', 'oauth history');
gmail = replaceOnce(gmail, "const rangeDays = Math.max(90, Number(result.rows[0].range_days));", "const rangeDays = Math.max(FINANCIAL_HISTORY_DAYS, Number(result.rows[0].range_days));", 'sync history');
gmail = replaceOnce(gmail, 'ORDER BY occurred_at DESC,id DESC LIMIT 500`,', 'ORDER BY occurred_at DESC,id DESC LIMIT 2000`,', 'candidate history limit');
writeFileSync(gmailPath, gmail);

const parserPath = 'backend/api/src/financial-mail-parser.ts';
let parser = readFileSync(parserPath, 'utf8');
parser = replaceOnce(parser, 'const refundExecuted =\n', `const additionalMarketingNoise =\n  /\\b(canjea|acumula|cup[oó]n|c[oó]digo promocional|2x1|3x2|campaña exclusiva|imperdible|oportunidad [uú]nica|solo por hoy|hasta \\d+% de descuento)\\b/i;\n\nconst additionalNonExecutedNotice =\n  /\\b(est[aá](?:n)? por vencer|pago por vencer|cuota por vencer|pr[oó]ximo vencimiento|vence en \\d+ d[ií]as?|pago programado|cobro programado)\\b/i;\n\nconst additionalRejectedNotice =\n  /\\b(operaci[oó]n anulada|pago no completado|cobro no realizado|intento de pago|intento de compra)\\b/i;\n\nconst additionalRefundExecuted =\n  /\\b(te devolvimos|devolvimos|te retornamos|retornamos (?:el )?monto|retorno de (?:una )?(?:compra|operaci[oó]n)|abono por devoluci[oó]n|devoluci[oó]n a tu tarjeta|cargo revertido|operaci[oó]n revertida)\\b/i;\n\nconst refundExecuted =\n`, 'additional semantics');
parser = replaceOnce(parser, "if (refundExecuted.test(text)) return { kind: 'refund', confidence: 98 };", "if (refundExecuted.test(text) || additionalRefundExecuted.test(text))\n    return { kind: 'refund', confidence: 98 };", 'refund semantics');
parser = replaceOnce(parser, `    rejectedTransaction.test(text) ||\n    marketingOffer.test(text) ||\n    surveyOrServiceMessage.test(text) ||\n    futureNotice.test(text) ||`, `    rejectedTransaction.test(text) ||\n    additionalRejectedNotice.test(text) ||\n    marketingOffer.test(text) ||\n    additionalMarketingNoise.test(text) ||\n    surveyOrServiceMessage.test(text) ||\n    futureNotice.test(text) ||\n    additionalNonExecutedNotice.test(text) ||`, 'semantic gates');
writeFileSync(parserPath, parser);

const detectedPath = 'packages/ui/src/detected-finances-screen.ts';
let detected = readFileSync(detectedPath, 'utf8');
detected = replaceOnce(detected, `          <label>\n            <span>Periodo</span>\n            <input type="month" [value]="month()" (change)="setMonth($any($event.target).value)" />\n          </label>`, `          @if (view() === 'subscriptions') {\n            <div class="detected-window">\n              <span>Periodo</span>\n              <strong>Últimos 90 días</strong>\n            </div>\n          } @else {\n            <label>\n              <span>Periodo</span>\n              <input type="month" [value]="month()" (change)="setMonth($any($event.target).value)" />\n            </label>\n          }`, 'subscription period UI');
detected = replaceOnce(detected, `      if (monthKey(new Date(candidate.occurredAt)) !== this.month()) return false;\n      if (this.view() === 'cards' && this.isAccessLoan(candidate)) return false;`, `      if (this.view() === 'subscriptions') {\n        const occurredAt = new Date(candidate.occurredAt).getTime();\n        const ageMs = Date.now() - occurredAt;\n        if (!Number.isFinite(occurredAt) || ageMs < 0 || ageMs > 90 * 86_400_000) return false;\n      } else if (monthKey(new Date(candidate.occurredAt)) !== this.month()) {\n        return false;\n      }\n      if (this.view() === 'cards' && this.isAccessLoan(candidate)) return false;`, 'subscription 90 day filter');
writeFileSync(detectedPath, detected);
