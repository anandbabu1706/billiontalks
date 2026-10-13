CREATE TABLE account_preferences (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  default_duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (default_duration_minutes IN (30, 45, 60, 90, 120)),
  default_guest_access TEXT NOT NULL DEFAULT 'HOST_APPROVAL' CHECK (default_guest_access IN ('OPEN', 'HOST_APPROVAL', 'LOCKED')),
  notify_meeting_events INTEGER NOT NULL DEFAULT 1 CHECK (notify_meeting_events IN (0, 1)),
  notify_invitation_events INTEGER NOT NULL DEFAULT 1 CHECK (notify_invitation_events IN (0, 1)),
  updated_at TEXT NOT NULL
);

INSERT INTO account_preferences (account_id, updated_at)
SELECT id, updated_at FROM accounts;

CREATE TABLE account_entitlements (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL DEFAULT 'BASELINE',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  updated_at TEXT NOT NULL
);

INSERT INTO account_entitlements (account_id, updated_at)
SELECT id, updated_at FROM accounts;

CREATE TABLE account_notifications (
  notification_id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('MEETING', 'INVITATION')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body TEXT NOT NULL CHECK (length(body) <= 500),
  meeting_id TEXT,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (account_id, event_key)
);

CREATE INDEX idx_account_notifications_unread
  ON account_notifications(account_id, is_read, created_at DESC);
