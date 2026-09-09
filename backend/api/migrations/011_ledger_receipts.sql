CREATE TABLE app.ledger_receipts (
 user_id uuid NOT NULL REFERENCES app.users(id), operation_id uuid NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,operation_id)
);
CREATE TABLE app.ledger_audit (
 user_id uuid NOT NULL, operation_id uuid NOT NULL, entity_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('post','reverse','correct')),
 outcome text NOT NULL CHECK(outcome='applied'), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,operation_id),
 FOREIGN KEY(user_id,operation_id) REFERENCES app.ledger_receipts(user_id,operation_id),
 FOREIGN KEY(user_id,entity_id) REFERENCES app.ledger_transactions(user_id,id)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['ledger_receipts','ledger_audit'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY own_rows ON app.%I TO finanzas_runtime USING (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid) WITH CHECK (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid)',tab);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO finanzas_runtime',tab);
 END LOOP;
END $$;
CREATE FUNCTION app.ledger_receipt_audit_check() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.ledger_audit WHERE user_id=NEW.user_id AND operation_id=NEW.operation_id) THEN
  RAISE EXCEPTION 'missing ledger audit' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_receipt_audit AFTER INSERT ON app.ledger_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.ledger_receipt_audit_check();
REVOKE ALL ON FUNCTION app.ledger_receipt_audit_check() FROM PUBLIC;
