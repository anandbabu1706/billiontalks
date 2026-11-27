-- Local Jobs governance. Product scopes are explicit; no shared account authority is implied.
CREATE TABLE admin_grants (
 subject TEXT NOT NULL REFERENCES jobs_users(subject), product TEXT NOT NULL CHECK(product IN ('BILLIONJOBS','BILLIONTALKS')),
 role TEXT NOT NULL CHECK(role IN ('PLATFORM_OWNER','PRODUCT_ADMIN','SECURITY_ADMIN','MODERATOR','SUPPORT','PRIVACY_ADMIN','AUDITOR')),
 granted_by TEXT NOT NULL, granted_at INTEGER NOT NULL, revoked_at INTEGER,
 PRIMARY KEY(subject,product,role)
);
-- break
CREATE TRIGGER final_jobs_owner_guard BEFORE UPDATE OF revoked_at ON admin_grants
WHEN OLD.product='BILLIONJOBS' AND OLD.role='PLATFORM_OWNER' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
AND (SELECT count(*) FROM admin_grants WHERE product='BILLIONJOBS' AND role='PLATFORM_OWNER' AND revoked_at IS NULL)<=1
BEGIN SELECT RAISE(ABORT,'final_owner_protected'); END;
-- break
CREATE TRIGGER final_jobs_owner_closure BEFORE UPDATE OF closed_at ON jobs_users
WHEN OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL
AND EXISTS(SELECT 1 FROM admin_grants g WHERE g.subject=OLD.subject AND g.product='BILLIONJOBS' AND g.role='PLATFORM_OWNER' AND g.revoked_at IS NULL)
AND NOT EXISTS(SELECT 1 FROM admin_grants g JOIN jobs_users u ON u.subject=g.subject WHERE g.subject<>OLD.subject
 AND g.product='BILLIONJOBS' AND g.role='PLATFORM_OWNER' AND g.revoked_at IS NULL AND u.closed_at IS NULL AND u.eligible=1 AND u.restricted=0)
BEGIN SELECT RAISE(ABORT,'final_owner_protected'); END;
-- break
CREATE TABLE admin_audit (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, product TEXT NOT NULL, purpose TEXT NOT NULL,
 target_type TEXT NOT NULL, target_ref TEXT NOT NULL, action TEXT NOT NULL,
 outcome TEXT NOT NULL, revision INTEGER, at INTEGER NOT NULL
);
-- break
CREATE INDEX admin_audit_time ON admin_audit(product,at DESC,id);
-- break
CREATE TRIGGER admin_audit_no_update BEFORE UPDATE ON admin_audit BEGIN SELECT RAISE(ABORT,'audit_append_only'); END;
-- break
CREATE TRIGGER admin_audit_no_delete BEFORE DELETE ON admin_audit BEGIN SELECT RAISE(ABORT,'audit_append_only'); END;
-- break
CREATE TABLE moderation_cases (
 id TEXT PRIMARY KEY, product TEXT NOT NULL DEFAULT 'BILLIONJOBS' CHECK(product='BILLIONJOBS'),
 kind TEXT NOT NULL CHECK(kind IN ('JOB','COMPANY','RECRUITER','CANDIDATE','INTERVIEW','HARASSMENT','SCAM','PRIVACY')),
 target_ref TEXT NOT NULL, reporter TEXT NOT NULL, category TEXT NOT NULL,
 severity TEXT NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
 status TEXT NOT NULL CHECK(status IN ('OPEN','ASSIGNED','WAITING','RESOLVED','CLOSED')),
 assignee TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1
);
-- break
CREATE INDEX moderation_queue ON moderation_cases(status,severity,created_at,id);
-- break
CREATE TABLE moderation_events (
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES moderation_cases(id), actor TEXT NOT NULL,
 action TEXT NOT NULL, public_status TEXT, internal_note TEXT CHECK(length(internal_note)<=2000),
 evidence_ref TEXT, at INTEGER NOT NULL
);
-- break
CREATE TABLE enforcement_actions (
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES moderation_cases(id), target_kind TEXT NOT NULL CHECK(target_kind IN ('USER','COMPANY','LISTING','RECRUITER')),
 target_ref TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('WARNING','FEATURE','POSTING','RECRUITER','JOBS_TEMP','JOBS_PERMANENT','EMERGENCY','REMOVE_DISCOVERY')),
 reason_code TEXT NOT NULL, actor TEXT NOT NULL, evidence_ref TEXT, starts_at INTEGER NOT NULL,
 expires_at INTEGER, revoked_at INTEGER, revision INTEGER NOT NULL DEFAULT 1
);
-- break
CREATE INDEX enforcement_active ON enforcement_actions(target_kind,target_ref,revoked_at,expires_at);
-- break
CREATE TRIGGER posting_enforcement_guard BEFORE INSERT ON posting_actions
WHEN NEW.operation IN ('CREATE','RENEW','REOPEN','EDIT') AND EXISTS(
 SELECT 1 FROM enforcement_actions e WHERE e.revoked_at IS NULL AND e.starts_at<=NEW.at
 AND (e.expires_at IS NULL OR e.expires_at>NEW.at)
 AND e.kind IN ('POSTING','FEATURE','JOBS_TEMP','JOBS_PERMANENT','EMERGENCY')
 AND ((e.target_kind='USER' AND e.target_ref=NEW.actor) OR (e.target_kind='COMPANY' AND e.target_ref=NEW.company)))
BEGIN SELECT RAISE(ABORT,'jobs_forbidden'); END;
-- break
CREATE TABLE enforcement_appeals (
 id TEXT PRIMARY KEY, action_id TEXT NOT NULL REFERENCES enforcement_actions(id), appellant TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('SUBMITTED','ACKNOWLEDGED','REVIEWING','MORE_INFO','UPHELD','OVERTURNED')),
 reviewer TEXT, reason TEXT NOT NULL CHECK(length(reason)<=2000), decision_note TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1
);
-- break
CREATE UNIQUE INDEX one_open_appeal ON enforcement_appeals(action_id,appellant) WHERE status IN ('SUBMITTED','ACKNOWLEDGED','REVIEWING','MORE_INFO');
-- break
CREATE TABLE ownership_transfers (
 id TEXT PRIMARY KEY, company TEXT NOT NULL REFERENCES companies(id), from_subject TEXT NOT NULL,
 to_subject TEXT NOT NULL REFERENCES jobs_users(subject), recipient_hash TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
 expected_revision INTEGER NOT NULL, expires_at INTEGER NOT NULL, accepted_at INTEGER, cancelled_at INTEGER,
 requested_at INTEGER NOT NULL
);
-- break
CREATE UNIQUE INDEX one_open_transfer ON ownership_transfers(company) WHERE accepted_at IS NULL AND cancelled_at IS NULL;
-- break
CREATE TABLE company_ownership_history (
 id TEXT PRIMARY KEY, company TEXT NOT NULL REFERENCES companies(id), from_subject TEXT NOT NULL,
 to_subject TEXT NOT NULL, transfer_id TEXT NOT NULL UNIQUE, at INTEGER NOT NULL
);
-- break
CREATE TABLE ownership_acceptances (
 transfer_id TEXT PRIMARY KEY REFERENCES ownership_transfers(id), actor TEXT NOT NULL, token_hash TEXT NOT NULL, at INTEGER NOT NULL
);
-- break
DROP TRIGGER company_immutable_owner;
-- break
CREATE TRIGGER company_immutable_owner BEFORE UPDATE OF owner ON companies
WHEN NEW.owner<>OLD.owner AND NOT EXISTS(
 SELECT 1 FROM ownership_acceptances a JOIN ownership_transfers t ON t.id=a.transfer_id
 WHERE t.company=OLD.id AND t.from_subject=OLD.owner AND t.to_subject=NEW.owner
 AND t.expected_revision=OLD.revision AND t.token_hash=a.token_hash AND a.actor=NEW.owner
 AND t.accepted_at IS NULL AND t.cancelled_at IS NULL AND t.expires_at>a.at)
BEGIN SELECT RAISE(ABORT,'company_owner_protected'); END;
-- break
CREATE TRIGGER ownership_accept_guard BEFORE INSERT ON ownership_acceptances BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM ownership_transfers t JOIN companies c ON c.id=t.company
  JOIN jobs_users u ON u.subject=t.to_subject
  WHERE t.id=NEW.transfer_id AND t.to_subject=NEW.actor AND t.token_hash=NEW.token_hash
  AND t.accepted_at IS NULL AND t.cancelled_at IS NULL AND t.expires_at>NEW.at
  AND c.owner=t.from_subject AND c.revision=t.expected_revision
  AND u.eligible=1 AND u.closed_at IS NULL AND u.restricted=0)
 THEN RAISE(ABORT,'transfer_invalid') END;
END;
-- break
CREATE TRIGGER ownership_accept_apply AFTER INSERT ON ownership_acceptances BEGIN
 UPDATE companies SET owner=(SELECT to_subject FROM ownership_transfers WHERE id=NEW.transfer_id),revision=revision+1
 WHERE id=(SELECT company FROM ownership_transfers WHERE id=NEW.transfer_id);
 INSERT INTO memberships(company,subject,role,revoked_at)
 SELECT company,to_subject,'COMPANY_ADMIN',NULL FROM ownership_transfers WHERE id=NEW.transfer_id
 ON CONFLICT(company,subject) DO UPDATE SET role='COMPANY_ADMIN',revoked_at=NULL;
 UPDATE memberships SET revoked_at=NEW.at WHERE company=(SELECT company FROM ownership_transfers WHERE id=NEW.transfer_id)
 AND subject=(SELECT from_subject FROM ownership_transfers WHERE id=NEW.transfer_id);
 DELETE FROM assignments WHERE company=(SELECT company FROM ownership_transfers WHERE id=NEW.transfer_id)
 AND subject=(SELECT from_subject FROM ownership_transfers WHERE id=NEW.transfer_id);
 UPDATE company_invitations SET revoked_at=NEW.at WHERE company=(SELECT company FROM ownership_transfers WHERE id=NEW.transfer_id)
 AND issuer=(SELECT from_subject FROM ownership_transfers WHERE id=NEW.transfer_id) AND used_at IS NULL AND revoked_at IS NULL;
 INSERT INTO company_ownership_history SELECT lower(hex(randomblob(16))),company,from_subject,to_subject,id,NEW.at
 FROM ownership_transfers WHERE id=NEW.transfer_id;
 UPDATE ownership_transfers SET accepted_at=NEW.at WHERE id=NEW.transfer_id;
 UPDATE ownership_transfers SET cancelled_at=NEW.at WHERE company=(SELECT company FROM ownership_transfers WHERE id=NEW.transfer_id)
 AND id<>NEW.transfer_id AND accepted_at IS NULL AND cancelled_at IS NULL;
END;
-- break
CREATE TABLE company_retirements (
 company TEXT PRIMARY KEY REFERENCES companies(id), actor TEXT NOT NULL, reason_code TEXT NOT NULL,
 retired_at INTEGER NOT NULL, expected_revision INTEGER NOT NULL
);
-- break
CREATE TRIGGER retirement_revision_guard BEFORE INSERT ON company_retirements
WHEN NOT EXISTS(SELECT 1 FROM companies WHERE id=NEW.company AND owner=NEW.actor AND revision=NEW.expected_revision)
BEGIN SELECT RAISE(ABORT,'company_conflict'); END;
-- break
DROP TRIGGER company_owner_closure;
-- break
CREATE TRIGGER company_owner_closure BEFORE UPDATE OF closed_at ON jobs_users
WHEN NEW.closed_at IS NOT NULL AND EXISTS(
 SELECT 1 FROM companies c WHERE c.owner=NEW.subject AND NOT EXISTS(SELECT 1 FROM company_retirements r WHERE r.company=c.id))
BEGIN SELECT RAISE(ABORT,'company_owner_protected'); END;
-- break
DROP TRIGGER company_owner_membership_update;
-- break
CREATE TRIGGER company_owner_membership_update BEFORE UPDATE ON memberships
WHEN EXISTS(SELECT 1 FROM companies c WHERE c.id=OLD.company AND c.owner=OLD.subject
 AND NOT EXISTS(SELECT 1 FROM company_retirements r WHERE r.company=c.id))
AND (NEW.role<>'COMPANY_ADMIN' OR NEW.revoked_at IS NOT NULL OR NEW.subject<>OLD.subject OR NEW.company<>OLD.company)
BEGIN SELECT RAISE(ABORT,'company_owner_protected'); END;
-- break
CREATE TABLE privacy_requests (
 id TEXT PRIMARY KEY, subject TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('EXPORT','DELETE')),
 status TEXT NOT NULL CHECK(status IN ('SUBMITTED','REVIEWING','COMPLETED','DENIED')),
 reason_code TEXT, requested_at INTEGER NOT NULL, completed_at INTEGER
);
-- break
CREATE TABLE jobs_privacy_notices (
 version TEXT PRIMARY KEY, published_at INTEGER NOT NULL, summary TEXT NOT NULL CHECK(length(summary)<=1000),
 active INTEGER NOT NULL CHECK(active IN (0,1))
);
-- break
CREATE TABLE jobs_consent_events (
 id TEXT PRIMARY KEY, subject TEXT NOT NULL REFERENCES jobs_users(subject), product TEXT NOT NULL DEFAULT 'BILLIONJOBS' CHECK(product='BILLIONJOBS'),
 purpose TEXT NOT NULL CHECK(purpose IN ('OPTIONAL_ANALYTICS','PUBLIC_INDEXING')),
 notice_version TEXT NOT NULL REFERENCES jobs_privacy_notices(version), granted INTEGER NOT NULL CHECK(granted IN (0,1)), at INTEGER NOT NULL
);
-- break
CREATE INDEX jobs_consent_history ON jobs_consent_events(subject,purpose,at DESC,id);
-- break
CREATE TABLE legal_holds (
 id TEXT PRIMARY KEY, subject TEXT NOT NULL, reason_code TEXT NOT NULL, scope TEXT NOT NULL,
 owner TEXT NOT NULL, created_at INTEGER NOT NULL, review_at INTEGER NOT NULL,
 released_at INTEGER, release_actor TEXT
);
-- break
CREATE TRIGGER privacy_delete_hold_guard BEFORE UPDATE OF status ON privacy_requests
WHEN OLD.kind='DELETE' AND NEW.status='COMPLETED' AND EXISTS(
 SELECT 1 FROM legal_holds WHERE subject=OLD.subject AND released_at IS NULL)
BEGIN SELECT RAISE(ABORT,'legal_hold_active'); END;
-- break
CREATE TABLE security_incidents (
 id TEXT PRIMARY KEY, severity TEXT NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
 status TEXT NOT NULL CHECK(status IN ('OPEN','CONTAINED','RECOVERING','RESOLVED')),
 owner TEXT NOT NULL, summary TEXT NOT NULL CHECK(length(summary)<=500),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, review_due_at INTEGER, revision INTEGER NOT NULL DEFAULT 1
);
-- break
CREATE TABLE incident_events (
 id TEXT PRIMARY KEY, incident TEXT NOT NULL REFERENCES security_incidents(id), actor TEXT NOT NULL,
 action TEXT NOT NULL, evidence_ref TEXT, note TEXT CHECK(length(note)<=1000), at INTEGER NOT NULL
);
-- break
CREATE TABLE incident_corrective_actions (
 id TEXT PRIMARY KEY, incident TEXT NOT NULL REFERENCES security_incidents(id), owner TEXT NOT NULL,
 description TEXT NOT NULL CHECK(length(description)<=500), due_at INTEGER NOT NULL,
 completed_at INTEGER, created_at INTEGER NOT NULL
);
-- break
CREATE TABLE jobs_policy_versions (
 key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value)), revision INTEGER NOT NULL,
 effective_at INTEGER NOT NULL, actor TEXT NOT NULL
);
-- break
CREATE TABLE fraud_signals (
 id TEXT PRIMARY KEY, rule TEXT NOT NULL, target_kind TEXT NOT NULL, target_ref TEXT NOT NULL,
 severity TEXT NOT NULL, evidence_ref TEXT, status TEXT NOT NULL CHECK(status IN ('OPEN','DISMISSED','REFERRED')),
 created_at INTEGER NOT NULL, reviewed_by TEXT, reviewed_at INTEGER,
 UNIQUE(rule,target_kind,target_ref,status)
);
-- break
CREATE TABLE employer_verifications (
 company TEXT PRIMARY KEY REFERENCES companies(id), state TEXT NOT NULL CHECK(state IN ('UNVERIFIED','EVIDENCE_PENDING','IN_REVIEW','VERIFIED','REJECTED','EXPIRED')),
 evidence_ref TEXT, reviewer TEXT, reviewed_at INTEGER, expires_at INTEGER, revision INTEGER NOT NULL DEFAULT 1
);
-- break
CREATE TABLE interview_reminder_outbox (
 id TEXT PRIMARY KEY, interview TEXT NOT NULL, interview_revision INTEGER NOT NULL,
 window TEXT NOT NULL CHECK(window IN ('24H','1H')), candidate TEXT NOT NULL,
 starts_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PENDING','COMPLETED','FAILED')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(interview,interview_revision,window)
);
-- break
CREATE INDEX reminder_outbox_due ON interview_reminder_outbox(status,next_attempt_at,id);
-- break
-- Retirement stops new recruitment through existing company restriction checks.
CREATE TRIGGER retired_company_guard BEFORE UPDATE OF restricted ON companies
WHEN EXISTS(SELECT 1 FROM company_retirements WHERE company=OLD.id) AND NEW.restricted=0
BEGIN SELECT RAISE(ABORT,'company_retired'); END;
