CREATE TABLE app.ledger_accounts (
 user_id uuid NOT NULL REFERENCES app.users(id), id uuid NOT NULL,
 currency text NOT NULL CHECK(currency IN ('PEN','USD')),
 nature text NOT NULL CHECK(nature IN ('asset','liability','expense','income','equity')),
 system_key text CHECK(length(system_key) BETWEEN 1 AND 80),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,id), UNIQUE(user_id,id,currency), UNIQUE(user_id,system_key,currency)
);
CREATE TABLE app.ledger_transactions (
 user_id uuid NOT NULL REFERENCES app.users(id), id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('expense','income','transfer','payment','refund','adjustment','reversal')),
 currency text NOT NULL CHECK(currency IN ('PEN','USD')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 business_date date NOT NULL CHECK(business_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 timezone text NOT NULL, occurred_at timestamptz,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 original_id uuid, reason text, sealed boolean NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,id), UNIQUE(user_id,id,currency),
 FOREIGN KEY(user_id,original_id,currency) REFERENCES app.ledger_transactions(user_id,id,currency),
 CHECK((kind IN ('refund','reversal')) = (original_id IS NOT NULL)),
 CHECK(original_id IS NULL OR original_id<>id),
 CHECK((kind='adjustment' AND length(btrim(reason)) BETWEEN 1 AND 240) OR (kind<>'adjustment' AND reason IS NULL))
);
CREATE UNIQUE INDEX ledger_one_reversal ON app.ledger_transactions(user_id,original_id) WHERE kind='reversal';
CREATE INDEX ledger_original ON app.ledger_transactions(user_id,original_id);
CREATE INDEX ledger_date ON app.ledger_transactions(user_id,business_date,id);
CREATE TABLE app.ledger_entries (
 user_id uuid NOT NULL, transaction_id uuid NOT NULL, account_id uuid NOT NULL, currency text NOT NULL,
 debit_minor bigint NOT NULL CHECK(debit_minor>=0), credit_minor bigint NOT NULL CHECK(credit_minor>=0),
 PRIMARY KEY(user_id,transaction_id,account_id),
 FOREIGN KEY(user_id,transaction_id,currency) REFERENCES app.ledger_transactions(user_id,id,currency),
 FOREIGN KEY(user_id,account_id,currency) REFERENCES app.ledger_accounts(user_id,id,currency),
 CHECK((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0))
);
CREATE INDEX ledger_account_entries ON app.ledger_entries(user_id,account_id,transaction_id);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['ledger_accounts','ledger_transactions','ledger_entries'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY own_rows ON app.%I TO finanzas_runtime USING (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid) WITH CHECK (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid)',tab);
  EXECUTE format('GRANT SELECT,INSERT ON app.%I TO finanzas_runtime',tab);
 END LOOP;
END $$;
GRANT UPDATE(sealed) ON app.ledger_transactions TO finanzas_runtime;

CREATE FUNCTION app.ledger_header_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='UPDATE' AND NOT OLD.sealed AND NEW.sealed AND (to_jsonb(NEW)-'sealed')=(to_jsonb(OLD)-'sealed') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'immutable ledger' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ledger:'||NEW.user_id::text,0));
 IF NEW.sealed OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.timezone)
 OR NEW.business_date>(clock_timestamp() AT TIME ZONE NEW.timezone)::date
 OR (NEW.occurred_at IS NOT NULL AND ((NEW.occurred_at AT TIME ZONE NEW.timezone)::date<>NEW.business_date OR NEW.occurred_at<>date_trunc('milliseconds',NEW.occurred_at))) THEN
  RAISE EXCEPTION 'invalid ledger date or seal' USING ERRCODE='23514';
 END IF;
 NEW.recorded_at=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_header_guard BEFORE INSERT OR UPDATE OR DELETE ON app.ledger_transactions FOR EACH ROW EXECUTE FUNCTION app.ledger_header_guard();

CREATE FUNCTION app.ledger_entry_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE locked boolean;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'immutable entries' USING ERRCODE='23514'; END IF;
 SELECT sealed INTO locked FROM app.ledger_transactions WHERE user_id=NEW.user_id AND id=NEW.transaction_id FOR UPDATE;
 IF locked IS DISTINCT FROM false THEN RAISE EXCEPTION 'sealed or missing journal' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON app.ledger_entries FOR EACH ROW EXECUTE FUNCTION app.ledger_entry_guard();

CREATE FUNCTION app.ledger_validate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE j app.ledger_transactions; original app.ledger_transactions; d text; c text; n bigint; total numeric; refundable numeric;
BEGIN
 SELECT * INTO j FROM app.ledger_transactions WHERE user_id=NEW.user_id AND id=NEW.id;
 SELECT count(*),sum(e.debit_minor),max(a.nature) FILTER(WHERE e.debit_minor>0),max(a.nature) FILTER(WHERE e.credit_minor>0)
 INTO n,total,d,c FROM app.ledger_entries e JOIN app.ledger_accounts a ON (a.user_id,a.id)=(e.user_id,e.account_id)
 WHERE e.user_id=j.user_id AND e.transaction_id=j.id;
 IF NOT j.sealed OR n<>2 OR total IS DISTINCT FROM j.amount_minor::numeric OR total IS DISTINCT FROM
 (SELECT sum(credit_minor) FROM app.ledger_entries WHERE user_id=j.user_id AND transaction_id=j.id) THEN
  RAISE EXCEPTION 'unbalanced or unsealed journal' USING ERRCODE='23514';
 END IF;
 IF NOT (CASE j.kind
 WHEN 'expense' THEN d='expense' AND c IN ('asset','liability')
 WHEN 'income' THEN d='asset' AND c='income'
 WHEN 'transfer' THEN d='asset' AND c='asset'
 WHEN 'payment' THEN d='liability' AND c='asset'
 WHEN 'refund' THEN d IN ('asset','liability') AND c='expense'
 WHEN 'adjustment' THEN (d IN ('asset','liability') AND c='equity') OR (d='equity' AND c IN ('asset','liability'))
 WHEN 'reversal' THEN true ELSE false END) THEN
  RAISE EXCEPTION 'invalid posting shape' USING ERRCODE='23514';
 END IF;
 IF j.original_id IS NOT NULL THEN
  SELECT * INTO original FROM app.ledger_transactions WHERE user_id=j.user_id AND id=j.original_id;
  IF NOT original.sealed OR j.business_date<original.business_date THEN RAISE EXCEPTION 'invalid original' USING ERRCODE='23514'; END IF;
  IF j.kind='refund' THEN
   IF original.kind<>'expense' OR EXISTS(SELECT 1 FROM app.ledger_transactions WHERE user_id=j.user_id AND original_id=original.id AND kind='reversal')
   OR (SELECT account_id FROM app.ledger_entries WHERE user_id=j.user_id AND transaction_id=j.id AND credit_minor>0) IS DISTINCT FROM
      (SELECT account_id FROM app.ledger_entries WHERE user_id=j.user_id AND transaction_id=original.id AND debit_minor>0) THEN
    RAISE EXCEPTION 'invalid refund reference' USING ERRCODE='23514';
   END IF;
   SELECT coalesce(sum(r.amount_minor),0) INTO refundable FROM app.ledger_transactions r
   WHERE r.user_id=j.user_id AND r.original_id=original.id AND r.kind='refund'
   AND NOT EXISTS(SELECT 1 FROM app.ledger_transactions v WHERE v.user_id=r.user_id AND v.original_id=r.id AND v.kind='reversal');
   IF refundable>original.amount_minor THEN RAISE EXCEPTION 'refund exceeds original' USING ERRCODE='23514'; END IF;
  ELSE
   IF original.kind='reversal' OR original.amount_minor<>j.amount_minor OR EXISTS(
    SELECT 1 FROM app.ledger_entries e FULL JOIN
      (SELECT * FROM app.ledger_entries WHERE user_id=j.user_id AND transaction_id=j.id) r
      ON e.account_id=r.account_id AND e.user_id=r.user_id
    WHERE e.user_id=j.user_id AND e.transaction_id=original.id
      AND (r.account_id IS NULL OR e.debit_minor<>r.credit_minor OR e.credit_minor<>r.debit_minor)
   ) THEN RAISE EXCEPTION 'invalid reversal' USING ERRCODE='23514'; END IF;
   IF original.kind='expense' AND EXISTS(SELECT 1 FROM app.ledger_transactions r WHERE r.user_id=j.user_id AND r.original_id=original.id AND r.kind='refund'
    AND NOT EXISTS(SELECT 1 FROM app.ledger_transactions v WHERE v.user_id=r.user_id AND v.original_id=r.id AND v.kind='reversal')) THEN
    RAISE EXCEPTION 'active refunds' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_validate AFTER INSERT OR UPDATE ON app.ledger_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.ledger_validate();
REVOKE ALL ON FUNCTION app.ledger_header_guard(),app.ledger_entry_guard(),app.ledger_validate() FROM PUBLIC;
