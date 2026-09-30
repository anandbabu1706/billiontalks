CREATE TABLE account_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_account_sessions_account_created
  ON account_sessions(account_id, created_at DESC);

CREATE INDEX idx_account_sessions_expiry
  ON account_sessions(expires_at);

CREATE TABLE account_login_rate_limits (
  scope_hash TEXT PRIMARY KEY NOT NULL,
  window_started_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL CHECK (attempt_count > 0),
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_account_login_rate_limits_updated
  ON account_login_rate_limits(updated_at);