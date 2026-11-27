import { JobsError, type Identity, type JobsDatabase } from './contracts';
import { requireEligible } from './permissions';
import { projectProfile } from './privacy';

export const disclosureFields = ['name','headline','summary','location','experience','education','skills','certifications','openToWork','preferences'] as const;
export type Entry = { title: string; organization: string; start: string; end: string; description: string };
export type ProfileData = {
  name: string; headline: string; summary: string; location: string;
  experience: Entry[]; education: Entry[]; certifications: Entry[]; skills: string[];
  openToWork: boolean; preferences: { roles: string; locations: string; workMode: string };
};
export type ProfileInput = { revision: number; data: ProfileData; visibleFields: string[]; visibility: 'PRIVATE'|'RECRUITERS_ONLY'|'PUBLIC'; indexing: boolean };
type Row = { subject: string; id: string; revision: number; data: string; visible_fields: string; visibility: ProfileInput['visibility']; indexing: number; updated_at: number };
function invalid(): never { throw new JobsError(400, 'invalid_profile'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !Object.prototype.hasOwnProperty.call(value,k))) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid();
  const result = value.trim(); if (required && !result) invalid(); return result;
}
function entries(value: unknown): Entry[] {
  if (!Array.isArray(value) || value.length > 20) invalid();
  return value.map(v => {
    const r = object(v, ['title','organization','start','end','description']);
    const start = text(r.start,7), end = text(r.end,7);
    if ([start,end].some(d => d !== '' && !/^(19|20|21)\d\d-(0[1-9]|1[0-2])$/.test(d)) || (start && end && start > end)) invalid();
    return { title:text(r.title,120,true), organization:text(r.organization,160,true), start, end, description:text(r.description,1000) };
  });
}
export function validateProfile(value: unknown): ProfileInput {
  const r = object(value,['revision','data','visibleFields','visibility','indexing']);
  if (!Number.isSafeInteger(r.revision) || (r.revision as number)<0 || !['PRIVATE','RECRUITERS_ONLY','PUBLIC'].includes(String(r.visibility)) || typeof r.indexing !== 'boolean' || (r.indexing && r.visibility!=='PUBLIC')) invalid();
  if (!Array.isArray(r.visibleFields) || r.visibleFields.length>disclosureFields.length || r.visibleFields.some(f => !disclosureFields.includes(f)) || new Set(r.visibleFields).size!==r.visibleFields.length) invalid();
  const d=object(r.data,['name','headline','summary','location','experience','education','skills','certifications','openToWork','preferences']);
  if (!Array.isArray(d.skills) || d.skills.length>30 || typeof d.openToWork!=='boolean') invalid();
  const skills=d.skills.map(s=>text(s,60,true)); if (new Set(skills.map(s=>s.toLowerCase())).size!==skills.length) invalid();
  const p=object(d.preferences,['roles','locations','workMode']);
  const workMode=text(p.workMode,20); if (!['','REMOTE','HYBRID','ONSITE','FLEXIBLE'].includes(workMode)) invalid();
  return {revision:r.revision as number, visibility:r.visibility as ProfileInput['visibility'], indexing:r.indexing, visibleFields:r.visibleFields,
    data:{name:text(d.name,100,true), headline:text(d.headline,160), summary:text(d.summary,3000), location:text(d.location,160),
      experience:entries(d.experience), education:entries(d.education), certifications:entries(d.certifications), skills, openToWork:d.openToWork,
      preferences:{roles:text(p.roles,300),locations:text(p.locations,300),workMode}}};
}
export function completion(data: ProfileData): number {
  // Optional history is never a publishing or eligibility prerequisite.
  return Math.round([data.name,data.headline,data.summary,data.location,data.skills.length,data.experience.length,data.education.length,data.certifications.length,data.preferences.roles].filter(Boolean).length/9*100);
}
function own(row: Row) {
  const data=JSON.parse(row.data) as ProfileData;
  return {id:row.id,revision:row.revision,data,visibility:row.visibility,indexing:!!row.indexing,visibleFields:JSON.parse(row.visible_fields) as string[],updatedAt:row.updated_at,completion:completion(data)};
}
export class Profiles {
  constructor(private readonly db: JobsDatabase) {}
  async get(actor: Identity) {
    await requireEligible(this.db,actor);
    const row=await this.db.prepare(`SELECT p.* FROM jobs_profiles p JOIN jobs_users u ON u.subject=p.subject WHERE p.subject=? AND u.eligible=1 AND u.closed_at IS NULL AND u.restricted=0 AND EXISTS(SELECT 1 FROM restore_gate WHERE ready=1) AND NOT EXISTS(SELECT 1 FROM deletion_ledger WHERE record_id=p.id)`).bind(actor.subject).first<Row>();
    return row ? own(row) : null;
  }
  async save(actor: Identity, input: unknown) {
    await requireEligible(this.db,actor); const value=validateProfile(input);
    // One atomic compare-and-swap; trigger synchronizes privacy in the same transaction.
    const row=await this.db.prepare(`INSERT INTO jobs_profiles(subject,id,revision,data,visible_fields,visibility,indexing,updated_at)
      SELECT ?,?,1,?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM jobs_profiles WHERE subject=?)
      ON CONFLICT(subject) DO UPDATE SET revision=jobs_profiles.revision+1,data=excluded.data,visible_fields=excluded.visible_fields,visibility=excluded.visibility,indexing=excluded.indexing,updated_at=excluded.updated_at
      WHERE jobs_profiles.revision=? RETURNING *`).bind(actor.subject,crypto.randomUUID(),JSON.stringify(value.data),JSON.stringify(value.visibleFields),value.visibility,Number(value.indexing),Date.now(),value.revision,actor.subject,value.revision).first<Row>();
    if (!row) throw new JobsError(409,'profile_conflict'); return own(row);
  }
  async remove(actor: Identity, revision: unknown) {
    await requireEligible(this.db,actor);
    if (!Number.isSafeInteger(revision) || (revision as number)<1) invalid();
    // Ledger insertion and deletion are atomic via profile_deletion_replay.
    const row=await this.db.prepare(`INSERT INTO deletion_ledger(record_id,subject,deleted_at)
      SELECT p.id,p.subject,? FROM jobs_profiles p JOIN jobs_users u ON u.subject=p.subject WHERE p.subject=? AND p.revision=? AND u.eligible=1 AND u.closed_at IS NULL AND u.restricted=0 AND EXISTS(SELECT 1 FROM restore_gate WHERE ready=1) RETURNING record_id`).bind(Date.now(),actor.subject,revision).first();
    if (!row) throw new JobsError(409,'profile_conflict');
  }
  async shared(id: string, viewer: Identity|null) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new JobsError(404,'not_found');
    const row=await this.db.prepare(`SELECT p.* FROM jobs_profiles p JOIN jobs_users u ON u.subject=p.subject WHERE p.id=? AND u.eligible=1 AND u.closed_at IS NULL AND u.restricted=0 AND NOT EXISTS(SELECT 1 FROM deletion_ledger WHERE record_id=p.id)`).bind(id).first<Row>();
    if (!row) throw new JobsError(404,'not_found');
    // Shared views never use the owner bypass: even the candidate sees the disclosed projection.
    const fields=await projectProfile(this.db,row.subject,viewer?.subject===row.subject ? null : viewer,JSON.parse(row.data),JSON.parse(row.visible_fields));
    if (!Object.keys(fields).length) throw new JobsError(404,'not_found');
    return {fields,indexing: row.visibility==='PUBLIC' && !!row.indexing};
  }
}
