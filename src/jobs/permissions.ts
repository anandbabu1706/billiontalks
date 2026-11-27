import { JobsError, type Identity, type JobsDatabase } from "./contracts";

export async function requireEligible(db: JobsDatabase, actor: Identity): Promise<void> {
  const row = await db.prepare(`SELECT subject FROM jobs_users WHERE subject = ? AND eligible = 1 AND closed_at IS NULL AND restricted = 0
    AND NOT EXISTS(SELECT 1 FROM enforcement_actions e WHERE e.target_kind='USER' AND e.target_ref=jobs_users.subject
      AND e.kind IN ('JOBS_TEMP','JOBS_PERMANENT','EMERGENCY') AND e.revoked_at IS NULL
      AND e.starts_at<=? AND (e.expires_at IS NULL OR e.expires_at>?))`).bind(actor.subject,Date.now(),Date.now()).first();
  if (!row) throw new JobsError(403, "jobs_ineligible");
}
export async function requireCompany(db: JobsDatabase, actor: Identity, company: string, admin = false): Promise<void> {
  await requireEligible(db, actor);
  const member = await db.prepare(`SELECT role FROM memberships WHERE subject = ? AND company = ? AND revoked_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM companies c WHERE c.id=memberships.company AND c.restricted=1)
    AND NOT EXISTS(SELECT 1 FROM enforcement_actions e WHERE e.target_ref=memberships.subject AND e.target_kind IN ('USER','RECRUITER')
      AND e.kind IN ('RECRUITER','FEATURE') AND e.revoked_at IS NULL AND e.starts_at<=? AND (e.expires_at IS NULL OR e.expires_at>?))`).bind(actor.subject, company,Date.now(),Date.now()).first<{ role: string }>();
  if (!member || (admin && member.role !== "COMPANY_ADMIN")) throw new JobsError(403, "forbidden");
}
export async function requireAssigned(db: JobsDatabase, actor: Identity, company: string, listing: string): Promise<void> {
  await requireCompany(db, actor, company);
  const row = await db.prepare("SELECT subject FROM assignments WHERE subject = ? AND company = ? AND listing = ?").bind(actor.subject, company, listing).first();
  if (!row) throw new JobsError(403, "forbidden");
}
/** Platform administration is scoped; it does not grant candidate browsing. */
export async function requirePrivacyOperator(db: JobsDatabase, actor: Identity): Promise<void> {
  await requireEligible(db, actor);
  const row = await db.prepare("SELECT subject FROM platform_roles WHERE subject = ? AND role = 'PRIVACY_OPERATOR' AND revoked_at IS NULL").bind(actor.subject).first();
  if (!row) throw new JobsError(403, "forbidden");
}
