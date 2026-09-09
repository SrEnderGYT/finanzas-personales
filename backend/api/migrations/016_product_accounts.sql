CREATE TABLE app.product_accounts (
 user_id uuid NOT NULL REFERENCES app.users(id), id uuid NOT NULL, ledger_account_id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 80 AND name=btrim(name) AND name !~ '[[:cntrl:]]'),
 type text NOT NULL CHECK(type IN ('savings','current','cash','wallet','investment','other')),
 currency text NOT NULL CHECK(currency IN ('PEN','USD')),
 state text NOT NULL CHECK(state IN ('active','inactive')), position integer NOT NULL CHECK(position>=0),
 version bigint NOT NULL DEFAULT 1 CHECK(version>=1), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 operation_id uuid NOT NULL, PRIMARY KEY(user_id,id), UNIQUE(user_id,ledger_account_id), CHECK(id<>ledger_account_id),
 FOREIGN KEY(user_id,ledger_account_id,currency) REFERENCES app.ledger_accounts(user_id,id,currency),
 FOREIGN KEY(user_id,operation_id) REFERENCES app.catalog_receipts(user_id,operation_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX product_account_order ON app.product_accounts(user_id,position,id);
CREATE FUNCTION app.product_account_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.user_id,NEW.id,NEW.currency,NEW.ledger_account_id,NEW.created_at) IS DISTINCT FROM (OLD.user_id,OLD.id,OLD.currency,OLD.ledger_account_id,OLD.created_at) OR NEW.version<>OLD.version+1 OR NEW.operation_id=OLD.operation_id THEN
   RAISE EXCEPTION 'immutable account identity or invalid version' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.version<>1 OR NEW.state<>'active' THEN RAISE EXCEPTION 'invalid new account' USING ERRCODE='23514'; END IF;
  NEW.created_at=clock_timestamp();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM app.ledger_accounts WHERE user_id=NEW.user_id AND id=NEW.ledger_account_id AND currency=NEW.currency AND nature='asset') THEN
  RAISE EXCEPTION 'invalid account asset' USING ERRCODE='23514';
 END IF;
 NEW.updated_at=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER product_account_guard BEFORE INSERT OR UPDATE ON app.product_accounts FOR EACH ROW EXECUTE FUNCTION app.product_account_guard();
REVOKE ALL ON FUNCTION app.product_account_guard() FROM PUBLIC;
ALTER TABLE app.product_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.product_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON app.product_accounts TO finanzas_runtime USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON app.product_accounts TO finanzas_runtime;
GRANT UPDATE(name,type,state,position,version,operation_id) ON app.product_accounts TO finanzas_runtime;
