CREATE TABLE app.category_templates (
 key text PRIMARY KEY, name text NOT NULL, kind text NOT NULL CHECK(kind IN ('expense','income')), position integer NOT NULL CHECK(position>=0), UNIQUE(key,kind)
);
INSERT INTO app.category_templates(key,name,kind,position) VALUES
 ('food','Alimentación','expense',0),('restaurant','Restaurante','expense',1),('supermarket','Supermercado','expense',2),
 ('transport','Transporte','expense',3),('taxi','Taxi','expense',4),('fuel','Combustible','expense',5),('housing','Vivienda','expense',6),
 ('rent','Alquiler','expense',7),('services','Servicios','expense',8),('technology','Tecnología','expense',9),('education','Educación','expense',10),
 ('health','Salud','expense',11),('entertainment','Entretenimiento','expense',12),('travel','Viajes','expense',13),('clothing','Ropa','expense',14),
 ('shopping','Compras','expense',15),('subscriptions','Suscripciones','expense',16),('debt_costs','Deudas: intereses y comisiones','expense',17),
 ('other_expense','Otros','expense',18),('salary','Sueldo','income',19),('other_income','Otros ingresos','income',20);
REVOKE ALL ON app.category_templates FROM PUBLIC;
GRANT SELECT ON app.category_templates TO finanzas_runtime;
CREATE TABLE app.categories (
 user_id uuid NOT NULL REFERENCES app.users(id), id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 80 AND name=btrim(name) AND name !~ '[[:cntrl:]]'),
 kind text NOT NULL CHECK(kind IN ('expense','income')), template_key text,
 state text NOT NULL CHECK(state IN ('active','archived')), position integer NOT NULL CHECK(position>=0), version bigint NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), operation_id uuid NOT NULL,
 PRIMARY KEY(user_id,id), UNIQUE(user_id,template_key), FOREIGN KEY(template_key,kind) REFERENCES app.category_templates(key,kind),
 FOREIGN KEY(user_id,operation_id) REFERENCES app.catalog_receipts(user_id,operation_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX category_order ON app.categories(user_id,position,id);
CREATE FUNCTION app.category_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.user_id,NEW.id,NEW.kind,NEW.template_key,NEW.created_at) IS DISTINCT FROM (OLD.user_id,OLD.id,OLD.kind,OLD.template_key,OLD.created_at) OR NEW.version<>OLD.version+1 OR NEW.operation_id=OLD.operation_id THEN
   RAISE EXCEPTION 'immutable category identity or invalid version' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.version<>1 OR NEW.state<>'active' THEN RAISE EXCEPTION 'invalid new category' USING ERRCODE='23514'; END IF;
  NEW.created_at=clock_timestamp();
 END IF;
 NEW.updated_at=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER category_guard BEFORE INSERT OR UPDATE ON app.categories FOR EACH ROW EXECUTE FUNCTION app.category_guard();
REVOKE ALL ON FUNCTION app.category_guard() FROM PUBLIC;
ALTER TABLE app.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.categories FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON app.categories TO finanzas_runtime USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON app.categories TO finanzas_runtime;
GRANT UPDATE(name,state,position,version,operation_id) ON app.categories TO finanzas_runtime;
CREATE TABLE app.catalog_audit_entities (
 user_id uuid NOT NULL, operation_id uuid NOT NULL, id uuid NOT NULL, account_id uuid, category_id uuid,
 PRIMARY KEY(user_id,operation_id,id), CHECK((account_id IS NULL)<>(category_id IS NULL)),
 FOREIGN KEY(user_id,operation_id) REFERENCES app.catalog_audit(user_id,operation_id),
 FOREIGN KEY(user_id,account_id) REFERENCES app.product_accounts(user_id,id), FOREIGN KEY(user_id,category_id) REFERENCES app.categories(user_id,id)
);
ALTER TABLE app.catalog_audit_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.catalog_audit_entities FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON app.catalog_audit_entities TO finanzas_runtime USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON app.catalog_audit_entities TO finanzas_runtime;
CREATE FUNCTION app.catalog_mutation_check() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE entity text;
BEGIN
 entity=CASE WHEN TG_TABLE_NAME='product_accounts' THEN 'account' ELSE 'category' END;
 IF NOT EXISTS(SELECT 1 FROM app.catalog_receipts r JOIN app.catalog_audit_entities a ON (a.user_id,a.operation_id)=(r.user_id,r.operation_id)
 WHERE r.user_id=NEW.user_id AND r.operation_id=NEW.operation_id
 AND (CASE WHEN entity='account' THEN a.account_id ELSE a.category_id END)=NEW.id
 AND (r.result->'changes') @> jsonb_build_array(jsonb_build_object('id',NEW.id::text,'entity',entity,'version',NEW.version::text))) THEN
  RAISE EXCEPTION 'mutation absent from catalog receipt or audit' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER account_mutation_check AFTER INSERT OR UPDATE ON app.product_accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.catalog_mutation_check();
CREATE CONSTRAINT TRIGGER category_mutation_check AFTER INSERT OR UPDATE ON app.categories DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.catalog_mutation_check();
REVOKE ALL ON FUNCTION app.catalog_mutation_check() FROM PUBLIC;
