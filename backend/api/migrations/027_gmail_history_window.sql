-- Keep enough history to build month-by-month finance views.
-- Subscription recurrence is still evaluated over a shorter 90-day business window.
UPDATE app.gmail_connections
SET range_days = 365,
    updated_at = now()
WHERE range_days < 365;

ALTER TABLE app.gmail_connections ALTER COLUMN range_days SET DEFAULT 365;

CREATE OR REPLACE FUNCTION app.enforce_gmail_financial_history_days()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.range_days := 365;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gmail_connections_history_days ON app.gmail_connections;
CREATE TRIGGER gmail_connections_history_days
BEFORE INSERT OR UPDATE OF range_days ON app.gmail_connections
FOR EACH ROW EXECUTE FUNCTION app.enforce_gmail_financial_history_days();

DROP TRIGGER IF EXISTS gmail_oauth_flows_history_days ON app.gmail_oauth_flows;
CREATE TRIGGER gmail_oauth_flows_history_days
BEFORE INSERT OR UPDATE OF range_days ON app.gmail_oauth_flows
FOR EACH ROW EXECUTE FUNCTION app.enforce_gmail_financial_history_days();
