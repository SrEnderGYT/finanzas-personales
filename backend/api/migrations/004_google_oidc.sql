CREATE TABLE app.google_identities (
  subject text PRIMARY KEY CHECK(length(subject) BETWEEN 1 AND 255),
  user_id uuid NOT NULL UNIQUE REFERENCES app.users(id) ON DELETE CASCADE
);
CREATE TABLE app.oidc_flows (
  state_hash text PRIMARY KEY CHECK(state_hash ~ '^[0-9a-f]{64}$'),
  binding_hash text NOT NULL CHECK(binding_hash ~ '^[0-9a-f]{64}$'),
  envelope jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  consumed_at timestamptz
);
ALTER TABLE app.google_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.google_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE app.oidc_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.oidc_flows FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_google ON app.google_identities TO finanzas_auth_runtime USING(true) WITH CHECK(true);
CREATE POLICY auth_oidc ON app.oidc_flows TO finanzas_auth_runtime USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON app.google_identities TO finanzas_auth_runtime;
GRANT SELECT,INSERT ON app.oidc_flows TO finanzas_auth_runtime;
GRANT UPDATE(consumed_at) ON app.oidc_flows TO finanzas_auth_runtime;
