CREATE TABLE app.gmail_connections (
  user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  email text,
  scope text NOT NULL DEFAULT 'https://www.googleapis.com/auth/gmail.readonly'
    CHECK (scope = 'https://www.googleapis.com/auth/gmail.readonly'),
  range_days integer NOT NULL DEFAULT 30 CHECK (range_days BETWEEN 1 AND 365),
  refresh_token_envelope jsonb,
  state text NOT NULL DEFAULT 'disconnected'
    CHECK (state IN ('disconnected','connected','reauthorization_required')),
  last_sync_at timestamptz,
  coverage_from date,
  coverage_to date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((coverage_from IS NULL) = (coverage_to IS NULL)),
  CHECK (coverage_from IS NULL OR coverage_from <= coverage_to),
  CHECK (state <> 'connected' OR (email IS NOT NULL AND refresh_token_envelope IS NOT NULL))
);

CREATE TABLE app.gmail_oauth_flows (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  range_days integer NOT NULL CHECK (range_days BETWEEN 1 AND 365),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  used_at timestamptz
);

CREATE TABLE app.gmail_messages (
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  message_id text NOT NULL CHECK (length(message_id) BETWEEN 1 AND 128),
  thread_id text CHECK (thread_id IS NULL OR length(thread_id) <= 128),
  sender text NOT NULL CHECK (length(sender) <= 512),
  subject text NOT NULL CHECK (length(subject) <= 1024),
  snippet text NOT NULL CHECK (length(snippet) <= 2048),
  received_at timestamptz NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,message_id)
);

CREATE TABLE app.gmail_financial_candidates (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  source_message_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'expense','income','transfer','card_charge','card_statement','subscription','debt','payment','unknown'
  )),
  institution text,
  merchant text,
  currency text CHECK (currency IS NULL OR currency IN ('PEN','USD')),
  amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),
  occurred_at timestamptz NOT NULL,
  due_at date,
  confidence integer NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','discarded')),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  summary text NOT NULL CHECK (length(summary) <= 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE(user_id,fingerprint),
  FOREIGN KEY(user_id,source_message_id) REFERENCES app.gmail_messages(user_id,message_id) ON DELETE CASCADE
);

ALTER TABLE app.gmail_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.gmail_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE app.gmail_oauth_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.gmail_oauth_flows FORCE ROW LEVEL SECURITY;
ALTER TABLE app.gmail_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.gmail_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE app.gmail_financial_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.gmail_financial_candidates FORCE ROW LEVEL SECURITY;

CREATE POLICY gmail_connections_auth ON app.gmail_connections TO finanzas_auth_runtime USING(true) WITH CHECK(true);
CREATE POLICY gmail_flows_auth ON app.gmail_oauth_flows TO finanzas_auth_runtime USING(true) WITH CHECK(true);
CREATE POLICY gmail_messages_auth ON app.gmail_messages TO finanzas_auth_runtime USING(true) WITH CHECK(true);
CREATE POLICY gmail_candidates_auth ON app.gmail_financial_candidates TO finanzas_auth_runtime USING(true) WITH CHECK(true);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.gmail_connections TO finanzas_auth_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.gmail_oauth_flows TO finanzas_auth_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.gmail_messages TO finanzas_auth_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.gmail_financial_candidates TO finanzas_auth_runtime;
