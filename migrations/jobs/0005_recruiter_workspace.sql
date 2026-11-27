CREATE TABLE recruitment_cases (
 application TEXT PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('RECEIVED','UNDER_REVIEW','SHORTLISTED','SELECTED','OFFER_EXTENDED','ACCEPTED','DECLINED','JOINED','REJECTED','WITHDRAWN','ACCEPTANCE_WITHDRAWN','NON_JOINING')),
 revision INTEGER NOT NULL DEFAULT 1, reviewer TEXT, updated_at INTEGER NOT NULL
);
-- break
CREATE TABLE recruitment_events (
 id TEXT PRIMARY KEY, application TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
 actor TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, metadata TEXT NOT NULL CHECK(json_valid(metadata)), at INTEGER NOT NULL
);
-- break
CREATE INDEX recruitment_event_history ON recruitment_events(application,at,id);
-- break
CREATE TABLE recruitment_commands (
 application TEXT NOT NULL, actor TEXT NOT NULL, request_key TEXT NOT NULL,
 to_status TEXT NOT NULL, expected_revision INTEGER NOT NULL, metadata TEXT NOT NULL CHECK(json_valid(metadata)), at INTEGER NOT NULL,
 result_revision INTEGER, PRIMARY KEY(application,actor,request_key)
);
-- break
CREATE TABLE recruitment_notes (
 id TEXT PRIMARY KEY, application TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
 company TEXT NOT NULL, listing TEXT NOT NULL, author TEXT NOT NULL,
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), at INTEGER NOT NULL
);
-- break
CREATE INDEX recruitment_notes_access ON recruitment_notes(application,at,id);
-- break
CREATE TABLE note_commands (
 application TEXT NOT NULL, actor TEXT NOT NULL, request_key TEXT NOT NULL,
 note_id TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL,
 PRIMARY KEY(application,actor,request_key)
);
-- break
CREATE TABLE assignment_commands (
 company TEXT NOT NULL, listing TEXT NOT NULL, actor TEXT NOT NULL, request_key TEXT NOT NULL,
 subject TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('ASSIGN','REMOVE')), at INTEGER NOT NULL,
 PRIMARY KEY(company,listing,actor,request_key)
);
-- break
CREATE TABLE assignment_events (
 id TEXT PRIMARY KEY, company TEXT NOT NULL, listing TEXT NOT NULL, actor TEXT NOT NULL,
 subject TEXT NOT NULL, operation TEXT NOT NULL, at INTEGER NOT NULL
);
-- break
CREATE TABLE jobs_notifications (
 id TEXT PRIMARY KEY, candidate TEXT NOT NULL REFERENCES jobs_users(subject), application TEXT NOT NULL,
 event_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)),
 at INTEGER NOT NULL, read_at INTEGER
);
-- break
CREATE INDEX jobs_notification_inbox ON jobs_notifications(candidate,read_at,at DESC,id);
-- break
CREATE TRIGGER application_case_create AFTER INSERT ON applications BEGIN
 INSERT INTO recruitment_cases VALUES(NEW.id,'RECEIVED',1,NULL,NEW.created_at);
 INSERT INTO recruitment_events VALUES(lower(hex(randomblob(16))),NEW.id,NEW.candidate,NULL,'RECEIVED','{}',NEW.created_at);
END;
-- break
INSERT INTO recruitment_cases(application,status,revision,reviewer,updated_at)
 SELECT id,CASE status WHEN 'REJECTED' THEN 'REJECTED' WHEN 'WITHDRAWN' THEN 'WITHDRAWN' ELSE 'RECEIVED' END,1,NULL,updated_at
 FROM applications WHERE 1 ON CONFLICT(application) DO NOTHING;
-- break
INSERT INTO recruitment_events(id,application,actor,from_status,to_status,metadata,at)
 SELECT lower(hex(randomblob(16))),a.id,a.candidate,NULL,r.status,json_object('migration','EP-08'),a.updated_at
 FROM applications a JOIN recruitment_cases r ON r.application=a.id
 WHERE NOT EXISTS(SELECT 1 FROM recruitment_events e WHERE e.application=a.id);
-- break
CREATE TRIGGER recruitment_command_apply AFTER INSERT ON recruitment_commands BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM recruitment_cases r JOIN applications a ON a.id=r.application
  WHERE r.application=NEW.application AND r.revision=NEW.expected_revision AND a.restricted=0
   AND NOT EXISTS(SELECT 1 FROM deletion_ledger WHERE record_id=a.id)
 ) THEN RAISE(ABORT,'recruitment_conflict') END;
 SELECT CASE WHEN NOT (
  (NEW.to_status='UNDER_REVIEW' AND (SELECT status FROM recruitment_cases WHERE application=NEW.application) IN ('RECEIVED','SHORTLISTED')) OR
  (NEW.to_status='SHORTLISTED' AND (SELECT status FROM recruitment_cases WHERE application=NEW.application) IN ('RECEIVED','UNDER_REVIEW')) OR
  (NEW.to_status='SELECTED' AND (SELECT status FROM recruitment_cases WHERE application=NEW.application) IN ('RECEIVED','UNDER_REVIEW','SHORTLISTED')) OR
  (NEW.to_status='OFFER_EXTENDED' AND (SELECT status FROM recruitment_cases WHERE application=NEW.application) IN ('RECEIVED','UNDER_REVIEW','SHORTLISTED','SELECTED')) OR
  (NEW.to_status='REJECTED' AND (SELECT status FROM recruitment_cases WHERE application=NEW.application) IN ('RECEIVED','UNDER_REVIEW','SHORTLISTED','SELECTED','OFFER_EXTENDED')) OR
  (NEW.to_status IN ('ACCEPTED','DECLINED') AND (SELECT status FROM recruitment_cases WHERE application=NEW.application)='OFFER_EXTENDED') OR
  (NEW.to_status IN ('ACCEPTANCE_WITHDRAWN','NON_JOINING') AND (SELECT status FROM recruitment_cases WHERE application=NEW.application)='ACCEPTED') OR
  (NEW.to_status='JOINED' AND (SELECT status FROM recruitment_cases WHERE application=NEW.application)='ACCEPTED') OR
  (NEW.to_status='WITHDRAWN' AND (SELECT status FROM recruitment_cases WHERE application=NEW.application) IN ('RECEIVED','UNDER_REVIEW','SHORTLISTED','SELECTED'))
 ) THEN RAISE(ABORT,'recruitment_transition') END;
 SELECT CASE WHEN NEW.to_status IN ('ACCEPTED','DECLINED','ACCEPTANCE_WITHDRAWN','NON_JOINING','WITHDRAWN') AND NOT EXISTS(
  SELECT 1 FROM applications a JOIN jobs_users u ON u.subject=a.candidate
  WHERE a.id=NEW.application AND a.candidate=NEW.actor AND u.eligible=1 AND u.closed_at IS NULL AND u.restricted=0
 ) THEN RAISE(ABORT,'recruitment_forbidden') END;
 SELECT CASE WHEN NEW.to_status NOT IN ('ACCEPTED','DECLINED','ACCEPTANCE_WITHDRAWN','NON_JOINING','WITHDRAWN') AND NOT EXISTS(
  SELECT 1 FROM applications a JOIN assignments x ON x.company=a.company AND x.listing=a.listing AND x.subject=NEW.actor
  JOIN memberships m ON m.company=x.company AND m.subject=x.subject JOIN jobs_users u ON u.subject=x.subject
  JOIN companies c ON c.id=x.company WHERE a.id=NEW.application AND m.revoked_at IS NULL AND c.restricted=0
   AND u.eligible=1 AND u.closed_at IS NULL AND u.restricted=0
 ) THEN RAISE(ABORT,'recruitment_forbidden') END;
 INSERT INTO recruitment_events
  SELECT lower(hex(randomblob(16))),NEW.application,NEW.actor,status,NEW.to_status,NEW.metadata,NEW.at
  FROM recruitment_cases WHERE application=NEW.application;
 UPDATE recruitment_cases SET status=NEW.to_status,revision=revision+1,
  reviewer=CASE WHEN NEW.to_status IN ('ACCEPTED','DECLINED','ACCEPTANCE_WITHDRAWN','NON_JOINING','WITHDRAWN') THEN reviewer ELSE NEW.actor END,
  updated_at=NEW.at WHERE application=NEW.application AND revision=NEW.expected_revision;
 UPDATE applications SET status=CASE NEW.to_status WHEN 'REJECTED' THEN 'REJECTED' WHEN 'WITHDRAWN' THEN 'WITHDRAWN' ELSE status END,
  withdrawn_at=CASE WHEN NEW.to_status='WITHDRAWN' THEN NEW.at ELSE withdrawn_at END,updated_at=NEW.at WHERE id=NEW.application;
 INSERT OR REPLACE INTO retained_records(id,subject,kind,ended_at,restricted,payload)
  SELECT a.id,a.candidate,'APPLICATION',NEW.at,a.restricted,a.snapshot FROM applications a
  WHERE a.id=NEW.application AND NEW.to_status IN ('REJECTED','WITHDRAWN','DECLINED','JOINED','ACCEPTANCE_WITHDRAWN','NON_JOINING');
 INSERT OR IGNORE INTO jobs_notifications(id,candidate,application,event_key,kind,data,at)
  SELECT lower(hex(randomblob(16))),a.candidate,a.id,'recruitment:'||NEW.application||':'||(NEW.expected_revision+1),NEW.to_status,
   json_object('company',a.company,'listing',a.listing,'status',NEW.to_status),NEW.at FROM applications a
  WHERE a.id=NEW.application AND NEW.actor<>a.candidate;
 UPDATE recruitment_commands SET result_revision=NEW.expected_revision+1
  WHERE application=NEW.application AND actor=NEW.actor AND request_key=NEW.request_key;
END;
-- break
CREATE TRIGGER recruitment_withdraw_sync AFTER INSERT ON application_events WHEN NEW.action='WITHDRAW' BEGIN
 INSERT INTO recruitment_events
  SELECT lower(hex(randomblob(16))),NEW.application,NEW.actor,status,'WITHDRAWN','{}',NEW.at FROM recruitment_cases WHERE application=NEW.application;
 UPDATE recruitment_cases SET status='WITHDRAWN',revision=revision+1,updated_at=NEW.at WHERE application=NEW.application;
END;
-- break
CREATE TRIGGER recruitment_reject_sync AFTER INSERT ON application_events WHEN NEW.action='REJECT' BEGIN
 INSERT INTO recruitment_events
  SELECT lower(hex(randomblob(16))),NEW.application,NEW.actor,status,'REJECTED','{}',NEW.at FROM recruitment_cases WHERE application=NEW.application;
 UPDATE recruitment_cases SET status='REJECTED',revision=revision+1,reviewer=NEW.actor,updated_at=NEW.at WHERE application=NEW.application;
 INSERT OR IGNORE INTO jobs_notifications(id,candidate,application,event_key,kind,data,at)
  SELECT lower(hex(randomblob(16))),candidate,id,'legacy-reject:'||NEW.id,'REJECTED',json_object('company',company,'listing',listing,'status','REJECTED'),NEW.at FROM applications WHERE id=NEW.application;
END;
-- break
CREATE TRIGGER assignment_command_apply AFTER INSERT ON assignment_commands BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM memberships admin JOIN jobs_users u ON u.subject=admin.subject JOIN companies c ON c.id=admin.company
  WHERE admin.company=NEW.company AND admin.subject=NEW.actor AND admin.role='COMPANY_ADMIN' AND admin.revoked_at IS NULL
   AND u.eligible=1 AND u.closed_at IS NULL AND u.restricted=0 AND c.restricted=0
 ) THEN RAISE(ABORT,'assignment_forbidden') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM listings WHERE company=NEW.company AND id=NEW.listing)
  OR NOT EXISTS(SELECT 1 FROM memberships WHERE company=NEW.company AND subject=NEW.subject AND revoked_at IS NULL)
  THEN RAISE(ABORT,'assignment_invalid') END;
 INSERT OR IGNORE INTO assignments(company,listing,subject)
  SELECT NEW.company,NEW.listing,NEW.subject WHERE NEW.operation='ASSIGN';
 DELETE FROM assignments WHERE company=NEW.company AND listing=NEW.listing AND subject=NEW.subject AND NEW.operation='REMOVE';
 INSERT INTO assignment_events VALUES(lower(hex(randomblob(16))),NEW.company,NEW.listing,NEW.actor,NEW.subject,NEW.operation,NEW.at);
END;
-- break
CREATE TRIGGER note_command_apply AFTER INSERT ON note_commands BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM applications a JOIN assignments x ON x.company=a.company AND x.listing=a.listing AND x.subject=NEW.actor
  JOIN memberships m ON m.company=x.company AND m.subject=x.subject JOIN jobs_users u ON u.subject=x.subject JOIN companies c ON c.id=x.company
  WHERE a.id=NEW.application AND a.restricted=0 AND m.revoked_at IS NULL AND u.eligible=1 AND u.closed_at IS NULL AND u.restricted=0 AND c.restricted=0
 ) THEN RAISE(ABORT,'note_forbidden') END;
 INSERT INTO recruitment_notes(id,application,company,listing,author,body,at)
  SELECT NEW.note_id,a.id,a.company,a.listing,NEW.actor,NEW.body,NEW.at FROM applications a WHERE a.id=NEW.application;
 INSERT INTO recruitment_events VALUES(lower(hex(randomblob(16))),NEW.application,NEW.actor,NULL,'NOTE_ADDED',json_object('note',NEW.note_id),NEW.at);
END;
-- break
CREATE TRIGGER recruitment_application_delete AFTER DELETE ON applications BEGIN
 DELETE FROM jobs_notifications WHERE application=OLD.id;
 DELETE FROM recruitment_commands WHERE application=OLD.id;
 DELETE FROM note_commands WHERE application=OLD.id;
END;
