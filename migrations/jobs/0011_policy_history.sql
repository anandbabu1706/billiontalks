CREATE TABLE jobs_policy_history (
 key TEXT NOT NULL,value TEXT NOT NULL CHECK(json_valid(value)),revision INTEGER NOT NULL,effective_at INTEGER NOT NULL,
 actor TEXT NOT NULL,PRIMARY KEY(key,revision)
);
-- break
INSERT INTO jobs_policy_history SELECT key,value,revision,effective_at,actor FROM jobs_policy_versions;
-- break
CREATE TRIGGER record_jobs_policy_insert AFTER INSERT ON jobs_policy_versions BEGIN
 INSERT INTO jobs_policy_history VALUES(NEW.key,NEW.value,NEW.revision,NEW.effective_at,NEW.actor);
END;
-- break
CREATE TRIGGER record_jobs_policy_update AFTER UPDATE ON jobs_policy_versions BEGIN
 INSERT INTO jobs_policy_history VALUES(NEW.key,NEW.value,NEW.revision,NEW.effective_at,NEW.actor);
END;
-- break
CREATE VIEW effective_jobs_policies AS SELECT p.* FROM jobs_policy_history p WHERE p.revision=(
 SELECT max(h.revision) FROM jobs_policy_history h WHERE h.key=p.key AND h.effective_at<=unixepoch('subsec')*1000
);
-- break
DROP TRIGGER apply_posting;
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
 ) > COALESCE((SELECT CAST(value AS INTEGER) FROM jobs_policy_history WHERE key='listing_daily_limit' AND effective_at<=NEW.at ORDER BY revision DESC LIMIT 1),10) THEN RAISE(ABORT,'jobs_daily_limit') END;
 SELECT CASE WHEN NEW.operation IN ('CREATE','RENEW','REOPEN') AND (
  SELECT COUNT(*) FROM listings WHERE company=NEW.company AND state='ACTIVE' AND expires_at>NEW.at AND id<>NEW.listing
 ) >= COALESCE((SELECT CAST(value AS INTEGER) FROM jobs_policy_history WHERE key='listing_active_limit' AND effective_at<=NEW.at ORDER BY revision DESC LIMIT 1),30) THEN RAISE(ABORT,'jobs_active_limit') END;
 SELECT CASE WHEN NEW.operation IN ('CREATE','RENEW','REOPEN','EDIT') AND EXISTS (
  SELECT 1 FROM listings WHERE company=NEW.company AND state='ACTIVE' AND expires_at>NEW.at AND id<>NEW.listing
   AND fingerprint=CASE WHEN NEW.operation IN ('CREATE','EDIT') THEN NEW.fingerprint ELSE (SELECT fingerprint FROM listings WHERE company=NEW.company AND id=NEW.listing) END
 ) THEN RAISE(ABORT,'jobs_duplicate') END;
 INSERT INTO listings(company,id,fingerprint,state,expires_at,revision)
  SELECT NEW.company,NEW.listing,NEW.fingerprint,'ACTIVE',NEW.at+COALESCE((SELECT CAST(value AS INTEGER) FROM jobs_policy_history WHERE key='listing_validity_days' AND effective_at<=NEW.at ORDER BY revision DESC LIMIT 1),30)*86400000,1 WHERE NEW.operation='CREATE';
 UPDATE listings SET
  fingerprint=CASE WHEN NEW.operation='EDIT' THEN NEW.fingerprint ELSE fingerprint END,
  state=CASE WHEN NEW.operation IN ('RENEW','REOPEN') THEN 'ACTIVE' WHEN NEW.operation='CLOSE' THEN 'CLOSED' WHEN NEW.operation='ARCHIVE' THEN 'ARCHIVED' ELSE state END,
  expires_at=CASE WHEN NEW.operation='RENEW' THEN max(expires_at,NEW.at)+COALESCE((SELECT CAST(value AS INTEGER) FROM jobs_policy_history WHERE key='listing_validity_days' AND effective_at<=NEW.at ORDER BY revision DESC LIMIT 1),30)*86400000 WHEN NEW.operation='REOPEN' THEN NEW.at+COALESCE((SELECT CAST(value AS INTEGER) FROM jobs_policy_history WHERE key='listing_validity_days' AND effective_at<=NEW.at ORDER BY revision DESC LIMIT 1),30)*86400000 ELSE expires_at END,
  revision=revision+1
  WHERE company=NEW.company AND id=NEW.listing AND NEW.operation<>'CREATE';
 UPDATE posting_actions SET result_expiry=(SELECT expires_at FROM listings WHERE company=NEW.company AND id=NEW.listing),
  result_revision=(SELECT revision FROM listings WHERE company=NEW.company AND id=NEW.listing)
  WHERE company=NEW.company AND actor=NEW.actor AND request_key=NEW.request_key;
END;
