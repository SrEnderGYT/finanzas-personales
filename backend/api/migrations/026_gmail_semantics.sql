-- Refunds/reversals are financial events, but they are not expenses or ordinary income.
ALTER TABLE app.gmail_financial_candidates
DROP CONSTRAINT IF EXISTS gmail_financial_candidates_kind_check;

ALTER TABLE app.gmail_financial_candidates
ADD CONSTRAINT gmail_financial_candidates_kind_check CHECK (kind IN (
  'expense','income','transfer','card_charge','card_statement','subscription','debt','payment','refund','unknown'
));

-- Pending detections are safe to re-evaluate. Reviewed history is preserved.
-- Non-transactional notices must never enter the review queue merely because they contain an amount.
DELETE FROM app.gmail_financial_candidates
WHERE status = 'pending'
  AND summary ~* '(has recibido una boleta|facturaci[oó]n electr[oó]nica|comprobante electr[oó]nico|error (en el |de )?pago|pago pendiente|a[uú]n no se pag[oó]|suscripci[oó]n est[aá] por vencer|vencer[aá] pronto|se cobrar[aá] ma[nñ]ana|se cobrar[aá] en [0-9]+ d[ií]as?|faltan [0-9]+ d[ií]as? para (el )?cobro|encuesta|tu opini[oó]n|califica tu experiencia|ay[uú]danos a mejorar|respuesta a reclamo|certificado de no adeudo)';

-- Old pending refunds may have been fingerprinted as expenses/card charges.
-- Remove them so the next readonly Gmail sync recreates them with kind=refund.
DELETE FROM app.gmail_financial_candidates
WHERE status = 'pending'
  AND summary ~* '(realizamos (una )?devoluci[oó]n|se ha devuelto (el )?monto|monto total devuelto|reembolso (realizado|procesado|completado)|reversi[oó]n (realizada|procesada)|reverso (realizado|procesado)|extorno (realizado|procesado))';
