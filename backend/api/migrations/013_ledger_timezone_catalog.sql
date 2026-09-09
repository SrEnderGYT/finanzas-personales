-- Public reference data only. Avoid enumerating pg_timezone_names per financial write.
CREATE TABLE app.ledger_timezones(name text PRIMARY KEY);
INSERT INTO app.ledger_timezones(name) SELECT name FROM pg_timezone_names;
REVOKE ALL ON app.ledger_timezones FROM PUBLIC;
GRANT SELECT ON app.ledger_timezones TO finanzas_runtime;
ALTER TABLE app.ledger_transactions ADD CONSTRAINT ledger_timezone_known FOREIGN KEY(timezone) REFERENCES app.ledger_timezones(name);
CREATE OR REPLACE FUNCTION app.ledger_header_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='UPDATE' AND NOT OLD.sealed AND NEW.sealed AND (to_jsonb(NEW)-'sealed')=(to_jsonb(OLD)-'sealed') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'immutable ledger' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ledger:'||NEW.user_id::text,0));
 IF NEW.sealed OR NOT EXISTS(SELECT 1 FROM app.ledger_timezones WHERE name=NEW.timezone)
 OR NEW.business_date>(clock_timestamp() AT TIME ZONE NEW.timezone)::date
 OR (NEW.occurred_at IS NOT NULL AND ((NEW.occurred_at AT TIME ZONE NEW.timezone)::date<>NEW.business_date OR NEW.occurred_at<>date_trunc('milliseconds',NEW.occurred_at))) THEN
  RAISE EXCEPTION 'invalid ledger date or seal' USING ERRCODE='23514';
 END IF;
 NEW.recorded_at=clock_timestamp();
 RETURN NEW;
END $$;
