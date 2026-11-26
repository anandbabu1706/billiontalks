-- Jobs-owned, bounded structured document; no account/contact credentials.
CREATE TABLE jobs_profiles (
 subject TEXT PRIMARY KEY REFERENCES jobs_users(subject) ON DELETE CASCADE,
 id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL CHECK(revision>0),
 data TEXT NOT NULL CHECK(json_valid(data)),
 visible_fields TEXT NOT NULL CHECK(json_valid(visible_fields)),
 visibility TEXT NOT NULL CHECK(visibility IN ('PRIVATE','RECRUITERS_ONLY','PUBLIC')),
 indexing INTEGER NOT NULL CHECK(indexing IN (0,1)), updated_at INTEGER NOT NULL,
 CHECK(indexing=0 OR visibility='PUBLIC')
);
-- break
CREATE TRIGGER profile_insert_guard BEFORE INSERT ON jobs_profiles BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM jobs_users WHERE subject=NEW.subject AND eligible=1 AND closed_at IS NULL AND restricted=0)
 OR NOT EXISTS(SELECT 1 FROM restore_gate WHERE ready=1)
 OR EXISTS(SELECT 1 FROM deletion_ledger WHERE record_id=NEW.id)
 THEN RAISE(ABORT,'profile_forbidden') END;
END;
-- break
CREATE TRIGGER profile_update_guard BEFORE UPDATE ON jobs_profiles BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM jobs_users WHERE subject=NEW.subject AND eligible=1 AND closed_at IS NULL AND restricted=0)
 OR NOT EXISTS(SELECT 1 FROM restore_gate WHERE ready=1)
 OR EXISTS(SELECT 1 FROM deletion_ledger WHERE record_id=NEW.id)
 THEN RAISE(ABORT,'profile_forbidden') END;
END;
-- break
CREATE TRIGGER profile_insert_privacy AFTER INSERT ON jobs_profiles BEGIN
 UPDATE jobs_users SET visibility=NEW.visibility,indexing=NEW.indexing WHERE subject=NEW.subject;
END;
-- break
CREATE TRIGGER profile_update_privacy AFTER UPDATE ON jobs_profiles BEGIN
 UPDATE jobs_users SET visibility=NEW.visibility,indexing=NEW.indexing WHERE subject=NEW.subject;
END;
-- break
CREATE TRIGGER profile_delete_privacy AFTER DELETE ON jobs_profiles BEGIN
 UPDATE jobs_users SET visibility='PRIVATE',indexing=0 WHERE subject=OLD.subject;
END;
-- break
-- Closure archive participates in EP-04 retention exceptions/purge/deletion replay.
CREATE TRIGGER profile_close AFTER UPDATE OF closed_at ON jobs_users
WHEN OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL BEGIN
 INSERT INTO retained_records(id,subject,kind,ended_at,restricted,payload)
 SELECT id,subject,'CLOSURE',NEW.closed_at,1,data FROM jobs_profiles WHERE subject=NEW.subject;
 DELETE FROM jobs_profiles WHERE subject=NEW.subject;
END;
-- break
-- Recovery must also remove live profiles covered by a preserved deletion ledger.
CREATE TRIGGER profile_deletion_replay AFTER INSERT ON deletion_ledger BEGIN
 DELETE FROM jobs_profiles WHERE id=NEW.record_id AND subject=NEW.subject;
END;
