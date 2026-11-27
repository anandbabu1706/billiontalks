CREATE TABLE listing_details (
 company TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)),
 publication TEXT NOT NULL CHECK(publication IN ('DRAFT','PUBLISHED','CLOSED','ARCHIVED')),
 revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 posted_at INTEGER, PRIMARY KEY(company,id)
);
-- break
CREATE INDEX listing_discovery ON listing_details(publication,posted_at DESC,id);
-- break
CREATE TABLE saved_jobs (
 candidate TEXT NOT NULL REFERENCES jobs_users(subject), company TEXT NOT NULL,
 listing TEXT NOT NULL, saved_at INTEGER NOT NULL, PRIMARY KEY(candidate,company,listing)
);
-- break
CREATE TABLE applications (
 id TEXT PRIMARY KEY, candidate TEXT NOT NULL REFERENCES jobs_users(subject),
 company TEXT NOT NULL, listing TEXT NOT NULL, attempt INTEGER NOT NULL CHECK(attempt IN (1,2)),
 status TEXT NOT NULL CHECK(status IN ('SUBMITTED','WITHDRAWN','REJECTED')),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL, withdrawn_at INTEGER, restricted INTEGER NOT NULL DEFAULT 0 CHECK(restricted IN (0,1)),
 UNIQUE(candidate,company,listing,attempt)
);
-- break
CREATE INDEX application_candidate_history ON applications(candidate,created_at DESC,id);
-- break
CREATE INDEX application_listing_access ON applications(company,listing,created_at DESC,id);
-- break
CREATE TABLE application_requests (
 candidate TEXT NOT NULL, company TEXT NOT NULL, listing TEXT NOT NULL,
 request_key TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), at INTEGER NOT NULL,
 result_id TEXT, PRIMARY KEY(candidate,company,listing,request_key)
);
-- break
CREATE TABLE application_events (
 id TEXT PRIMARY KEY, application TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE, actor TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('SUBMIT','WITHDRAW','REJECT')),
 expected_status TEXT, at INTEGER NOT NULL
);
-- break
CREATE TABLE listing_reports (
 id TEXT PRIMARY KEY, company TEXT NOT NULL, listing TEXT NOT NULL, reporter TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(reason IN ('MISLEADING','FRAUD','ABUSE','OTHER')),
 detail TEXT NOT NULL, at INTEGER NOT NULL,
 report_day TEXT GENERATED ALWAYS AS(date(at/1000,'unixepoch')) STORED,
 UNIQUE(company,listing,reporter,report_day)
);
-- break
CREATE TABLE listing_audit (
 id TEXT PRIMARY KEY, company TEXT NOT NULL, listing TEXT NOT NULL,
 actor TEXT NOT NULL, action TEXT NOT NULL, at INTEGER NOT NULL
);
-- break
CREATE TRIGGER listing_details_sync AFTER INSERT ON posting_actions BEGIN
 UPDATE listing_details SET
  data=CASE WHEN json_type(NEW.payload,'$.details')='object' THEN json_extract(NEW.payload,'$.details') ELSE data END,
  publication=CASE NEW.operation WHEN 'CLOSE' THEN 'CLOSED' WHEN 'ARCHIVE' THEN 'ARCHIVED' ELSE 'PUBLISHED' END,
  revision=COALESCE((SELECT revision FROM listings WHERE company=NEW.company AND id=NEW.listing),revision),
  updated_at=NEW.at,
  posted_at=CASE WHEN NEW.operation IN ('CREATE','REOPEN') THEN NEW.at ELSE posted_at END
 WHERE company=NEW.company AND id=NEW.listing;
 INSERT INTO listing_audit VALUES(lower(hex(randomblob(16))),NEW.company,NEW.listing,NEW.actor,NEW.operation,NEW.at);
END;
-- break
-- These triggers deliberately synchronize revisions after the EP-04 quota trigger has inserted or
-- updated the authoritative listing row. SQLite does not promise creation-order execution
-- for multiple AFTER INSERT triggers on posting_actions.
CREATE TRIGGER listing_detail_insert_sync AFTER INSERT ON listings BEGIN
 UPDATE listing_details SET revision=NEW.revision WHERE company=NEW.company AND id=NEW.id;
END;
-- break
CREATE TRIGGER listing_detail_update_sync AFTER UPDATE ON listings BEGIN
 UPDATE listing_details SET revision=NEW.revision WHERE company=NEW.company AND id=NEW.id;
END;
-- break
CREATE TRIGGER application_submit AFTER INSERT ON application_requests BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM jobs_users u JOIN jobs_profiles p ON p.subject=u.subject
  WHERE u.subject=NEW.candidate AND u.eligible=1 AND u.closed_at IS NULL AND u.restricted=0
 ) THEN RAISE(ABORT,'application_forbidden') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM listings l JOIN listing_details d ON d.company=l.company AND d.id=l.id
  JOIN companies c ON c.id=l.company
  WHERE l.company=NEW.company AND l.id=NEW.listing AND l.state='ACTIVE' AND l.expires_at>NEW.at
   AND d.publication='PUBLISHED' AND c.restricted=0
 ) THEN RAISE(ABORT,'application_listing_unavailable') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM applications WHERE candidate=NEW.candidate AND company=NEW.company AND listing=NEW.listing AND status='SUBMITTED'
 ) THEN RAISE(ABORT,'application_duplicate') END;
 SELECT CASE WHEN (SELECT count(*) FROM applications WHERE candidate=NEW.candidate AND company=NEW.company AND listing=NEW.listing)>=2
  THEN RAISE(ABORT,'application_reapply_denied') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM applications WHERE candidate=NEW.candidate AND company=NEW.company AND listing=NEW.listing AND status='REJECTED'
 ) THEN RAISE(ABORT,'application_reapply_denied') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM applications WHERE candidate=NEW.candidate AND company=NEW.company AND listing=NEW.listing
   AND status='WITHDRAWN' AND withdrawn_at+86400000>NEW.at
 ) THEN RAISE(ABORT,'application_wait_required') END;
 INSERT INTO applications(id,candidate,company,listing,attempt,status,snapshot,created_at,updated_at)
 VALUES(json_extract(NEW.payload,'$.id'),NEW.candidate,NEW.company,NEW.listing,
  1+(SELECT count(*) FROM applications WHERE candidate=NEW.candidate AND company=NEW.company AND listing=NEW.listing),
  'SUBMITTED',json_extract(NEW.payload,'$.snapshot'),NEW.at,NEW.at);
 UPDATE application_requests SET result_id=json_extract(NEW.payload,'$.id')
 WHERE candidate=NEW.candidate AND company=NEW.company AND listing=NEW.listing AND request_key=NEW.request_key;
 INSERT INTO application_events VALUES(lower(hex(randomblob(16))),json_extract(NEW.payload,'$.id'),NEW.candidate,'SUBMIT',NULL,NEW.at);
END;
-- break
CREATE TRIGGER application_transition AFTER INSERT ON application_events WHEN NEW.action<>'SUBMIT' BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM applications WHERE id=NEW.application AND status=NEW.expected_status
   AND ((NEW.action='WITHDRAW' AND candidate=NEW.actor) OR (NEW.action='REJECT' AND EXISTS(
    SELECT 1 FROM assignments WHERE company=applications.company AND listing=applications.listing AND subject=NEW.actor)) )
 ) THEN RAISE(ABORT,'application_conflict') END;
 UPDATE applications SET status=CASE NEW.action WHEN 'WITHDRAW' THEN 'WITHDRAWN' ELSE 'REJECTED' END,
  withdrawn_at=CASE WHEN NEW.action='WITHDRAW' THEN NEW.at ELSE withdrawn_at END,updated_at=NEW.at WHERE id=NEW.application;
 INSERT OR REPLACE INTO retained_records(id,subject,kind,ended_at,restricted,payload)
 SELECT id,candidate,'APPLICATION',NEW.at,restricted,snapshot FROM applications WHERE id=NEW.application;
END;
-- break
CREATE TRIGGER applications_on_jobs_close AFTER UPDATE OF closed_at ON jobs_users
WHEN OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL BEGIN
 UPDATE applications SET restricted=1,updated_at=NEW.closed_at WHERE candidate=NEW.subject;
 INSERT OR REPLACE INTO retained_records(id,subject,kind,ended_at,restricted,payload)
 SELECT id,candidate,'APPLICATION',NEW.closed_at,1,snapshot FROM applications WHERE candidate=NEW.subject;
 DELETE FROM saved_jobs WHERE candidate=NEW.subject;
END;
-- break
CREATE TRIGGER application_deletion_replay AFTER INSERT ON deletion_ledger BEGIN
 DELETE FROM applications WHERE id=NEW.record_id AND candidate=NEW.subject;
END;
