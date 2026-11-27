CREATE TABLE meeting_outbox_leases (
 job TEXT PRIMARY KEY REFERENCES interview_meeting_outbox(id) ON DELETE CASCADE,
 token TEXT NOT NULL,expires_at INTEGER NOT NULL
);
-- break
ALTER TABLE security_incidents ADD COLUMN reporting_due_at INTEGER;
