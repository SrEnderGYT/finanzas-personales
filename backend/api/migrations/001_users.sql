-- Runtime never owns tables and never receives DDL, TRUNCATE or BYPASSRLS.
CREATE ROLE finanzas_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO finanzas_runtime;
CREATE TABLE app.users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  locale text NOT NULL DEFAULT 'es-PE' CHECK (locale = 'es-PE'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.users FORCE ROW LEVEL SECURITY;
ALTER TABLE app.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.user_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY own_user ON app.users TO finanzas_runtime
  USING (id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY own_preferences ON app.user_preferences TO finanzas_runtime
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
GRANT SELECT ON app.users TO finanzas_runtime;
GRANT SELECT, INSERT ON app.user_preferences TO finanzas_runtime;
GRANT UPDATE (theme, locale, updated_at) ON app.user_preferences TO finanzas_runtime;
