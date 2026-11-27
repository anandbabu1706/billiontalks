-- Close access immediately and keep deletion review open while retention applies.
CREATE TRIGGER protect_delete_review_hold BEFORE UPDATE OF status ON privacy_requests
WHEN OLD.kind='DELETE' AND NEW.status='REVIEWING' AND EXISTS(
 SELECT 1 FROM legal_holds WHERE subject=OLD.subject AND released_at IS NULL)
BEGIN SELECT RAISE(ABORT,'legal_hold_active'); END;
-- break
-- Application commands also carry a copy of the submitted profile snapshot.
CREATE TRIGGER erase_application_commands BEFORE DELETE ON applications BEGIN
 DELETE FROM application_requests WHERE candidate=OLD.candidate AND result_id=OLD.id;
 DELETE FROM interview_reminder_outbox WHERE interview IN (SELECT id FROM interviews WHERE application=OLD.id);
 DELETE FROM interview_commands WHERE interview IN (SELECT id FROM interviews WHERE application=OLD.id);
 DELETE FROM interview_feedback_commands WHERE interview IN (SELECT id FROM interviews WHERE application=OLD.id);
END;
-- break
CREATE TABLE jobs_subject_deletions (
 request_id TEXT PRIMARY KEY,subject TEXT NOT NULL,completed_at INTEGER NOT NULL
);
-- break
CREATE TRIGGER record_subject_deletion BEFORE INSERT ON jobs_subject_deletions
WHEN EXISTS(SELECT 1 FROM legal_holds WHERE subject=NEW.subject AND released_at IS NULL)
BEGIN SELECT RAISE(ABORT,'legal_hold_active'); END;
-- break
CREATE TRIGGER apply_subject_deletion AFTER INSERT ON jobs_subject_deletions BEGIN
 UPDATE jobs_users SET closed_at=COALESCE(closed_at,NEW.completed_at),visibility='PRIVATE',indexing=0 WHERE subject=NEW.subject;
 DELETE FROM jobs_consent_events WHERE subject=NEW.subject;
 DELETE FROM jobs_notifications WHERE candidate=NEW.subject;
 DELETE FROM interview_reminder_outbox WHERE candidate=NEW.subject;
 DELETE FROM saved_jobs WHERE candidate=NEW.subject;
 DELETE FROM assignments WHERE subject=NEW.subject;
 UPDATE admin_grants SET revoked_at=COALESCE(revoked_at,NEW.completed_at) WHERE subject=NEW.subject AND product='BILLIONJOBS';
 UPDATE platform_roles SET revoked_at=COALESCE(revoked_at,NEW.completed_at) WHERE subject=NEW.subject;
 DELETE FROM application_requests WHERE candidate=NEW.subject AND NOT EXISTS(SELECT 1 FROM applications a WHERE a.id=application_requests.result_id);
 UPDATE moderation_events SET internal_note=NULL,evidence_ref=NULL WHERE case_id IN
 (SELECT id FROM moderation_cases WHERE reporter=NEW.subject OR target_ref=NEW.subject);
 UPDATE enforcement_actions SET evidence_ref=NULL WHERE target_kind IN ('USER','RECRUITER') AND target_ref=NEW.subject;
 UPDATE enforcement_appeals SET reason='[removed]',decision_note=NULL WHERE appellant=NEW.subject;
 UPDATE appeal_history SET message=NULL WHERE appeal IN (SELECT id FROM enforcement_appeals WHERE appellant=NEW.subject);
 UPDATE privacy_requests SET status='COMPLETED',completed_at=NEW.completed_at WHERE id=NEW.request_id AND subject=NEW.subject AND kind='DELETE';
END;
