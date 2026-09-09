-- P06 has no deployed financial data. Fail closed if an experimental journal lacks a receipt.
ALTER TABLE app.ledger_transactions ADD COLUMN operation_id uuid NOT NULL;
ALTER TABLE app.ledger_transactions ADD CONSTRAINT ledger_operation_receipt
 FOREIGN KEY(user_id,operation_id) REFERENCES app.ledger_receipts(user_id,operation_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX ledger_operation ON app.ledger_transactions(user_id,operation_id);
CREATE OR REPLACE FUNCTION app.ledger_receipt_audit_check() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE actual jsonb; declared jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.ledger_audit a JOIN app.ledger_transactions t
   ON (t.user_id,t.id)=(a.user_id,a.entity_id)
   WHERE a.user_id=NEW.user_id AND a.operation_id=NEW.operation_id AND t.operation_id=NEW.operation_id) THEN
  RAISE EXCEPTION 'missing ledger audit' USING ERRCODE='23514';
 END IF;
 IF NOT (NEW.result ? 'transactionIds') OR NEW.result-'transactionIds'<>'{}'::jsonb THEN
  RAISE EXCEPTION 'invalid ledger receipt' USING ERRCODE='23514';
 END IF;
 SELECT jsonb_agg(id::text ORDER BY id::text) INTO actual FROM app.ledger_transactions WHERE user_id=NEW.user_id AND operation_id=NEW.operation_id;
 SELECT jsonb_agg(value ORDER BY value) INTO declared FROM jsonb_array_elements_text(NEW.result->'transactionIds');
 IF actual IS NULL OR actual IS DISTINCT FROM declared THEN RAISE EXCEPTION 'receipt journals differ' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION app.ledger_journal_receipt_check() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.ledger_receipts WHERE user_id=NEW.user_id AND operation_id=NEW.operation_id AND (result->'transactionIds') ? NEW.id::text) THEN
  RAISE EXCEPTION 'journal absent from receipt' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_journal_receipt AFTER INSERT ON app.ledger_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.ledger_journal_receipt_check();
REVOKE ALL ON FUNCTION app.ledger_journal_receipt_check() FROM PUBLIC;
