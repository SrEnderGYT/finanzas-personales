-- Promotions can contain real-looking monetary values but are not financial events.
-- Keep reviewed history intact; remove only candidates that are still pending.
DELETE FROM app.gmail_financial_candidates
WHERE status = 'pending'
  AND summary ~* '(gana(?:r)?|puntos?|millas?|participa|sorteo|premio|descuentos?|oferta|promoci[oó]n|beneficio|preventa|ll[eé]vate|regalo con tu compra|pr[oó]xima compra|compra favorita|cashback.*(?:sorteo|premio|gana)|cambia.*y gana|pasajes?.*desde|desde[[:space:]]+(s/?\.?|us\$|usd)|hasta[[:space:]]+[0-9.,]+[[:space:]]+(puntos?|millas?))';

DELETE FROM app.gmail_messages AS message
WHERE NOT EXISTS (
  SELECT 1
  FROM app.gmail_financial_candidates AS candidate
  WHERE candidate.user_id = message.user_id
    AND candidate.source_message_id = message.message_id
);
