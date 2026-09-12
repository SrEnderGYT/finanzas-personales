CREATE OR REPLACE FUNCTION app.cleanup_gmail_scan_noise()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Pending rows without a usable amount are not actionable financial information.
  DELETE FROM app.gmail_financial_candidates
  WHERE user_id = NEW.user_id
    AND status = 'pending'
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

  -- Gmail metadata is retained only when at least one financial candidate references it.
  DELETE FROM app.gmail_messages AS message
  WHERE message.user_id = NEW.user_id
    AND NOT EXISTS (
      SELECT 1
      FROM app.gmail_financial_candidates AS candidate
      WHERE candidate.user_id = message.user_id
        AND candidate.source_message_id = message.message_id
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gmail_post_sync_retention ON app.gmail_connections;
CREATE TRIGGER gmail_post_sync_retention
AFTER UPDATE OF last_sync_at ON app.gmail_connections
FOR EACH ROW
WHEN (NEW.last_sync_at IS DISTINCT FROM OLD.last_sync_at)
EXECUTE FUNCTION app.cleanup_gmail_scan_noise();
