CREATE ROLE finanzas_auth_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA app TO finanzas_auth_runtime;
CREATE TABLE app.credentials (
  user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE CHECK (length(email) <= 254 AND email = lower(email)),
  password_hash text,
  verified boolean NOT NULL DEFAULT false,
  CHECK (NOT verified OR password_hash IS NOT NULL)
);
CREATE TABLE app.email_challenges (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES app.credentials(user_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('verify', 'reset')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  used_at timestamptz
);
CREATE TABLE app.auth_rate_limits (
  key_hash text NOT NULL,
  bucket bigint NOT NULL,
  hits integer NOT NULL DEFAULT 1,
  PRIMARY KEY(key_hash,bucket)
);
CREATE TABLE app.auth_mail_outbox (
  id uuid PRIMARY KEY,
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
ALTER TABLE app.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE app.email_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.email_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE app.auth_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_rate_limits FORCE ROW LEVEL SECURITY;
ALTER TABLE app.auth_mail_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_mail_outbox FORCE ROW LEVEL SECURITY;
-- Only the authentication service has cross-user credential access. No financial grants.
CREATE POLICY auth_credentials ON app.credentials TO finanzas_auth_runtime USING(true) WITH CHECK(true);
CREATE POLICY auth_challenges ON app.email_challenges TO finanzas_auth_runtime USING(true) WITH CHECK(true);
CREATE POLICY auth_limits ON app.auth_rate_limits TO finanzas_auth_runtime USING(true) WITH CHECK(true);
CREATE POLICY auth_mail ON app.auth_mail_outbox TO finanzas_auth_runtime USING(true) WITH CHECK(true);
GRANT SELECT, INSERT ON app.credentials TO finanzas_auth_runtime;
GRANT UPDATE(password_hash,verified) ON app.credentials TO finanzas_auth_runtime;
GRANT SELECT, INSERT ON app.email_challenges TO finanzas_auth_runtime;
GRANT UPDATE(used_at) ON app.email_challenges TO finanzas_auth_runtime;
GRANT SELECT, INSERT, UPDATE ON app.auth_rate_limits TO finanzas_auth_runtime;
GRANT SELECT, INSERT ON app.auth_mail_outbox TO finanzas_auth_runtime;
GRANT UPDATE(sent_at) ON app.auth_mail_outbox TO finanzas_auth_runtime;
GRANT INSERT(id) ON app.users TO finanzas_auth_runtime;
CREATE POLICY auth_create_user ON app.users FOR INSERT TO finanzas_auth_runtime WITH CHECK(true);
GRANT SELECT(user_id,id,created_at,last_seen_at,expires_at,revoked_at) ON app.sessions TO finanzas_auth_runtime;
GRANT INSERT(user_id,id,token_hash) ON app.sessions TO finanzas_auth_runtime;
GRANT UPDATE(revoked_at) ON app.sessions TO finanzas_auth_runtime;
CREATE POLICY auth_sessions ON app.sessions TO finanzas_auth_runtime
  USING(user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK(user_id = nullif(current_setting('app.user_id', true), '')::uuid);
