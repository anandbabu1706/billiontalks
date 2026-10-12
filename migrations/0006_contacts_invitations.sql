CREATE TABLE contacts (
  contact_id TEXT PRIMARY KEY NOT NULL,
  owner_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  email_normalized TEXT NOT NULL CHECK (length(email_normalized) <= 254),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_account_id, email_normalized)
);

CREATE INDEX idx_contacts_owner_name
  ON contacts(owner_account_id, display_name COLLATE NOCASE);

CREATE UNIQUE INDEX idx_scheduled_meetings_id_owner
  ON scheduled_meetings(meeting_id, owner_account_id);

CREATE TABLE meeting_invitations (
  invitation_id TEXT PRIMARY KEY NOT NULL,
  meeting_id TEXT NOT NULL,
  owner_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(contact_id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL CHECK (length(recipient_email) <= 254),
  recipient_name TEXT NOT NULL CHECK (length(recipient_name) <= 120),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED')),
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED')),
  expires_at TEXT NOT NULL,
  responded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (meeting_id, owner_account_id)
    REFERENCES scheduled_meetings(meeting_id, owner_account_id) ON DELETE CASCADE,
  UNIQUE (meeting_id, recipient_email)
);

CREATE INDEX idx_invitations_owner_meeting
  ON meeting_invitations(owner_account_id, meeting_id, created_at);

CREATE INDEX idx_invitations_token_expiry
  ON meeting_invitations(token_hash, expires_at);
