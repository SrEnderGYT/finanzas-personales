CREATE TABLE app.manual_movements (
 user_id uuid NOT NULL REFERENCES app.users(id), id uuid NOT NULL, operation_id uuid NOT NULL,
 account_id uuid NOT NULL, category_id uuid NOT NULL, journal_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('expense','income')), currency text NOT NULL CHECK(currency IN ('PEN','USD')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0), business_date date NOT NULL, timezone text NOT NULL REFERENCES app.ledger_timezones(name), occurred_at timestamptz,
 note text CHECK(char_length(note)<=500 AND note !~ '[[:cntrl:]]'), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,id), UNIQUE(user_id,operation_id), UNIQUE(user_id,journal_id), CHECK(id=journal_id),
 FOREIGN KEY(user_id,account_id) REFERENCES app.product_accounts(user_id,id),
 FOREIGN KEY(user_id,category_id) REFERENCES app.categories(user_id,id),
 FOREIGN KEY(user_id,journal_id,currency) REFERENCES app.ledger_transactions(user_id,id,currency) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(user_id,operation_id) REFERENCES app.ledger_receipts(user_id,operation_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE app.manual_receipts (
 user_id uuid NOT NULL, operation_id uuid NOT NULL, movement_id uuid NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,operation_id), UNIQUE(user_id,movement_id),
 FOREIGN KEY(user_id,movement_id) REFERENCES app.manual_movements(user_id,id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE app.manual_movements ADD CONSTRAINT manual_receipt FOREIGN KEY(user_id,operation_id) REFERENCES app.manual_receipts(user_id,operation_id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION app.manual_check() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.ledger_transactions t JOIN app.product_accounts a ON (a.user_id,a.id)=(NEW.user_id,NEW.account_id)
 JOIN app.categories c ON (c.user_id,c.id)=(NEW.user_id,NEW.category_id)
 JOIN app.manual_receipts r ON (r.user_id,r.operation_id,r.movement_id)=(NEW.user_id,NEW.operation_id,NEW.id)
 WHERE t.user_id=NEW.user_id AND t.id=NEW.journal_id AND t.sealed AND t.operation_id=NEW.operation_id AND t.kind=NEW.kind AND t.currency=NEW.currency
 AND t.amount_minor=NEW.amount_minor AND t.business_date=NEW.business_date AND t.timezone=NEW.timezone AND t.occurred_at IS NOT DISTINCT FROM NEW.occurred_at
 AND a.currency=NEW.currency AND a.state='active' AND c.state='active' AND c.kind=NEW.kind
 AND EXISTS(SELECT 1 FROM app.ledger_entries e WHERE e.user_id=NEW.user_id AND e.transaction_id=NEW.journal_id AND e.account_id=a.ledger_account_id AND
 ((NEW.kind='expense' AND e.credit_minor=NEW.amount_minor) OR (NEW.kind='income' AND e.debit_minor=NEW.amount_minor)))) THEN
  RAISE EXCEPTION 'incompatible manual confirmation' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER manual_check AFTER INSERT ON app.manual_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.manual_check();
REVOKE ALL ON FUNCTION app.manual_check() FROM PUBLIC;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['manual_movements','manual_receipts'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY own_rows ON app.%I TO finanzas_runtime USING (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid) WITH CHECK (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid)',tab);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO finanzas_runtime',tab);
 END LOOP;
END $$;
