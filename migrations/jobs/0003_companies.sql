CREATE TABLE companies (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES jobs_users(subject),
 data TEXT NOT NULL CHECK(json_valid(data)), revision INTEGER NOT NULL DEFAULT 1,
 restricted INTEGER NOT NULL DEFAULT 0 CHECK(restricted IN (0,1)), created_at INTEGER NOT NULL
);
-- break
CREATE TABLE company_invitations (
 id TEXT PRIMARY KEY, company TEXT NOT NULL REFERENCES companies(id), recipient_hash TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('COMPANY_ADMIN','RECRUITER')),
 issuer TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, revoked_at INTEGER, accepted_by TEXT
);
-- break
CREATE INDEX company_invite_recipient ON company_invitations(recipient_hash,expires_at);
-- break
CREATE TABLE company_events (
 id TEXT PRIMARY KEY, company TEXT NOT NULL REFERENCES companies(id), actor TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('CREATE','PROFILE','INVITE','ACCEPT','ROLE','REVOKE','CANCEL','RESTRICT')),
 expected_revision INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), at INTEGER NOT NULL
);
-- break
CREATE INDEX company_events_actor ON company_events(actor,at);
-- break
CREATE TABLE company_reports (
 id TEXT PRIMARY KEY, company TEXT NOT NULL REFERENCES companies(id), reporter TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(reason IN ('IMPERSONATION','FRAUD','ABUSE','OTHER')),
 detail TEXT NOT NULL, at INTEGER NOT NULL,
 report_day TEXT GENERATED ALWAYS AS(date(at/1000,'unixepoch')) STORED,
 UNIQUE(company,reporter,report_day)
);
-- break
CREATE TRIGGER company_create_guard BEFORE INSERT ON companies BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM jobs_users WHERE subject=NEW.owner AND eligible=1 AND restricted=0 AND closed_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM restore_gate WHERE ready=1) THEN RAISE(ABORT,'company_forbidden') END;
 SELECT CASE WHEN (SELECT count(*) FROM companies WHERE owner=NEW.owner AND created_at>NEW.created_at-3600000)>=5 THEN RAISE(ABORT,'company_rate_limit') END;
END;
-- break
CREATE TRIGGER company_create_owner AFTER INSERT ON companies BEGIN
 INSERT INTO memberships(company,subject,role,revoked_at) VALUES(NEW.id,NEW.owner,'COMPANY_ADMIN',NULL);
 INSERT INTO company_events VALUES(NEW.id,NEW.id,NEW.owner,'CREATE',0,'{}',NEW.created_at);
END;
-- break
CREATE TRIGGER company_immutable_owner BEFORE UPDATE OF owner ON companies
WHEN NEW.owner<>OLD.owner BEGIN SELECT RAISE(ABORT,'company_owner_protected'); END;
-- break
CREATE TRIGGER company_owner_membership_update BEFORE UPDATE ON memberships
WHEN EXISTS(SELECT 1 FROM companies WHERE id=OLD.company AND owner=OLD.subject)
AND (NEW.role<>'COMPANY_ADMIN' OR NEW.revoked_at IS NOT NULL OR NEW.subject<>OLD.subject OR NEW.company<>OLD.company)
BEGIN SELECT RAISE(ABORT,'company_owner_protected'); END;
-- break
CREATE TRIGGER company_owner_membership_delete BEFORE DELETE ON memberships
WHEN EXISTS(SELECT 1 FROM companies WHERE id=OLD.company AND owner=OLD.subject)
BEGIN SELECT RAISE(ABORT,'company_owner_protected'); END;
-- break
CREATE TRIGGER company_owner_closure BEFORE UPDATE OF closed_at ON jobs_users
WHEN NEW.closed_at IS NOT NULL AND EXISTS(SELECT 1 FROM companies WHERE owner=NEW.subject)
BEGIN SELECT RAISE(ABORT,'company_owner_protected'); END;
-- break
CREATE TRIGGER company_command AFTER INSERT ON company_events WHEN NEW.action<>'CREATE' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM jobs_users WHERE subject=NEW.actor AND eligible=1 AND restricted=0 AND closed_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM restore_gate WHERE ready=1) THEN RAISE(ABORT,'company_forbidden') END;
 SELECT CASE WHEN (SELECT count(*) FROM company_events WHERE actor=NEW.actor AND at>NEW.at-3600000)>100 THEN RAISE(ABORT,'company_rate_limit') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM companies WHERE id=NEW.company AND revision=NEW.expected_revision)
 THEN RAISE(ABORT,'company_conflict') END;
 SELECT CASE WHEN NEW.action<>'RESTRICT' AND EXISTS(SELECT 1 FROM companies WHERE id=NEW.company AND restricted=1)
 THEN RAISE(ABORT,'company_restricted') END;
 SELECT CASE WHEN NEW.action='RESTRICT' AND NOT EXISTS(SELECT 1 FROM platform_roles WHERE subject=NEW.actor AND role='MODERATOR' AND revoked_at IS NULL)
 THEN RAISE(ABORT,'company_forbidden') END;
 SELECT CASE WHEN NEW.action NOT IN ('ACCEPT','RESTRICT') AND NOT EXISTS(
 SELECT 1 FROM memberships WHERE company=NEW.company AND subject=NEW.actor AND revoked_at IS NULL AND role='COMPANY_ADMIN')
 THEN RAISE(ABORT,'company_forbidden') END;

 SELECT CASE WHEN NEW.action IN ('ROLE','REVOKE') AND json_extract(NEW.payload,'$.subject')=(SELECT owner FROM companies WHERE id=NEW.company)
 THEN RAISE(ABORT,'company_owner_protected') END;
 SELECT CASE WHEN NEW.action IN ('ROLE','REVOKE') AND NOT EXISTS(SELECT 1 FROM memberships WHERE company=NEW.company AND subject=json_extract(NEW.payload,'$.subject') AND revoked_at IS NULL)
 THEN RAISE(ABORT,'company_conflict') END;
 -- Only owners can manage administrator grants or administrator targets.
 SELECT CASE WHEN NEW.action IN ('INVITE','ROLE','REVOKE') AND NEW.actor<>(SELECT owner FROM companies WHERE id=NEW.company)
 AND (json_extract(NEW.payload,'$.role')='COMPANY_ADMIN' OR EXISTS(SELECT 1 FROM memberships WHERE company=NEW.company AND subject=json_extract(NEW.payload,'$.subject') AND role='COMPANY_ADMIN'))
 THEN RAISE(ABORT,'company_forbidden') END;
 SELECT CASE WHEN NEW.action='INVITE' AND EXISTS(SELECT 1 FROM company_invitations WHERE company=NEW.company AND recipient_hash=json_extract(NEW.payload,'$.recipientHash') AND used_at IS NULL AND revoked_at IS NULL AND expires_at>NEW.at)
 THEN RAISE(ABORT,'company_duplicate_invitation') END;
 SELECT CASE WHEN NEW.action='CANCEL' AND NOT EXISTS(SELECT 1 FROM company_invitations WHERE id=json_extract(NEW.payload,'$.id') AND company=NEW.company AND used_at IS NULL AND revoked_at IS NULL
 AND (role='RECRUITER' OR NEW.actor=(SELECT owner FROM companies WHERE id=NEW.company)))
 THEN RAISE(ABORT,'company_forbidden') END;

 SELECT CASE WHEN NEW.action='ACCEPT' AND NOT EXISTS(
 SELECT 1 FROM company_invitations i JOIN memberships issuer ON issuer.company=i.company AND issuer.subject=i.issuer
 JOIN jobs_users u ON u.subject=i.issuer JOIN companies c ON c.id=i.company
 WHERE i.id=json_extract(NEW.payload,'$.id') AND i.company=NEW.company AND i.recipient_hash=json_extract(NEW.payload,'$.recipientHash')
 AND i.token_hash=json_extract(NEW.payload,'$.tokenHash') AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>NEW.at
 AND issuer.revoked_at IS NULL AND issuer.role='COMPANY_ADMIN' AND u.eligible=1 AND u.restricted=0 AND u.closed_at IS NULL
 AND (i.role='RECRUITER' OR i.issuer=c.owner)) THEN RAISE(ABORT,'company_invalid_invitation') END;
 SELECT CASE WHEN NEW.action='ACCEPT' AND EXISTS(SELECT 1 FROM memberships WHERE company=NEW.company AND subject=NEW.actor AND revoked_at IS NULL)
 THEN RAISE(ABORT,'company_already_member') END;

 UPDATE companies SET data=json_extract(NEW.payload,'$.data') WHERE id=NEW.company AND NEW.action='PROFILE';
 INSERT INTO company_invitations(id,company,recipient_hash,token_hash,role,issuer,expires_at)
 SELECT json_extract(NEW.payload,'$.id'),NEW.company,json_extract(NEW.payload,'$.recipientHash'),json_extract(NEW.payload,'$.tokenHash'),json_extract(NEW.payload,'$.role'),NEW.actor,NEW.at+604800000 WHERE NEW.action='INVITE';
 INSERT INTO memberships(company,subject,role,revoked_at)
 SELECT NEW.company,NEW.actor,i.role,NULL FROM company_invitations i WHERE i.id=json_extract(NEW.payload,'$.id') AND NEW.action='ACCEPT'
 ON CONFLICT(company,subject) DO UPDATE SET role=excluded.role,revoked_at=NULL;
 UPDATE company_invitations SET used_at=NEW.at,accepted_by=NEW.actor WHERE id=json_extract(NEW.payload,'$.id') AND NEW.action='ACCEPT';
 UPDATE memberships SET role=json_extract(NEW.payload,'$.role') WHERE company=NEW.company AND subject=json_extract(NEW.payload,'$.subject') AND NEW.action='ROLE';
 UPDATE memberships SET revoked_at=NEW.at WHERE company=NEW.company AND subject=json_extract(NEW.payload,'$.subject') AND NEW.action='REVOKE';
 UPDATE company_invitations SET revoked_at=NEW.at WHERE company=NEW.company AND used_at IS NULL AND revoked_at IS NULL AND recipient_hash IN (SELECT recipient_hash FROM company_invitations WHERE company=NEW.company AND accepted_by=json_extract(NEW.payload,'$.subject')) AND NEW.action='REVOKE';
 DELETE FROM assignments WHERE company=NEW.company AND subject=json_extract(NEW.payload,'$.subject') AND NEW.action='REVOKE';
 -- Outstanding invitations cannot outlive delegated issuer authority or removal.
 UPDATE company_invitations SET revoked_at=NEW.at WHERE company=NEW.company AND issuer=json_extract(NEW.payload,'$.subject') AND used_at IS NULL AND revoked_at IS NULL AND NEW.action IN ('ROLE','REVOKE');
 UPDATE company_invitations SET revoked_at=NEW.at WHERE id=json_extract(NEW.payload,'$.id') AND company=NEW.company AND NEW.action='CANCEL';
 UPDATE companies SET restricted=json_extract(NEW.payload,'$.restricted') WHERE id=NEW.company AND NEW.action='RESTRICT';
 UPDATE companies SET revision=revision+1 WHERE id=NEW.company;
 -- Audit only identifiers/decision metadata; no token hashes, email hashes or profile bodies retained in events.
 UPDATE company_events SET payload=json_object('subject',json_extract(NEW.payload,'$.subject'),'role',json_extract(NEW.payload,'$.role'),'invitation',json_extract(NEW.payload,'$.id'),'restricted',json_extract(NEW.payload,'$.restricted'),'reason',json_extract(NEW.payload,'$.reason')) WHERE id=NEW.id;
END;
-- break
CREATE TRIGGER company_member_closed AFTER UPDATE OF closed_at ON jobs_users WHEN NEW.closed_at IS NOT NULL BEGIN
 UPDATE company_invitations SET revoked_at=NEW.closed_at WHERE issuer=NEW.subject AND used_at IS NULL AND revoked_at IS NULL;
 DELETE FROM assignments WHERE subject=NEW.subject;
END;
-- break
CREATE TRIGGER company_quota_restriction BEFORE INSERT ON posting_actions
WHEN EXISTS(SELECT 1 FROM companies WHERE id=NEW.company AND restricted=1)
BEGIN SELECT RAISE(ABORT,'jobs_forbidden'); END;
