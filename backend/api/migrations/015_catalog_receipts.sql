CREATE TABLE app.catalog_receipts (
 user_id uuid NOT NULL REFERENCES app.users(id), operation_id uuid NOT NULL,
 schema_version integer NOT NULL CHECK(schema_version=1), payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'), completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,operation_id)
);
CREATE TABLE app.catalog_audit (
 user_id uuid NOT NULL, operation_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('account.create','account.update','category.create','category.update','category.initialize')),
 outcome text NOT NULL CHECK(outcome='applied'), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,operation_id), FOREIGN KEY(user_id,operation_id) REFERENCES app.catalog_receipts(user_id,operation_id)
);
CREATE FUNCTION app.catalog_audit_check() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.catalog_audit WHERE user_id=NEW.user_id AND operation_id=NEW.operation_id) THEN
  RAISE EXCEPTION 'missing catalog audit' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER catalog_audit_check AFTER INSERT ON app.catalog_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.catalog_audit_check();
REVOKE ALL ON FUNCTION app.catalog_audit_check() FROM PUBLIC;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['catalog_receipts','catalog_audit'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY own_rows ON app.%I TO finanzas_runtime USING (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid) WITH CHECK (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid)',tab);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO finanzas_runtime',tab);
 END LOOP;
END $$;
