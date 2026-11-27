CREATE TABLE interviews (
 id TEXT PRIMARY KEY, application TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
 company TEXT NOT NULL, listing TEXT NOT NULL, round INTEGER NOT NULL CHECK(round BETWEEN 1 AND 20),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160), instructions TEXT NOT NULL CHECK(length(instructions)<=4000),
 duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 15 AND 480), scheduling_timezone TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('REQUESTED','CONFIRMED','DECLINED','RESCHEDULING','CANCELLED','COMPLETED','NO_SHOW','EXPIRED')),
 revision INTEGER NOT NULL DEFAULT 1, confirmed_slot TEXT, meeting_ref TEXT, meeting_state TEXT NOT NULL DEFAULT 'NONE' CHECK(meeting_state IN ('NONE','PENDING','ACTIVE','REVOKE_PENDING','REVOKED','FAILED')),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(application,round)
);
-- break
CREATE INDEX interview_application_history ON interviews(application,round,id);
-- break
CREATE INDEX interview_company_calendar ON interviews(company,state,updated_at,id);
-- break
CREATE TABLE interview_slots (
 id TEXT PRIMARY KEY, interview TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
 starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, original_timezone TEXT NOT NULL,
 expires_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('PROPOSED','CONFIRMED','DECLINED','SUPERSEDED')),
 created_at INTEGER NOT NULL, UNIQUE(interview,starts_at)
);
-- break
CREATE INDEX interview_slot_lookup ON interview_slots(interview,status,starts_at,id);
-- break
CREATE TABLE interview_participants (
 interview TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE, subject TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('CANDIDATE','INTERVIEWER')), added_by TEXT NOT NULL, added_at INTEGER NOT NULL,
 PRIMARY KEY(interview,subject)
);
-- break
CREATE INDEX interview_participant_calendar ON interview_participants(subject,interview);
-- break
CREATE TABLE interview_events (
 id TEXT PRIMARY KEY, interview TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
 actor TEXT NOT NULL, from_state TEXT, to_state TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), at INTEGER NOT NULL
);
-- break
CREATE INDEX interview_event_history ON interview_events(interview,at,id);
-- break
CREATE TABLE interview_create_commands (
 application TEXT NOT NULL, actor TEXT NOT NULL, request_key TEXT NOT NULL,
 interview_id TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(application,actor,request_key)
);
-- break
CREATE TABLE interview_commands (
 interview TEXT NOT NULL, actor TEXT NOT NULL, request_key TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('CONFIRM','DECLINE','REQUEST_ALTERNATIVE','RESCHEDULE','CANCEL','COMPLETE','NO_SHOW')),
 expected_revision INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), at INTEGER NOT NULL, result_revision INTEGER,
 PRIMARY KEY(interview,actor,request_key)
);
-- break
CREATE TABLE interview_feedback (
 interview TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE, author TEXT NOT NULL,
 criteria TEXT NOT NULL CHECK(json_valid(criteria) AND length(criteria)<=12000), recommendation TEXT NOT NULL CHECK(recommendation IN ('STRONG_YES','YES','MIXED','NO','STRONG_NO','NOT_ASSESSED')),
 summary TEXT NOT NULL CHECK(length(summary)<=4000), submitted_at INTEGER NOT NULL,
 PRIMARY KEY(interview,author)
);
-- break
CREATE TABLE interview_feedback_commands (
 interview TEXT NOT NULL, author TEXT NOT NULL, request_key TEXT NOT NULL,
 criteria TEXT NOT NULL, recommendation TEXT NOT NULL, summary TEXT NOT NULL, at INTEGER NOT NULL,
 PRIMARY KEY(interview,author,request_key)
);
-- break
CREATE TABLE interview_meeting_outbox (
 id TEXT PRIMARY KEY, interview TEXT NOT NULL, interview_revision INTEGER NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('ACTIVATE','REVOKE')), payload TEXT NOT NULL CHECK(json_valid(payload)),
 status TEXT NOT NULL CHECK(status IN ('PENDING','COMPLETED','FAILED')), attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(interview,interview_revision,operation)
);
-- break
CREATE INDEX interview_outbox_due ON interview_meeting_outbox(status,next_attempt_at,created_at,id);
-- break
CREATE TRIGGER interview_command_apply AFTER INSERT ON interview_commands BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM interviews WHERE id=NEW.interview AND revision=NEW.expected_revision)
  THEN RAISE(ABORT,'interview_conflict') END;
 SELECT CASE WHEN NOT (
  (NEW.action='CONFIRM' AND (SELECT state FROM interviews WHERE id=NEW.interview) IN ('REQUESTED','RESCHEDULING')) OR
  (NEW.action IN ('DECLINE','REQUEST_ALTERNATIVE') AND (SELECT state FROM interviews WHERE id=NEW.interview)='REQUESTED') OR
  (NEW.action='RESCHEDULE' AND (SELECT state FROM interviews WHERE id=NEW.interview)='CONFIRMED') OR
  (NEW.action='CANCEL' AND (SELECT state FROM interviews WHERE id=NEW.interview) IN ('REQUESTED','CONFIRMED','RESCHEDULING')) OR
  (NEW.action IN ('COMPLETE','NO_SHOW') AND (SELECT state FROM interviews WHERE id=NEW.interview)='CONFIRMED')
 ) THEN RAISE(ABORT,'interview_transition') END;
 SELECT CASE WHEN NEW.action IN ('CONFIRM','DECLINE','REQUEST_ALTERNATIVE') AND NOT EXISTS(
  SELECT 1 FROM interviews i JOIN applications a ON a.id=i.application JOIN jobs_users u ON u.subject=a.candidate
  WHERE i.id=NEW.interview AND a.candidate=NEW.actor AND u.eligible=1 AND u.closed_at IS NULL AND u.restricted=0 AND a.restricted=0
 ) THEN RAISE(ABORT,'interview_forbidden') END;
 SELECT CASE WHEN NEW.action NOT IN ('CONFIRM','DECLINE','REQUEST_ALTERNATIVE') AND NOT EXISTS(
  SELECT 1 FROM interviews i JOIN assignments x ON x.company=i.company AND x.listing=i.listing AND x.subject=NEW.actor
  JOIN memberships m ON m.company=x.company AND m.subject=x.subject JOIN jobs_users u ON u.subject=x.subject JOIN companies c ON c.id=x.company
  WHERE i.id=NEW.interview AND m.revoked_at IS NULL AND u.eligible=1 AND u.closed_at IS NULL AND u.restricted=0 AND c.restricted=0
 ) THEN RAISE(ABORT,'interview_forbidden') END;
 SELECT CASE WHEN NEW.action='CONFIRM' AND NOT EXISTS(
  SELECT 1 FROM interview_slots s WHERE s.interview=NEW.interview AND s.id=json_extract(NEW.data,'$.slot') AND s.status='PROPOSED' AND s.expires_at>NEW.at
 ) THEN RAISE(ABORT,'interview_slot_invalid') END;
 SELECT CASE WHEN NEW.action='CONFIRM' AND EXISTS(
  SELECT 1 FROM interview_slots chosen JOIN interview_participants mine ON mine.interview=NEW.interview
  JOIN interview_participants otherp ON otherp.subject=mine.subject JOIN interviews other ON other.id=otherp.interview
  JOIN interview_slots occupied ON occupied.id=other.confirmed_slot
  WHERE chosen.interview=NEW.interview AND chosen.id=json_extract(NEW.data,'$.slot') AND other.id<>NEW.interview AND other.state='CONFIRMED'
   AND chosen.starts_at<occupied.ends_at AND occupied.starts_at<chosen.ends_at
 ) THEN RAISE(ABORT,'interview_schedule_conflict') END;
 INSERT INTO interview_events SELECT lower(hex(randomblob(16))),NEW.interview,NEW.actor,state,
  CASE NEW.action WHEN 'CONFIRM' THEN 'CONFIRMED' WHEN 'DECLINE' THEN 'DECLINED' WHEN 'REQUEST_ALTERNATIVE' THEN 'RESCHEDULING'
   WHEN 'RESCHEDULE' THEN 'RESCHEDULING' WHEN 'CANCEL' THEN 'CANCELLED' WHEN 'COMPLETE' THEN 'COMPLETED' ELSE 'NO_SHOW' END,
  NEW.data,NEW.at FROM interviews WHERE id=NEW.interview;
 UPDATE interview_slots SET status=CASE WHEN id=json_extract(NEW.data,'$.slot') THEN 'CONFIRMED' ELSE 'SUPERSEDED' END
  WHERE interview=NEW.interview AND NEW.action='CONFIRM';
 UPDATE interviews SET state=CASE NEW.action WHEN 'CONFIRM' THEN 'CONFIRMED' WHEN 'DECLINE' THEN 'DECLINED'
  WHEN 'REQUEST_ALTERNATIVE' THEN 'RESCHEDULING' WHEN 'RESCHEDULE' THEN 'RESCHEDULING' WHEN 'CANCEL' THEN 'CANCELLED'
  WHEN 'COMPLETE' THEN 'COMPLETED' ELSE 'NO_SHOW' END,
  confirmed_slot=CASE WHEN NEW.action='CONFIRM' THEN json_extract(NEW.data,'$.slot') WHEN NEW.action IN ('RESCHEDULE','CANCEL') THEN NULL ELSE confirmed_slot END,
  meeting_state=CASE WHEN NEW.action='CONFIRM' THEN 'PENDING' WHEN NEW.action IN ('RESCHEDULE','CANCEL') AND meeting_ref IS NOT NULL THEN 'REVOKE_PENDING' ELSE meeting_state END,
  revision=revision+1,updated_at=NEW.at WHERE id=NEW.interview AND revision=NEW.expected_revision;
 INSERT OR IGNORE INTO interview_meeting_outbox(id,interview,interview_revision,operation,payload,status,attempts,next_attempt_at,created_at,updated_at)
  SELECT lower(hex(randomblob(16))),NEW.interview,NEW.expected_revision+1,'ACTIVATE',NEW.data,'PENDING',0,NEW.at,NEW.at,NEW.at WHERE NEW.action='CONFIRM';
 INSERT OR IGNORE INTO interview_meeting_outbox(id,interview,interview_revision,operation,payload,status,attempts,next_attempt_at,created_at,updated_at)
  SELECT lower(hex(randomblob(16))),NEW.interview,NEW.expected_revision+1,'REVOKE',NEW.data,'PENDING',0,NEW.at,NEW.at,NEW.at
  WHERE NEW.action IN ('RESCHEDULE','CANCEL') AND EXISTS(SELECT 1 FROM interviews WHERE id=NEW.interview AND meeting_ref IS NOT NULL);
 INSERT OR IGNORE INTO jobs_notifications(id,candidate,application,event_key,kind,data,at)
  SELECT lower(hex(randomblob(16))),a.candidate,a.id,'interview:'||NEW.interview||':'||(NEW.expected_revision+1),'INTERVIEW_'||NEW.action,
   json_object('interview',NEW.interview,'state',CASE NEW.action WHEN 'CONFIRM' THEN 'CONFIRMED' WHEN 'DECLINE' THEN 'DECLINED' WHEN 'REQUEST_ALTERNATIVE' THEN 'RESCHEDULING' WHEN 'RESCHEDULE' THEN 'RESCHEDULING' WHEN 'CANCEL' THEN 'CANCELLED' WHEN 'COMPLETE' THEN 'COMPLETED' ELSE 'NO_SHOW' END),NEW.at
  FROM interviews i JOIN applications a ON a.id=i.application WHERE i.id=NEW.interview AND NEW.actor<>a.candidate;
 UPDATE interview_commands SET result_revision=NEW.expected_revision+1 WHERE interview=NEW.interview AND actor=NEW.actor AND request_key=NEW.request_key;
END;
-- break
CREATE TRIGGER interview_feedback_apply AFTER INSERT ON interview_feedback_commands BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM interview_participants p JOIN interviews i ON i.id=p.interview JOIN memberships m ON m.company=i.company AND m.subject=p.subject
  JOIN jobs_users u ON u.subject=p.subject WHERE p.interview=NEW.interview AND p.subject=NEW.author AND p.role='INTERVIEWER'
   AND i.state IN ('CONFIRMED','COMPLETED','NO_SHOW') AND m.revoked_at IS NULL AND u.eligible=1 AND u.closed_at IS NULL AND u.restricted=0
 ) THEN RAISE(ABORT,'feedback_forbidden') END;
 INSERT INTO interview_feedback VALUES(NEW.interview,NEW.author,NEW.criteria,NEW.recommendation,NEW.summary,NEW.at)
  ON CONFLICT(interview,author) DO UPDATE SET criteria=excluded.criteria,recommendation=excluded.recommendation,summary=excluded.summary,submitted_at=excluded.submitted_at;
 INSERT INTO interview_events VALUES(lower(hex(randomblob(16))),NEW.interview,NEW.author,NULL,'FEEDBACK_SUBMITTED',json_object('author',NEW.author),NEW.at);
END;
-- break
CREATE TRIGGER interview_recruitment_revoke AFTER UPDATE OF status ON recruitment_cases
WHEN NEW.status IN ('REJECTED','WITHDRAWN','DECLINED','ACCEPTANCE_WITHDRAWN','NON_JOINING') BEGIN
 INSERT INTO interview_events SELECT lower(hex(randomblob(16))),id,NEW.application,state,'CANCELLED',json_object('reason','application_closed'),NEW.updated_at
  FROM interviews WHERE application=NEW.application AND state IN ('REQUESTED','CONFIRMED','RESCHEDULING');
 INSERT OR IGNORE INTO interview_meeting_outbox(id,interview,interview_revision,operation,payload,status,attempts,next_attempt_at,created_at,updated_at)
  SELECT lower(hex(randomblob(16))),id,revision+1,'REVOKE',json_object('reason','application_closed'),'PENDING',0,NEW.updated_at,NEW.updated_at,NEW.updated_at
  FROM interviews WHERE application=NEW.application AND state IN ('REQUESTED','CONFIRMED','RESCHEDULING') AND meeting_ref IS NOT NULL;
 UPDATE interviews SET state='CANCELLED',revision=revision+1,confirmed_slot=NULL,
  meeting_state=CASE WHEN meeting_ref IS NULL THEN meeting_state ELSE 'REVOKE_PENDING' END,updated_at=NEW.updated_at
  WHERE application=NEW.application AND state IN ('REQUESTED','CONFIRMED','RESCHEDULING');
END;
-- break
CREATE TRIGGER interview_jobs_closure_revoke AFTER UPDATE OF closed_at ON jobs_users WHEN NEW.closed_at IS NOT NULL BEGIN
 INSERT INTO interview_meeting_outbox(id,interview,interview_revision,operation,payload,status,attempts,next_attempt_at,created_at,updated_at)
  SELECT lower(hex(randomblob(16))),i.id,i.revision+1,'REVOKE',json_object('reason','jobs_account_closed'),'PENDING',0,NEW.closed_at,NEW.closed_at,NEW.closed_at
  FROM interviews i JOIN applications a ON a.id=i.application WHERE a.candidate=NEW.subject AND i.state IN ('REQUESTED','CONFIRMED','RESCHEDULING') AND i.meeting_ref IS NOT NULL;
 UPDATE interviews SET state='CANCELLED',revision=revision+1,confirmed_slot=NULL,
  meeting_state=CASE WHEN meeting_ref IS NULL THEN meeting_state ELSE 'REVOKE_PENDING' END,updated_at=NEW.closed_at
  WHERE application IN (SELECT id FROM applications WHERE candidate=NEW.subject) AND state IN ('REQUESTED','CONFIRMED','RESCHEDULING');
END;
-- break
CREATE TRIGGER interview_assignment_revoke AFTER DELETE ON assignments BEGIN
 INSERT OR IGNORE INTO interview_meeting_outbox(id,interview,interview_revision,operation,payload,status,attempts,next_attempt_at,created_at,updated_at)
  SELECT lower(hex(randomblob(16))),id,revision+1,'REVOKE',json_object('reason','listing_assignment_revoked'),'PENDING',0,CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000
  FROM interviews WHERE company=OLD.company AND listing=OLD.listing AND created_by=OLD.subject AND state IN ('REQUESTED','CONFIRMED','RESCHEDULING') AND meeting_ref IS NOT NULL;
 UPDATE interviews SET state='CANCELLED',revision=revision+1,confirmed_slot=NULL,
  meeting_state=CASE WHEN meeting_ref IS NULL THEN meeting_state ELSE 'REVOKE_PENDING' END,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
  WHERE company=OLD.company AND listing=OLD.listing AND created_by=OLD.subject AND state IN ('REQUESTED','CONFIRMED','RESCHEDULING');
END;
-- break
CREATE TRIGGER interview_member_revoke AFTER UPDATE OF revoked_at ON memberships WHEN NEW.revoked_at IS NOT NULL BEGIN
 INSERT OR IGNORE INTO interview_meeting_outbox(id,interview,interview_revision,operation,payload,status,attempts,next_attempt_at,created_at,updated_at)
  SELECT lower(hex(randomblob(16))),i.id,i.revision+1,'REVOKE',json_object('reason','interviewer_membership_revoked'),'PENDING',0,NEW.revoked_at,NEW.revoked_at,NEW.revoked_at
  FROM interviews i JOIN interview_participants p ON p.interview=i.id WHERE i.company=NEW.company AND p.subject=NEW.subject AND p.role='INTERVIEWER'
   AND i.state IN ('REQUESTED','CONFIRMED','RESCHEDULING') AND i.meeting_ref IS NOT NULL;
 UPDATE interviews SET state='CANCELLED',revision=revision+1,confirmed_slot=NULL,
  meeting_state=CASE WHEN meeting_ref IS NULL THEN meeting_state ELSE 'REVOKE_PENDING' END,updated_at=NEW.revoked_at
  WHERE company=NEW.company AND state IN ('REQUESTED','CONFIRMED','RESCHEDULING') AND id IN (SELECT interview FROM interview_participants WHERE subject=NEW.subject AND role='INTERVIEWER');
END;
-- break
CREATE TRIGGER interview_company_restrict AFTER UPDATE OF restricted ON companies WHEN NEW.restricted=1 BEGIN
 INSERT OR IGNORE INTO interview_meeting_outbox(id,interview,interview_revision,operation,payload,status,attempts,next_attempt_at,created_at,updated_at)
  SELECT lower(hex(randomblob(16))),id,revision+1,'REVOKE',json_object('reason','company_restricted'),'PENDING',0,CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000
  FROM interviews WHERE company=NEW.id AND state IN ('REQUESTED','CONFIRMED','RESCHEDULING') AND meeting_ref IS NOT NULL;
 UPDATE interviews SET state='CANCELLED',revision=revision+1,confirmed_slot=NULL,
  meeting_state=CASE WHEN meeting_ref IS NULL THEN meeting_state ELSE 'REVOKE_PENDING' END,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
  WHERE company=NEW.id AND state IN ('REQUESTED','CONFIRMED','RESCHEDULING');
END;
-- break
CREATE TRIGGER interview_application_delete AFTER DELETE ON applications BEGIN
 DELETE FROM interview_create_commands WHERE application=OLD.id;
 DELETE FROM interview_commands WHERE interview IN (SELECT interview FROM interview_meeting_outbox WHERE interview NOT IN (SELECT id FROM interviews));
 DELETE FROM interview_feedback_commands WHERE interview NOT IN (SELECT id FROM interviews);
 DELETE FROM interview_meeting_outbox WHERE interview NOT IN (SELECT id FROM interviews);
END;
