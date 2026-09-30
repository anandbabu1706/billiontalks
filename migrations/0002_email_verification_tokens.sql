CREATE TABLE email_verification_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose = 'EMAIL_VERIFICATION'),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_operation_id TEXT UNIQUE,
  revoked_at TEXT,
  superseded_by_token_id TEXT REFERENCES email_verification_tokens(id),
  CHECK (
    (consumed_at IS NULL AND consumed_operation_id IS NULL) OR
    (consumed_at IS NOT NULL AND consumed_operation_id IS NOT NULL)
  ),
  CHECK (superseded_by_token_id IS NULL OR revoked_at IS NOT NULL)
);

CREATE INDEX idx_email_verification_tokens_account_purpose_created
  ON email_verification_tokens(account_id, purpose, created_at DESC);