-- Use at least 90 days of Gmail history so recurring charges can be evaluated across three months.
UPDATE app.gmail_connections
SET range_days = 90,
    updated_at = now()
WHERE range_days < 90;

-- Interbank Visa Access belongs to the loan/debt view, not credit cards.
UPDATE app.gmail_financial_candidates
SET kind = 'debt',
    confidence = GREATEST(confidence, 96)
WHERE institution = 'Interbank'
  AND summary ~* '(^|[^[:alnum:]])(IBK[[:space:]]+)?Visa Access([^[:alnum:]]|$)'
  AND status <> 'discarded';

-- Preserve reviewed history; remove only pending commercial false positives.
DELETE FROM app.gmail_financial_candidates
WHERE status = 'pending'
  AND summary ~* '(gana(?:r)?|puntos?|millas?|sacar[[:space:]]+millas|participa|sorteo|premio|descuentos?|dscto|oferta|promoci[oó]n|beneficio|preventa|ll[eé]vate|regalo con tu compra|pr[oó]xima compra|compra favorita|cashback.*(?:sorteo|premio|gana)|cambia.*y gana|pasajes?.*desde)';
