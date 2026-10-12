CREATE TABLE scheduled_meetings (
  meeting_id TEXT PRIMARY KEY NOT NULL,
  owner_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  agenda TEXT NOT NULL DEFAULT '' CHECK (length(agenda) <= 1000),
  local_date TEXT NOT NULL CHECK (length(local_date) = 10),
  local_time TEXT NOT NULL CHECK (length(local_time) = 5),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes IN (30, 45, 60, 90, 120)),
  time_zone TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  guest_access TEXT NOT NULL CHECK (guest_access IN ('OPEN', 'HOST_APPROVAL', 'LOCKED')),
  status TEXT NOT NULL CHECK (status IN ('SCHEDULED', 'STARTING', 'STARTED', 'ENDED', 'CANCELLED')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_scheduled_meetings_owner_start
  ON scheduled_meetings(owner_account_id, starts_at);

CREATE INDEX idx_scheduled_meetings_public_status
  ON scheduled_meetings(meeting_id, status);
