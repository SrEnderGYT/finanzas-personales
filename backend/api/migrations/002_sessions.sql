CREATE TABLE app.sessions (
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '12 hours',
  revoked_at timestamptz,
  PRIMARY KEY (user_id, id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '12 hours')
);
CREATE TABLE app.login_receipts (
  proof_hash text PRIMARY KEY CHECK (proof_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.login_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.login_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY own_sessions ON app.sessions TO finanzas_runtime
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY own_receipts ON app.login_receipts TO finanzas_runtime
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
GRANT SELECT (user_id, id, created_at, last_seen_at, expires_at, revoked_at) ON app.sessions TO finanzas_runtime;
GRANT INSERT (user_id, id, token_hash) ON app.sessions TO finanzas_runtime;
GRANT UPDATE (revoked_at) ON app.sessions TO finanzas_runtime;
GRANT INSERT (proof_hash, user_id) ON app.login_receipts TO finanzas_runtime;

-- A narrow token lookup is necessary before user context exists. The runtime
-- cannot assume this role, read token hashes, or enumerate identities via SQL.
CREATE ROLE finanzas_session_lookup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA app TO finanzas_session_lookup;
GRANT SELECT ON app.sessions TO finanzas_session_lookup;
GRANT UPDATE (last_seen_at) ON app.sessions TO finanzas_session_lookup;
CREATE POLICY resolve_session ON app.sessions TO finanzas_session_lookup USING (true) WITH CHECK (true);
CREATE FUNCTION app.resolve_session(candidate_hash text)
RETURNS TABLE (user_id uuid, session_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $$
  UPDATE app.sessions s SET last_seen_at = statement_timestamp()
  WHERE s.token_hash = candidate_hash AND s.revoked_at IS NULL
    AND s.expires_at > statement_timestamp()
    AND s.last_seen_at > statement_timestamp() - interval '30 minutes'
  RETURNING s.user_id, s.id;
$$;
ALTER FUNCTION app.resolve_session(text) OWNER TO finanzas_session_lookup;
REVOKE ALL ON FUNCTION app.resolve_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_session(text) TO finanzas_runtime;
