-- Count only owners who can currently enter Jobs. This view also covers owners
-- suspended through enforcement without changing their jobs_users row.
CREATE VIEW available_jobs_owners AS
SELECT g.subject FROM admin_grants g JOIN jobs_users u ON u.subject=g.subject
WHERE g.product='BILLIONJOBS' AND g.role='PLATFORM_OWNER' AND g.revoked_at IS NULL
AND u.eligible=1 AND u.restricted=0 AND u.closed_at IS NULL
AND NOT EXISTS (
 SELECT 1 FROM enforcement_actions e WHERE e.target_kind='USER' AND e.target_ref=g.subject
 AND e.kind IN ('JOBS_TEMP','JOBS_PERMANENT','EMERGENCY') AND e.revoked_at IS NULL
 AND e.starts_at<=unixepoch('subsec')*1000 AND (e.expires_at IS NULL OR e.expires_at>unixepoch('subsec')*1000)
);
-- break
CREATE TRIGGER protect_available_owner_enforcement BEFORE INSERT ON enforcement_actions
WHEN NEW.target_kind='USER' AND NEW.kind IN ('JOBS_TEMP','JOBS_PERMANENT','EMERGENCY')
AND EXISTS(SELECT 1 FROM available_jobs_owners WHERE subject=NEW.target_ref)
AND NOT EXISTS(SELECT 1 FROM available_jobs_owners WHERE subject<>NEW.target_ref)
BEGIN SELECT RAISE(ABORT,'final_owner_protected'); END;
-- break
CREATE TRIGGER protect_available_owner_account BEFORE UPDATE OF closed_at,eligible,restricted ON jobs_users
WHEN (NEW.closed_at IS NOT NULL OR NEW.eligible=0 OR NEW.restricted=1)
AND EXISTS(SELECT 1 FROM available_jobs_owners WHERE subject=OLD.subject)
AND NOT EXISTS(SELECT 1 FROM available_jobs_owners WHERE subject<>OLD.subject)
BEGIN SELECT RAISE(ABORT,'final_owner_protected'); END;
-- break
CREATE TRIGGER protect_available_owner_grant BEFORE UPDATE OF revoked_at ON admin_grants
WHEN OLD.product='BILLIONJOBS' AND OLD.role='PLATFORM_OWNER' AND NEW.revoked_at IS NOT NULL
AND EXISTS(SELECT 1 FROM available_jobs_owners WHERE subject=OLD.subject)
AND NOT EXISTS(SELECT 1 FROM available_jobs_owners WHERE subject<>OLD.subject)
BEGIN SELECT RAISE(ABORT,'final_owner_protected'); END;
