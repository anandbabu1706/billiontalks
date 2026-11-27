CREATE TABLE appeal_history (
 id TEXT PRIMARY KEY,
 appeal TEXT NOT NULL REFERENCES enforcement_appeals(id),
 revision INTEGER NOT NULL,
 actor TEXT NOT NULL,
 status TEXT NOT NULL,
 message TEXT,
 recorded_at INTEGER NOT NULL,
 UNIQUE(appeal,revision)
);
-- break
INSERT INTO appeal_history
 SELECT lower(hex(randomblob(16))),id,revision,COALESCE(reviewer,appellant),status,
 CASE WHEN status='SUBMITTED' THEN reason ELSE decision_note END,updated_at FROM enforcement_appeals;
-- break
CREATE TRIGGER record_appeal_submission AFTER INSERT ON enforcement_appeals BEGIN
 INSERT INTO appeal_history VALUES(lower(hex(randomblob(16))),NEW.id,NEW.revision,NEW.appellant,NEW.status,NEW.reason,NEW.created_at);
END;
-- break
CREATE TRIGGER record_appeal_review AFTER UPDATE OF revision ON enforcement_appeals BEGIN
 INSERT INTO appeal_history VALUES(lower(hex(randomblob(16))),NEW.id,NEW.revision,
 CASE WHEN OLD.status='MORE_INFO' AND NEW.status='ACKNOWLEDGED' THEN NEW.appellant ELSE NEW.reviewer END,
 NEW.status,NEW.decision_note,NEW.updated_at);
END;
-- break
CREATE TRIGGER enforce_application_access BEFORE INSERT ON application_requests
WHEN EXISTS(SELECT 1 FROM enforcement_actions e WHERE e.revoked_at IS NULL AND e.starts_at<=NEW.at
 AND (e.expires_at IS NULL OR e.expires_at>NEW.at) AND
 ((e.target_kind='LISTING' AND e.target_ref=NEW.company||'/'||NEW.listing AND e.kind IN ('REMOVE_DISCOVERY','FEATURE'))
 OR (e.target_kind='USER' AND e.target_ref=NEW.candidate AND e.kind IN ('JOBS_TEMP','JOBS_PERMANENT','EMERGENCY'))))
BEGIN SELECT RAISE(ABORT,'application_forbidden'); END;
-- break
ALTER TABLE fraud_signals RENAME TO fraud_signals_legacy;
-- break
CREATE TABLE fraud_signals (
 id TEXT PRIMARY KEY,rule TEXT NOT NULL,target_kind TEXT NOT NULL,target_ref TEXT NOT NULL,severity TEXT NOT NULL,
 evidence_ref TEXT,status TEXT NOT NULL CHECK(status IN ('OPEN','DISMISSED','REFERRED')),
 created_at INTEGER NOT NULL,reviewed_by TEXT,reviewed_at INTEGER
);
-- break
INSERT INTO fraud_signals SELECT * FROM fraud_signals_legacy;
-- break
DROP TABLE fraud_signals_legacy;
-- break
CREATE UNIQUE INDEX open_fraud_signal ON fraud_signals(rule,target_kind,target_ref) WHERE status='OPEN';
-- break
CREATE INDEX fraud_signal_evidence ON fraud_signals(rule,target_ref,evidence_ref);
