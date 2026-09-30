CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  full_name TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  country_code TEXT NOT NULL CHECK (length(country_code) = 2),
  mobile_e164 TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'PENDING_EMAIL_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'CLOSED'
  )),
  email_verified_at TEXT,
  mobile_verified_at TEXT,
  terms_accepted_at TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0, 1)),
  marketing_consent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (marketing_consent = 1 AND marketing_consent_at IS NOT NULL) OR
    (marketing_consent = 0 AND marketing_consent_at IS NULL)
  )
);

CREATE TABLE account_password_credentials (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  changed_at TEXT NOT NULL
);