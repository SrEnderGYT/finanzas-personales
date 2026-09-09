ALTER TABLE app.mfa_factors ADD COLUMN enrollment_session_id uuid;
ALTER TABLE app.mfa_factors ADD CONSTRAINT enrollment_owner_session
  FOREIGN KEY(user_id,enrollment_session_id) REFERENCES app.sessions(user_id,id);
GRANT INSERT(enrollment_session_id),UPDATE(enrollment_session_id) ON app.mfa_factors TO finanzas_auth_runtime;
