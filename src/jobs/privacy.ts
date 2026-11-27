import { DAY, JobsError, type Identity, type JobsDatabase } from "./contracts";
import { requireAssigned, requireEligible, requirePrivacyOperator } from "./permissions";

const PUBLIC_FIELDS = ["name", "headline", "summary", "location", "experience", "education", "skills", "certifications", "photo", "currentEmployer", "openToWork", "preferences"] as const;
export type ProfileFields = Partial<Record<typeof PUBLIC_FIELDS[number] | "email" | "phone" | "salary" | "savedJobs" | "applications" | "interviews", unknown>>;

/** Allowlist projection. Application snapshots need their own assigned-listing authorization;
 * this general profile projection never exposes contact or recruitment history. */
export async function projectProfile(db: JobsDatabase, owner: string, viewer: Identity | null, fields: ProfileFields, visibleFields: string[], forIndex = false): Promise<ProfileFields> {
  const gate = await db.prepare("SELECT ready FROM restore_gate WHERE id=1").first<{ ready: number }>();
  if (gate?.ready !== 1) return {};
  const profile = await db.prepare("SELECT visibility,indexing FROM jobs_users WHERE subject=? AND closed_at IS NULL AND restricted=0 AND eligible=1").bind(owner).first<{ visibility: string; indexing: number }>();
  if (!profile) return {};
  if (!forIndex && viewer?.subject === owner) return fields;
  if (forIndex && (profile.visibility !== "PUBLIC" || !profile.indexing)) return {};
  if (profile.visibility === "PRIVATE") return {};
  if (profile.visibility === "RECRUITERS_ONLY") {
    if (!viewer) return {};
    const recruiter = await db.prepare(`SELECT m.subject FROM memberships m JOIN jobs_users u ON u.subject=m.subject WHERE m.subject=? AND m.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM companies c WHERE c.id=m.company AND c.restricted=1) AND u.eligible=1 AND u.closed_at IS NULL AND u.restricted=0`).bind(viewer.subject).first();
    if (!recruiter) return {};
  }
  return Object.fromEntries(PUBLIC_FIELDS.filter(key => visibleFields.includes(key) && key in fields).map(key => [key, fields[key]]));
}

/** Input must be a server-loaded, purpose-specific submitted snapshot, never live profile
 * data or request-supplied ownership. General private visibility does not undo submission. */
export async function projectApplication(db: JobsDatabase, viewer: Identity, snapshot: {
  candidate: string; company: string; listing: string; restricted: boolean; fields: ProfileFields;
}): Promise<ProfileFields> {
  const gate = await db.prepare("SELECT ready FROM restore_gate WHERE id=1").first<{ ready: number }>();
  if (gate?.ready !== 1 || snapshot.restricted) throw new JobsError(403, "forbidden");
  await requireEligible(db, viewer);
  if (viewer.subject !== snapshot.candidate) await requireAssigned(db, viewer, snapshot.company, snapshot.listing);
  const allowed: (keyof ProfileFields)[] = [...PUBLIC_FIELDS, "email", "phone", "salary"];
  return Object.fromEntries(allowed.filter(key => key in snapshot.fields).map(key => [key, snapshot.fields[key]]));
}

export const retentionDefaults = Object.freeze({ APPLICATION: 180, CLOSURE: 30, MODERATION: 90 });
export type RetentionRules = typeof retentionDefaults;
export class JobsPrivacy {
  constructor(private readonly db: JobsDatabase, private readonly clock: () => number = Date.now, private readonly days: RetentionRules = retentionDefaults) {
    if (Object.values(days).some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error("Invalid retention rules");
  }
  async close(actor: Identity): Promise<void> {
    await requireEligible(this.db, actor);
    const now = this.clock();
    await this.db.batch([
      this.db.prepare("UPDATE jobs_users SET closed_at=?,visibility='PRIVATE',indexing=0 WHERE subject=?").bind(now, actor.subject),
      this.db.prepare("UPDATE memberships SET revoked_at=COALESCE(revoked_at,?) WHERE subject=?").bind(now, actor.subject),
      this.db.prepare("UPDATE retained_records SET restricted=1 WHERE subject=?").bind(actor.subject),
      this.db.prepare("INSERT INTO privacy_audit(actor,action,at) VALUES(?,'JOBS_CLOSED',?)").bind(actor.subject, now),
    ]);
  }
  /** Caller must supply a trusted recent account reauthentication claim. No recruiter notes,
   * investigation evidence, other products or shared account credentials are exported. */
  async exportOwn(actor:Identity){
    const now=this.clock();if(!actor.reauthenticatedAt||actor.reauthenticatedAt>now||now-actor.reauthenticatedAt>5*60_000)throw new JobsError(403,'reauthentication_required');
    const approved=await this.db.prepare("SELECT id FROM privacy_requests WHERE subject=? AND kind='EXPORT' AND status='REVIEWING' ORDER BY requested_at DESC LIMIT 1").bind(actor.subject).first();
    if(!approved)throw new JobsError(403,'export_review_required');
    const profile=await this.db.prepare('SELECT data,visibility,indexing,updated_at FROM jobs_profiles WHERE subject=?').bind(actor.subject).first<{data:string;visibility:string;indexing:number;updated_at:number}>();
    const applications=(await this.db.prepare('SELECT id,company,listing,status,snapshot,created_at,updated_at FROM applications WHERE candidate=? ORDER BY created_at DESC LIMIT 1000').bind(actor.subject).all<{id:string;company:string;listing:string;status:string;snapshot:string;created_at:number;updated_at:number}>()).results;
    const interviews=(await this.db.prepare("SELECT i.id,i.application,i.state,i.confirmed_slot,i.created_at,i.updated_at FROM interviews i JOIN interview_participants p ON p.interview=i.id WHERE p.subject=? ORDER BY i.created_at DESC LIMIT 1000").bind(actor.subject).all()).results;
    await this.db.prepare("INSERT INTO privacy_audit(actor,action,at) VALUES(?,'EXPORT',?)").bind(actor.subject,now).run();
    await this.db.prepare("UPDATE privacy_requests SET status='COMPLETED',completed_at=? WHERE subject=? AND kind='EXPORT' AND status='REVIEWING'").bind(now,actor.subject).run();
    return {product:'BILLIONJOBS',subject:actor.subject,generatedAt:now,profile:profile?{data:JSON.parse(profile.data),visibility:profile.visibility,indexing:!!profile.indexing,updatedAt:profile.updated_at}:null,
      applications:applications.map(a=>({...a,snapshot:JSON.parse(a.snapshot)})),interviews};
  }
  async restrict(actor: Identity, record: string, hold: boolean, retainUntil: number | null, reason: string): Promise<void> {
    await requirePrivacyOperator(this.db, actor);
    if (!["LEGAL_HOLD", "STATUTORY_RETENTION", "DISPUTE"].includes(reason) || (retainUntil !== null && !Number.isSafeInteger(retainUntil))) throw new JobsError(400, "invalid_exception");
    await this.db.batch([
      this.db.prepare("INSERT INTO retention_exceptions(record_id,hold,retain_until,reason_code,operator) VALUES(?,?,?,?,?) ON CONFLICT(record_id) DO UPDATE SET hold=excluded.hold,retain_until=excluded.retain_until,reason_code=excluded.reason_code,operator=excluded.operator").bind(record, Number(hold), retainUntil, reason, actor.subject),
      this.db.prepare("UPDATE retained_records SET restricted=1 WHERE id=?").bind(record),
      this.db.prepare("INSERT INTO privacy_audit(actor,action,at) VALUES(?,'RETENTION_EXCEPTION',?)").bind(actor.subject, this.clock()),
    ]);
  }
  async purge(actor: Identity): Promise<void> {
    await requirePrivacyOperator(this.db, actor);
    const now = this.clock();
    const policies=(await this.db.prepare("SELECT key,value FROM jobs_policy_versions WHERE key IN ('retention_application_days','retention_moderation_days')").all<{key:string;value:string}>()).results;
    const configured=Object.fromEntries(policies.map(p=>[p.key,Number(JSON.parse(p.value))]));
    const applicationDays=configured.retention_application_days??this.days.APPLICATION;
    const moderationDays=configured.retention_moderation_days??this.days.MODERATION;
    if(configured.retention_application_days!==undefined&&(!Number.isSafeInteger(applicationDays)||applicationDays<180)||
      configured.retention_moderation_days!==undefined&&(!Number.isSafeInteger(moderationDays)||moderationDays<30))throw new JobsError(503,'invalid_retention_policy');
    await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO deletion_ledger(record_id,subject,deleted_at)
       SELECT r.id,r.subject,? FROM retained_records r LEFT JOIN retention_exceptions e ON e.record_id=r.id
       WHERE r.ended_at + CASE r.kind WHEN 'APPLICATION' THEN ? WHEN 'CLOSURE' THEN ? ELSE ? END <= ?
       AND COALESCE(e.hold,0)=0 AND COALESCE(e.retain_until,0)<=?
       AND NOT EXISTS(SELECT 1 FROM legal_holds h WHERE h.subject=r.subject AND h.released_at IS NULL)`)
        .bind(now, applicationDays * DAY, this.days.CLOSURE * DAY, moderationDays * DAY, now, now),
      this.db.prepare("DELETE FROM retention_exceptions WHERE record_id IN (SELECT record_id FROM deletion_ledger) AND hold=0 AND COALESCE(retain_until,0)<=?").bind(now),
      this.db.prepare("DELETE FROM retained_records WHERE id IN (SELECT record_id FROM deletion_ledger) AND NOT EXISTS (SELECT 1 FROM retention_exceptions e WHERE e.record_id=retained_records.id)"),
      this.db.prepare("INSERT INTO privacy_audit(actor,action,at) VALUES(?,'PURGE',?)").bind(actor.subject, now),
    ]);
  }
  async readOwn(actor: Identity, id: string): Promise<unknown> {
    await requireEligible(this.db, actor);
    const gate = await this.db.prepare("SELECT ready FROM restore_gate WHERE id=1").first<{ ready: number }>();
    if (!gate?.ready) throw new JobsError(503, "restore_pending");
    return this.db.prepare(`SELECT payload FROM retained_records WHERE id=? AND subject=? AND restricted=0
      AND NOT EXISTS (SELECT 1 FROM retention_exceptions WHERE record_id=retained_records.id)
      AND NOT EXISTS (SELECT 1 FROM deletion_ledger WHERE record_id=retained_records.id)`).bind(id, actor.subject).first();
  }
  /** Trusted offline recovery only. Supply the independently preserved deletion ledger;
   * restore gate must be closed BEFORE importing any snapshot or serving requests. */
  async replayDeletionLedger(actor: Identity, ledger: { record: string; subject: string; at: number }[]): Promise<void> {
    await requirePrivacyOperator(this.db, actor);
    const gate = await this.db.prepare("SELECT ready FROM restore_gate WHERE id=1").first<{ ready: number }>();
    if (gate?.ready !== 0) throw new JobsError(409, "restore_gate_required");
    for (const entry of ledger) await this.db.prepare("INSERT OR IGNORE INTO deletion_ledger(record_id,subject,deleted_at) VALUES(?,?,?)").bind(entry.record, entry.subject, entry.at).run();
    await this.db.prepare("UPDATE retained_records SET restricted=1 WHERE id IN (SELECT record_id FROM deletion_ledger)").run();
    await this.purge(actor);
    await this.db.prepare("UPDATE restore_gate SET ready=1 WHERE id=1").run();
  }
}
