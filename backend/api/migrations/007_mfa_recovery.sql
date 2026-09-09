CREATE TABLE app.mfa_recovery_codes (
  user_id uuid NOT NULL REFERENCES app.mfa_factors(user_id) ON DELETE CASCADE,
  code_hash text NOT NULL CHECK(code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  PRIMARY KEY(user_id,code_hash)
);
ALTER TABLE app.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.mfa_recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY own_recovery_codes ON app.mfa_recovery_codes TO finanzas_auth_runtime
  USING(user_id = nullif(current_setting('app.user_id',true),'')::uuid)
  WITH CHECK(user_id = nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,DELETE ON app.mfa_recovery_codes TO finanzas_auth_runtime;
GRANT UPDATE(consumed_at) ON app.mfa_recovery_codes TO finanzas_auth_runtime;
