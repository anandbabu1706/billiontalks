CREATE TABLE feedback_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'general-enquiries', 'technical-support', 'feature-suggestions',
    'business-partnerships', 'feedback', 'report-issue'
  )),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 5000),
  rating INTEGER CHECK (rating IS NULL OR (category = 'feedback' AND rating BETWEEN 1 AND 5)),
  affected_feature TEXT,
  context TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (
    (category = 'report-issue' AND affected_feature IS NOT NULL AND length(affected_feature) BETWEEN 1 AND 120
      AND (context IS NULL OR length(context) BETWEEN 1 AND 2000))
    OR (category <> 'report-issue' AND affected_feature IS NULL AND context IS NULL)
  )
);

CREATE INDEX feedback_submissions_expiry ON feedback_submissions(expires_at);
CREATE INDEX feedback_submissions_page ON feedback_submissions(created_at DESC, id DESC);

CREATE TRIGGER feedback_immutable_account
BEFORE UPDATE OF account_id ON feedback_submissions
WHEN NEW.account_id IS NOT OLD.account_id
BEGIN
  SELECT RAISE(ABORT, 'Feedback account identity is immutable');
END;

-- Managed directly in D1 by the owner; deliberately empty and not exposed by any API.
CREATE TABLE feedback_reviewers (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE feedback_rate_limits (
  scope_hash TEXT PRIMARY KEY NOT NULL,
  attempt_count INTEGER NOT NULL,
  window_started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX feedback_rate_limits_expiry ON feedback_rate_limits(updated_at);
