ALTER TABLE app.manual_receipts ADD CONSTRAINT manual_receipt_sync_identity UNIQUE(user_id,operation_id,movement_id);
CREATE TABLE app.sync_heads (
 user_id uuid PRIMARY KEY REFERENCES app.users(id),
 generation uuid NOT NULL DEFAULT gen_random_uuid(),
 last_sequence bigint NOT NULL DEFAULT 0 CHECK(last_sequence>=0)
);
CREATE TABLE app.sync_changes (
 user_id uuid NOT NULL, sequence bigint NOT NULL CHECK(sequence>0),
 operation_id uuid NOT NULL, movement_id uuid NOT NULL,
 PRIMARY KEY(user_id,sequence), UNIQUE(user_id,operation_id),
 FOREIGN KEY(user_id) REFERENCES app.sync_heads(user_id),
 FOREIGN KEY(user_id,operation_id,movement_id) REFERENCES app.manual_receipts(user_id,operation_id,movement_id),
 FOREIGN KEY(user_id,movement_id) REFERENCES app.manual_movements(user_id,id)
);
INSERT INTO app.sync_heads(user_id,last_sequence)
 SELECT user_id,count(*) FROM app.manual_receipts GROUP BY user_id;
INSERT INTO app.sync_changes(user_id,sequence,operation_id,movement_id)
 SELECT user_id,row_number() OVER(PARTITION BY user_id ORDER BY recorded_at,operation_id),operation_id,movement_id FROM app.manual_receipts;
CREATE FUNCTION app.append_manual_sync_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE next_sequence bigint;
BEGIN
 INSERT INTO app.sync_heads(user_id,last_sequence) VALUES(NEW.user_id,1)
 ON CONFLICT(user_id) DO UPDATE SET last_sequence=app.sync_heads.last_sequence+1
 RETURNING last_sequence INTO next_sequence;
 INSERT INTO app.sync_changes(user_id,sequence,operation_id,movement_id)
 VALUES(NEW.user_id,next_sequence,NEW.operation_id,NEW.movement_id);
 RETURN NEW;
END $$;
CREATE TRIGGER append_manual_sync_change AFTER INSERT ON app.manual_receipts FOR EACH ROW EXECUTE FUNCTION app.append_manual_sync_change();
REVOKE ALL ON FUNCTION app.append_manual_sync_change() FROM PUBLIC;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['sync_heads','sync_changes'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY own_rows ON app.%I TO finanzas_runtime USING (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid) WITH CHECK (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid)',tab);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO finanzas_runtime',tab);
 END LOOP;
END $$;
GRANT UPDATE(last_sequence) ON app.sync_heads TO finanzas_runtime;
