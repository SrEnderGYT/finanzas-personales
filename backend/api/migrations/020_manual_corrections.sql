CREATE TABLE app.manual_correction_receipts (
 user_id uuid NOT NULL, operation_id uuid NOT NULL, root_id uuid NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 action text NOT NULL CHECK(action IN ('replace','keep_server')),
 outcome text NOT NULL CHECK(outcome IN ('applied','conflict')),
 resolves uuid, command jsonb NOT NULL, result jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,operation_id),
 FOREIGN KEY(user_id,root_id) REFERENCES app.manual_movements(user_id,id),
 FOREIGN KEY(user_id,resolves) REFERENCES app.manual_correction_receipts(user_id,operation_id),
 CHECK(resolves IS DISTINCT FROM operation_id),
 CHECK(jsonb_typeof(command)='object' AND jsonb_typeof(result)='object'),
 CHECK(action<>'keep_server' OR resolves IS NOT NULL)
);
CREATE UNIQUE INDEX manual_conflict_resolved_once ON app.manual_correction_receipts(user_id,resolves)
 WHERE resolves IS NOT NULL AND outcome='applied';
CREATE TABLE app.manual_corrections (
 user_id uuid NOT NULL, root_id uuid NOT NULL, version bigint NOT NULL CHECK(version>=2),
 previous_id uuid NOT NULL, replacement_id uuid NOT NULL, reversal_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 PRIMARY KEY(user_id,root_id,version), UNIQUE(user_id,previous_id),
 UNIQUE(user_id,replacement_id), UNIQUE(user_id,reversal_id), UNIQUE(user_id,operation_id),
 FOREIGN KEY(user_id,root_id) REFERENCES app.manual_movements(user_id,id),
 FOREIGN KEY(user_id,previous_id) REFERENCES app.manual_movements(user_id,id),
 FOREIGN KEY(user_id,replacement_id) REFERENCES app.manual_movements(user_id,id),
 FOREIGN KEY(user_id,reversal_id) REFERENCES app.ledger_transactions(user_id,id),
 FOREIGN KEY(user_id,operation_id) REFERENCES app.manual_correction_receipts(user_id,operation_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(replacement_id<>root_id AND replacement_id<>previous_id AND reversal_id<>replacement_id)
);
CREATE TABLE app.manual_correction_audit (
 user_id uuid NOT NULL, operation_id uuid NOT NULL, root_id uuid NOT NULL,
 action text NOT NULL, outcome text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,operation_id),
 FOREIGN KEY(user_id,operation_id) REFERENCES app.manual_correction_receipts(user_id,operation_id),
 FOREIGN KEY(user_id,root_id) REFERENCES app.manual_movements(user_id,id)
);
CREATE FUNCTION app.correction_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable correction history' USING ERRCODE='23514'; END $$;
CREATE FUNCTION app.correction_audit_append() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 INSERT INTO app.manual_correction_audit(user_id,operation_id,root_id,action,outcome)
 VALUES(NEW.user_id,NEW.operation_id,NEW.root_id,NEW.action,NEW.outcome);
 RETURN NEW;
END $$;
CREATE TRIGGER correction_audit_append AFTER INSERT ON app.manual_correction_receipts
 FOR EACH ROW EXECUTE FUNCTION app.correction_audit_append();
CREATE FUNCTION app.correction_validate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM app.manual_corrections WHERE user_id=NEW.user_id AND replacement_id=NEW.root_id) OR
   (NEW.version=2 AND NEW.previous_id<>NEW.root_id) OR
   (NEW.version>2 AND NOT EXISTS(SELECT 1 FROM app.manual_corrections WHERE user_id=NEW.user_id AND root_id=NEW.root_id AND version=NEW.version-1 AND replacement_id=NEW.previous_id)) OR
   NOT EXISTS(SELECT 1 FROM app.ledger_transactions r
    JOIN app.manual_movements p ON (p.user_id,p.id)=(NEW.user_id,NEW.previous_id)
    JOIN app.manual_movements n ON (n.user_id,n.id)=(NEW.user_id,NEW.replacement_id)
    JOIN app.manual_correction_receipts c ON (c.user_id,c.operation_id)=(NEW.user_id,NEW.operation_id)
    WHERE r.user_id=NEW.user_id AND r.id=NEW.reversal_id AND r.kind='reversal' AND r.sealed
      AND r.original_id=p.journal_id AND r.currency=p.currency AND n.currency=p.currency
      AND c.root_id=NEW.root_id AND c.action='replace' AND c.outcome='applied') THEN
   RAISE EXCEPTION 'invalid correction chain' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER correction_validate AFTER INSERT ON app.manual_corrections
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.correction_validate();
CREATE FUNCTION app.correction_receipt_validate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF (NEW.outcome='applied' AND NEW.action='replace') IS DISTINCT FROM
   EXISTS(SELECT 1 FROM app.manual_corrections WHERE user_id=NEW.user_id AND operation_id=NEW.operation_id) THEN
   RAISE EXCEPTION 'incomplete correction receipt' USING ERRCODE='23514';
 END IF;
 IF NEW.resolves IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.manual_correction_receipts
   WHERE user_id=NEW.user_id AND operation_id=NEW.resolves AND root_id=NEW.root_id AND outcome='conflict') THEN
   RAISE EXCEPTION 'invalid conflict reference' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER correction_receipt_validate AFTER INSERT ON app.manual_correction_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.correction_receipt_validate();
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['manual_correction_receipts','manual_corrections','manual_correction_audit'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY own_rows ON app.%I TO finanzas_runtime USING (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid) WITH CHECK (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid)',tab);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO finanzas_runtime',tab);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.correction_immutable()',tab);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.correction_immutable(),app.correction_audit_append(),app.correction_validate(),app.correction_receipt_validate() FROM PUBLIC;
