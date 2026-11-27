CREATE TABLE ownership_recovery_cases (
 id TEXT PRIMARY KEY,company TEXT NOT NULL REFERENCES companies(id),requester TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('DISPUTED','UNAVAILABLE_OWNER')),
 evidence_ref TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('OPEN','REVIEWING','MORE_INFO','CLOSED')),
 reviewer TEXT,decision TEXT,revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
);
-- break
CREATE UNIQUE INDEX one_owner_recovery_case ON ownership_recovery_cases(company,requester) WHERE status<>'CLOSED';
