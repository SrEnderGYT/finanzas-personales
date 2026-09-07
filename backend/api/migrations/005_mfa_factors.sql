CREATE TABLE app.mfa_factors (
  user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  envelope jsonb NOT NULL,
  active boolean NOT NULL DEFAULT false,
  last_used_step bigint NOT NULL DEFAULT -1 CHECK(last_used_step >= -1),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 5),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CHECK(active = (confirmed_at IS NOT NULL))
);
ALTER TABLE app.mfa_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.mfa_factors FORCE ROW LEVEL SECURITY;
CREATE POLICY own_auth_factor ON app.mfa_factors TO finanzas_auth_runtime
  USING(user_id = nullif(current_setting('app.user_id',true),'')::uuid)
  WITH CHECK(user_id = nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON app.mfa_factors TO finanzas_auth_runtime;
GRANT UPDATE(envelope,active,last_used_step,failed_attempts,locked_until,created_at,confirmed_at)
  ON app.mfa_factors TO finanzas_auth_runtime;
