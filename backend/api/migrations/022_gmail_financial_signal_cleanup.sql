-- Re-evaluate old Gmail detections conservatively after tightening the parser.
-- Confirmed/discarded review history is preserved; only still-pending false positives are removed.
DELETE FROM app.gmail_financial_candidates
WHERE status = 'pending'
  AND (
    amount_minor IS NULL
    OR amount_minor <= 0
    OR summary ~* '(saldo insuficiente|fondos insuficientes|compra rechazada|se rechaz[oó] tu compra|transacci[oó]n rechazada|operaci[oó]n no realizada|precalifica|precalificaci[oó]n|cr[eé]dito preaprobado|pr[eé]stamo preaprobado|pr[eé]stamo para ti|100% digital|preventa activa|te extrañamos|hace tiempo no nos visitas|nuevo comprobante electr[oó]nico|te enviamos tu nuevo comprobante)'
    OR (
      kind = 'subscription'
      AND summary ~* '(cancelaci[oó]n|membres[ií]a.*termin[oó]|suscripci[oó]n.*cancelada|desafiliad|dar de baja)'
    )
    OR (
      kind = 'debt'
      AND summary ~* '(precalifica|preaprob|solicita.*pr[eé]stamo|obt[eé]n.*pr[eé]stamo|oferta.*pr[eé]stamo)'
    )
  );

-- Do not retain message metadata when it no longer supports any financial candidate.
DELETE FROM app.gmail_messages AS message
WHERE NOT EXISTS (
  SELECT 1
  FROM app.gmail_financial_candidates AS candidate
  WHERE candidate.user_id = message.user_id
    AND candidate.source_message_id = message.message_id
);
