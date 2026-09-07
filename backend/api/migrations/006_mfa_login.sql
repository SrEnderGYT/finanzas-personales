CREATE TABLE app.mfa_challenges (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
  consumed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5)
);
ALTER TABLE app.mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.mfa_challenges FORCE ROW LEVEL SECURITY;
-- Authentication must resolve an opaque challenge before it knows the owner.
CREATE POLICY auth_mfa_challenge ON app.mfa_challenges TO finanzas_auth_runtime
  USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON app.mfa_challenges TO finanzas_auth_runtime;
GRANT UPDATE(consumed_at,attempts) ON app.mfa_challenges TO finanzas_auth_runtime;
-- Session issuance needs only the active flag, never the encrypted secret.
GRANT SELECT(user_id,active) ON app.mfa_factors TO finanzas_runtime;
CREATE POLICY own_factor_status ON app.mfa_factors FOR SELECT TO finanzas_runtime
  USING(user_id = nullif(current_setting('app.user_id',true),'')::uuid);
