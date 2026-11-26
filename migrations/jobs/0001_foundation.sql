-- Jobs-only database. No account credentials or cross-product foreign keys.
CREATE TABLE jobs_users (
 subject TEXT PRIMARY KEY, eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
 attested_at INTEGER NOT NULL, closed_at INTEGER, restricted INTEGER NOT NULL DEFAULT 0 CHECK(restricted IN (0,1)),
 visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK(visibility IN ('PRIVATE','RECRUITERS_ONLY','PUBLIC')),
 indexing INTEGER NOT NULL DEFAULT 0 CHECK(indexing IN (0,1))
);
-- break
CREATE TABLE memberships (company TEXT NOT NULL, subject TEXT NOT NULL REFERENCES jobs_users(subject), role TEXT NOT NULL CHECK(role IN ('RECRUITER','COMPANY_ADMIN')), revoked_at INTEGER, PRIMARY KEY(company,subject));
-- break
CREATE TABLE platform_roles (subject TEXT NOT NULL REFERENCES jobs_users(subject), role TEXT NOT NULL CHECK(role IN ('PRIVACY_OPERATOR','MODERATOR')), revoked_at INTEGER, PRIMARY KEY(subject,role));
-- break
CREATE TABLE listings (company TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('ACTIVE','CLOSED','ARCHIVED')), expires_at INTEGER NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(company,id));
-- break
CREATE INDEX listing_active ON listings(company,state,expires_at);
-- break
CREATE TABLE assignments (company TEXT NOT NULL, listing TEXT NOT NULL, subject TEXT NOT NULL, PRIMARY KEY(company,listing,subject), FOREIGN KEY(company,listing) REFERENCES listings(company,id), FOREIGN KEY(company,subject) REFERENCES memberships(company,subject));
-- break
CREATE TABLE posting_actions (
 company TEXT NOT NULL, actor TEXT NOT NULL, request_key TEXT NOT NULL, payload TEXT NOT NULL,
 listing TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('CREATE','RENEW','REOPEN','CLOSE','ARCHIVE','EDIT')),
 fingerprint TEXT NOT NULL, expected_revision INTEGER NOT NULL, at INTEGER NOT NULL,
 quota_day TEXT GENERATED ALWAYS AS (date(at / 1000, 'unixepoch', '+330 minutes')) STORED,
 result_expiry INTEGER, result_revision INTEGER,
 PRIMARY KEY(company,actor,request_key)
);
-- break
CREATE INDEX action_quota ON posting_actions(company,quota_day,operation);
-- break
CREATE TRIGGER apply_posting AFTER INSERT ON posting_actions BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM memberships m JOIN jobs_users u ON u.subject=m.subject
  WHERE m.company=NEW.company AND m.subject=NEW.actor AND m.revoked_at IS NULL
   AND u.eligible=1 AND u.closed_at IS NULL AND u.restricted=0
 ) THEN RAISE(ABORT,'jobs_forbidden') END;
 SELECT CASE WHEN NEW.operation='CREATE' AND EXISTS (SELECT 1 FROM listings WHERE company=NEW.company AND id=NEW.listing)
  THEN RAISE(ABORT,'jobs_conflict') END;
 SELECT CASE WHEN NEW.operation<>'CREATE' AND NOT EXISTS (
  SELECT 1 FROM listings WHERE company=NEW.company AND id=NEW.listing AND revision=NEW.expected_revision
   AND ((NEW.operation='RENEW' AND state='ACTIVE' AND expires_at <= NEW.at+604800000)
    OR (NEW.operation='REOPEN' AND state='CLOSED')
    OR (NEW.operation='CLOSE' AND state='ACTIVE')
    OR (NEW.operation IN ('EDIT','ARCHIVE') AND state<>'ARCHIVED'))
 ) THEN RAISE(ABORT,'jobs_conflict') END;
 SELECT CASE WHEN NEW.operation IN ('CREATE','RENEW','REOPEN') AND (
  SELECT COUNT(*) FROM posting_actions WHERE company=NEW.company AND quota_day=NEW.quota_day AND operation IN ('CREATE','RENEW','REOPEN')
 ) > 10 THEN RAISE(ABORT,'jobs_daily_limit') END;
 SELECT CASE WHEN NEW.operation IN ('CREATE','RENEW','REOPEN') AND (
  SELECT COUNT(*) FROM listings WHERE company=NEW.company AND state='ACTIVE' AND expires_at>NEW.at AND id<>NEW.listing
 ) >= 30 THEN RAISE(ABORT,'jobs_active_limit') END;
 SELECT CASE WHEN NEW.operation IN ('CREATE','RENEW','REOPEN','EDIT') AND EXISTS (
  SELECT 1 FROM listings WHERE company=NEW.company AND state='ACTIVE' AND expires_at>NEW.at AND id<>NEW.listing
   AND fingerprint=CASE WHEN NEW.operation IN ('CREATE','EDIT') THEN NEW.fingerprint ELSE (SELECT fingerprint FROM listings WHERE company=NEW.company AND id=NEW.listing) END
 ) THEN RAISE(ABORT,'jobs_duplicate') END;
 INSERT INTO listings(company,id,fingerprint,state,expires_at,revision)
  SELECT NEW.company,NEW.listing,NEW.fingerprint,'ACTIVE',NEW.at+2592000000,1 WHERE NEW.operation='CREATE';
 UPDATE listings SET
  fingerprint=CASE WHEN NEW.operation='EDIT' THEN NEW.fingerprint ELSE fingerprint END,
  state=CASE WHEN NEW.operation IN ('RENEW','REOPEN') THEN 'ACTIVE' WHEN NEW.operation='CLOSE' THEN 'CLOSED' WHEN NEW.operation='ARCHIVE' THEN 'ARCHIVED' ELSE state END,
  expires_at=CASE WHEN NEW.operation='RENEW' THEN max(expires_at,NEW.at)+2592000000 WHEN NEW.operation='REOPEN' THEN NEW.at+2592000000 ELSE expires_at END,
  revision=revision+1
  WHERE company=NEW.company AND id=NEW.listing AND NEW.operation<>'CREATE';
 UPDATE posting_actions SET result_expiry=(SELECT expires_at FROM listings WHERE company=NEW.company AND id=NEW.listing),
  result_revision=(SELECT revision FROM listings WHERE company=NEW.company AND id=NEW.listing)
  WHERE company=NEW.company AND actor=NEW.actor AND request_key=NEW.request_key;
END;
-- break
CREATE TABLE retained_records (id TEXT PRIMARY KEY, subject TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('APPLICATION','CLOSURE','MODERATION')), ended_at INTEGER NOT NULL, restricted INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL);
-- break
CREATE TABLE retention_exceptions (record_id TEXT PRIMARY KEY REFERENCES retained_records(id), hold INTEGER NOT NULL CHECK(hold IN (0,1)), retain_until INTEGER, reason_code TEXT NOT NULL, operator TEXT NOT NULL);
-- break
CREATE TABLE deletion_ledger (record_id TEXT PRIMARY KEY, subject TEXT NOT NULL, deleted_at INTEGER NOT NULL);
-- break
CREATE TABLE privacy_audit (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, at INTEGER NOT NULL);
-- break
CREATE TABLE restore_gate (id INTEGER PRIMARY KEY CHECK(id=1), ready INTEGER NOT NULL CHECK(ready IN (0,1)));
-- break
INSERT INTO restore_gate VALUES(1,1);
