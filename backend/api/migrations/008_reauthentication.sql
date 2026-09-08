CREATE TABLE app.reauth_grants (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  purpose text NOT NULL CHECK(purpose = 'mfa-enroll'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '5 minutes',
  consumed_at timestamptz,
  FOREIGN KEY(user_id,session_id) REFERENCES app.sessions(user_id,id) ON DELETE CASCADE,
  CHECK(expires_at > created_at AND expires_at <= created_at + interval '5 minutes 1 second')
);
ALTER TABLE app.reauth_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reauth_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY own_reauth_grants ON app.reauth_grants TO finanzas_auth_runtime
  USING(user_id = nullif(current_setting('app.user_id',true),'')::uuid)
  WITH CHECK(user_id = nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON app.reauth_grants TO finanzas_auth_runtime;
GRANT UPDATE(consumed_at) ON app.reauth_grants TO finanzas_auth_runtime;
