import { identifier, JobsError, type Identity, type JobsDatabase } from './contracts';
import { requireEligible } from './permissions';
import { digest } from './companies';

export type AdminRole='PLATFORM_OWNER'|'PRODUCT_ADMIN'|'SECURITY_ADMIN'|'MODERATOR'|'SUPPORT'|'PRIVACY_ADMIN'|'AUDITOR';
export type AdminPermission='DASHBOARD'|'CASE_READ'|'CASE_DECIDE'|'ENFORCE'|'APPEAL_REVIEW'|'PRIVACY_REVIEW'|'INCIDENT'|'POLICY'|'ROLE_GRANT'|'AUDIT_READ';
const permissions:Record<AdminRole,readonly AdminPermission[]>={
  PLATFORM_OWNER:['DASHBOARD','CASE_READ','CASE_DECIDE','ENFORCE','APPEAL_REVIEW','PRIVACY_REVIEW','INCIDENT','POLICY','ROLE_GRANT','AUDIT_READ'],
  PRODUCT_ADMIN:['DASHBOARD','CASE_READ','CASE_DECIDE','ENFORCE','APPEAL_REVIEW','POLICY','AUDIT_READ'],
  SECURITY_ADMIN:['DASHBOARD','CASE_READ','ENFORCE','INCIDENT','AUDIT_READ'],
  MODERATOR:['DASHBOARD','CASE_READ','CASE_DECIDE','ENFORCE','APPEAL_REVIEW'],
  SUPPORT:['DASHBOARD','CASE_READ'], PRIVACY_ADMIN:['DASHBOARD','CASE_READ','PRIVACY_REVIEW','AUDIT_READ'],
  AUDITOR:['DASHBOARD','AUDIT_READ']
};
const fresh=(at:number|undefined,now:number,window:number)=>typeof at==='number'&&at<=now&&now-at<=window;
function bounded(value:unknown,max=1000):string {if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new JobsError(400,'invalid_input');return value.trim();}
function finiteRevision(value:unknown):number {if(!Number.isSafeInteger(value)||Number(value)<1)throw new JobsError(400,'invalid_revision');return Number(value);}
function page(url:URL){const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit')||25)));const offset=Math.max(0,Number(url.searchParams.get('offset')||0));if(!Number.isSafeInteger(limit)||!Number.isSafeInteger(offset)||offset>100000)throw new JobsError(400,'invalid_page');return {limit,offset};}

/** Production account identity deliberately supplies no MFA or recent reauthentication claim yet. */
export class JobsGovernance {
  constructor(private readonly db:JobsDatabase,private readonly clock:()=>number=Date.now){}
  private async audit(actor:Identity,purpose:string,targetType:string,targetRef:string,action:string,outcome='SUCCESS',revision:number|null=null){
    await this.db.prepare('INSERT INTO admin_audit VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.subject,'BILLIONJOBS',purpose,targetType,targetRef,action,outcome,revision,this.clock()).run();
  }
  async authorize(actor:Identity,permission:AdminPermission,highImpact=false){
    await requireEligible(this.db,actor);
    if(!fresh(actor.privilegedMfaAt,this.clock(),15*60_000))throw new JobsError(403,'admin_mfa_required');
    if(highImpact&&!fresh(actor.reauthenticatedAt,this.clock(),5*60_000))throw new JobsError(403,'admin_reauthentication_required');
    const grants=(await this.db.prepare("SELECT role FROM admin_grants WHERE subject=? AND product='BILLIONJOBS' AND revoked_at IS NULL").bind(actor.subject).all<{role:AdminRole}>()).results;
    if(!grants.some(g=>permissions[g.role]?.includes(permission)))throw new JobsError(403,'admin_forbidden');
  }
  async dashboard(actor:Identity){
    await this.authorize(actor,'DASHBOARD');
    const counts=await this.db.prepare(`SELECT
      (SELECT count(*) FROM jobs_users WHERE eligible=1 AND closed_at IS NULL) users,
      (SELECT count(*) FROM jobs_users WHERE restricted=1 AND closed_at IS NULL) restricted_users,
      (SELECT count(*) FROM companies WHERE restricted=0) companies,
      (SELECT count(*) FROM memberships WHERE revoked_at IS NULL) recruiters,
      (SELECT count(*) FROM listings WHERE state='ACTIVE' AND expires_at>?) active_jobs,
      (SELECT count(*) FROM moderation_cases WHERE status NOT IN ('RESOLVED','CLOSED')) pending_cases,
      (SELECT count(*) FROM enforcement_appeals WHERE status IN ('SUBMITTED','ACKNOWLEDGED','REVIEWING','MORE_INFO')) pending_appeals,
      (SELECT count(*) FROM privacy_requests WHERE status IN ('SUBMITTED','REVIEWING')) privacy_requests,
      (SELECT count(*) FROM security_incidents WHERE status<>'RESOLVED') incidents,
      (SELECT count(*) FROM interview_meeting_outbox WHERE status IN ('PENDING','FAILED')) operational_failures,
      (SELECT count(*) FROM fraud_signals WHERE status='OPEN') fraud_signals`).bind(this.clock()).first();
    await this.audit(actor,'OPERATIONS','DASHBOARD','BILLIONJOBS','READ');return {asOf:this.clock(),counts};
  }
  async cases(actor:Identity,url:URL){await this.authorize(actor,'CASE_READ');const {limit,offset}=page(url);const status=url.searchParams.get('status')||'';
    if(status&&!['OPEN','ASSIGNED','WAITING','RESOLVED','CLOSED'].includes(status))throw new JobsError(400,'invalid_status');
    const rows=(await this.db.prepare('SELECT id,kind,target_ref,category,severity,status,assignee,created_at,updated_at,revision FROM moderation_cases WHERE (?=\'\' OR status=?) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(status,status,limit,offset).all()).results;
    await this.audit(actor,'MODERATION','CASE_QUEUE','BILLIONJOBS','LIST');return {rows,limit,offset};
  }
  async report(actor:Identity,input:unknown){await requireEligible(this.db,actor);const x=input as Record<string,unknown>;
    if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!['kind','targetRef','category','detail'].includes(k)))throw new JobsError(400,'invalid_report');
    const kind=bounded(x.kind,30),category=bounded(x.category,80),target=bounded(x.targetRef,80),detail=bounded(x.detail,2000);
    if(!['JOB','COMPANY','RECRUITER','CANDIDATE','INTERVIEW','HARASSMENT','SCAM','PRIVACY'].includes(kind))throw new JobsError(400,'invalid_report');
    const recent=await this.db.prepare('SELECT count(*) n FROM moderation_cases WHERE reporter=? AND created_at>?').bind(actor.subject,this.clock()-86400000).first<{n:number}>();
    if((recent?.n||0)>=5)throw new JobsError(429,'report_rate_limit');const id=crypto.randomUUID(),now=this.clock();
    await this.db.batch([this.db.prepare('INSERT INTO moderation_cases(id,kind,target_ref,reporter,category,severity,status,created_at,updated_at) VALUES(?,?,?,?,?,\'MEDIUM\',\'OPEN\',?,?)').bind(id,kind,target,actor.subject,category,now,now),
      this.db.prepare('INSERT INTO moderation_events(id,case_id,actor,action,public_status,internal_note,at) VALUES(?,?,?,\'SUBMITTED\',\'OPEN\',?,?)').bind(crypto.randomUUID(),id,actor.subject,detail,now)]);
    return {id,status:'OPEN'};
  }
  async ownCase(actor:Identity,id:string){const row=await this.db.prepare('SELECT id,kind,category,status,created_at,updated_at FROM moderation_cases WHERE id=? AND reporter=?').bind(identifier(id),actor.subject).first();if(!row)throw new JobsError(404,'case_not_found');return row;}
  async decideCase(actor:Identity,id:string,input:{revision:number;status:'ASSIGNED'|'WAITING'|'RESOLVED'|'CLOSED';note:string;assignee?:string}){
    await this.authorize(actor,'CASE_DECIDE');identifier(id);const revision=finiteRevision(input.revision),note=bounded(input.note,2000),now=this.clock();
    const result=await this.db.prepare('UPDATE moderation_cases SET status=?,assignee=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=? RETURNING revision').bind(input.status,input.assignee||actor.subject,now,id,revision).first<{revision:number}>();
    if(!result)throw new JobsError(409,'case_conflict');await this.db.prepare('INSERT INTO moderation_events VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,actor.subject,'STATUS',input.status,note,null,now).run();
    await this.audit(actor,'MODERATION','CASE',id,'DECIDE','SUCCESS',result.revision);return {id,status:input.status,revision:result.revision};
  }
  async enforce(actor:Identity,input:{caseId:string;targetKind:'USER'|'COMPANY'|'LISTING'|'RECRUITER';targetRef:string;kind:string;reasonCode:string;expiresAt?:number;evidenceRef?:string}){
    await this.authorize(actor,'ENFORCE',true);const caseId=identifier(input.caseId),targetRef=input.targetKind==='LISTING'?bounded(input.targetRef,161):identifier(input.targetRef),reason=bounded(input.reasonCode,80);
    if(!['WARNING','FEATURE','POSTING','RECRUITER','JOBS_TEMP','JOBS_PERMANENT','EMERGENCY','REMOVE_DISCOVERY'].includes(input.kind)||!['USER','COMPANY','LISTING','RECRUITER'].includes(input.targetKind))throw new JobsError(400,'invalid_action');
    if(input.targetKind==='LISTING'&&!/^[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}$/.test(targetRef))throw new JobsError(400,'invalid_listing_target');
    if(input.expiresAt!==undefined&&(!Number.isSafeInteger(input.expiresAt)||input.expiresAt<=this.clock()))throw new JobsError(400,'invalid_expiry');
    const id=crypto.randomUUID(),now=this.clock();await this.db.prepare('INSERT INTO enforcement_actions(id,case_id,target_kind,target_ref,kind,reason_code,actor,evidence_ref,starts_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,caseId,input.targetKind,targetRef,input.kind,reason,actor.subject,input.evidenceRef||null,now,input.expiresAt||null).run();
    await this.audit(actor,'ENFORCEMENT',input.targetKind,targetRef,input.kind,'SUCCESS',1);return {id};
  }
  async activeRestrictions(targetKind:string,targetRef:string){const rows=(await this.db.prepare('SELECT id,kind,reason_code,expires_at FROM enforcement_actions WHERE target_kind=? AND target_ref=? AND revoked_at IS NULL AND starts_at<=? AND (expires_at IS NULL OR expires_at>?)').bind(targetKind,targetRef,this.clock(),this.clock()).all()).results;return rows;}
  async appeal(actor:Identity,actionId:string,reason:string){identifier(actionId);const enrolled=await this.db.prepare('SELECT subject FROM jobs_users WHERE subject=? AND eligible=1 AND closed_at IS NULL').bind(actor.subject).first();if(!enrolled)throw new JobsError(403,'jobs_ineligible');const action=await this.db.prepare('SELECT target_kind,target_ref FROM enforcement_actions WHERE id=?').bind(actionId).first<{target_kind:string;target_ref:string}>();if(!action||action.target_kind!=='USER'||action.target_ref!==actor.subject)throw new JobsError(404,'action_not_found');
    const id=crypto.randomUUID(),now=this.clock();try{await this.db.prepare("INSERT INTO enforcement_appeals VALUES(?,?,?,'SUBMITTED',NULL,?,NULL,?,?,1)").bind(id,actionId,actor.subject,bounded(reason,2000),now,now).run();}catch{throw new JobsError(409,'appeal_pending');}return {id,status:'SUBMITTED'};}
  async resolveAppeal(actor:Identity,id:string,revision:number,overturn:boolean,note:string){await this.authorize(actor,'APPEAL_REVIEW',true);identifier(id);const now=this.clock();
    const appeal=await this.db.prepare('SELECT action_id,appellant FROM enforcement_appeals WHERE id=? AND revision=? AND status NOT IN (\'UPHELD\',\'OVERTURNED\')').bind(id,finiteRevision(revision)).first<{action_id:string;appellant:string}>();if(!appeal)throw new JobsError(409,'appeal_conflict');
    await this.db.batch([this.db.prepare("UPDATE enforcement_appeals SET status=?,reviewer=?,decision_note=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?").bind(overturn?'OVERTURNED':'UPHELD',actor.subject,bounded(note,2000),now,id,revision),...(overturn?[this.db.prepare('UPDATE enforcement_actions SET revoked_at=?,revision=revision+1 WHERE id=? AND revoked_at IS NULL').bind(now,appeal.action_id)]:[])]);
    await this.audit(actor,'APPEAL','APPEAL',id,overturn?'OVERTURN':'UPHOLD');return {id,status:overturn?'OVERTURNED':'UPHELD'};}
  async auditPage(actor:Identity,url:URL){await this.authorize(actor,'AUDIT_READ');const {limit,offset}=page(url);const rows=(await this.db.prepare('SELECT id,actor,product,purpose,target_type,target_ref,action,outcome,revision,at FROM admin_audit WHERE product=\'BILLIONJOBS\' ORDER BY at DESC,id DESC LIMIT ? OFFSET ?').bind(limit,offset).all()).results;await this.audit(actor,'AUDIT','AUDIT_TRAIL','BILLIONJOBS','LIST');return {rows,limit,offset};}

  async requestOwnershipTransfer(actor:Identity,companyId:string,recipientSubject:string,recipientEmail:string,revision:number){
    await requireEligible(this.db,actor);
    if(!fresh(actor.reauthenticatedAt,this.clock(),5*60_000))throw new JobsError(403,'reauthentication_required');
    const company=await this.db.prepare('SELECT owner,revision FROM companies WHERE id=? AND NOT EXISTS(SELECT 1 FROM company_retirements WHERE company=companies.id)').bind(identifier(companyId)).first<{owner:string;revision:number}>();
    if(!company||company.owner!==actor.subject)throw new JobsError(403,'owner_required');
    if(company.revision!==finiteRevision(revision))throw new JobsError(409,'company_conflict');
    const recipient=await this.db.prepare('SELECT subject FROM jobs_users WHERE subject=? AND eligible=1 AND restricted=0 AND closed_at IS NULL').bind(identifier(recipientSubject)).first();
    if(!recipient||recipientSubject===actor.subject)throw new JobsError(400,'invalid_recipient');
    const email=bounded(recipientEmail,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new JobsError(400,'invalid_recipient');
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');const id=crypto.randomUUID(),now=this.clock();
    await this.db.batch([this.db.prepare('UPDATE ownership_transfers SET cancelled_at=? WHERE company=? AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at<=?').bind(now,companyId,now),
      this.db.prepare('INSERT INTO ownership_transfers VALUES(?,?,?,?,?,?,?,?,NULL,NULL,?)').bind(id,companyId,actor.subject,recipientSubject,await digest(email),await digest(token),revision,now+7*86400000,now)]);
    await this.audit(actor,'OWNERSHIP','COMPANY',companyId,'TRANSFER_REQUEST','SUCCESS',revision);
    return {id,token,expiresAt:now+7*86400000};
  }
  async acceptOwnershipTransfer(actor:Identity,id:string,token:string){
    await requireEligible(this.db,actor);if(!actor.recipientHash)throw new JobsError(403,'verified_identity_required');
    const transfer=await this.db.prepare('SELECT company,recipient_hash FROM ownership_transfers WHERE id=? AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at>?').bind(identifier(id),this.clock()).first<{company:string;recipient_hash:string}>();
    if(!transfer||transfer.recipient_hash!==actor.recipientHash)throw new JobsError(404,'transfer_not_found');
    try{await this.db.prepare('INSERT INTO ownership_acceptances VALUES(?,?,?,?)').bind(id,actor.subject,await digest(bounded(token,64)),this.clock()).run();}
    catch{throw new JobsError(409,'transfer_invalid');}
    await this.audit(actor,'OWNERSHIP','COMPANY',transfer.company,'TRANSFER_ACCEPT');return {company:transfer.company,accepted:true};
  }
  async retireCompany(actor:Identity,companyId:string,reasonCode:string,revision:number){
    await requireEligible(this.db,actor);if(!fresh(actor.reauthenticatedAt,this.clock(),5*60_000))throw new JobsError(403,'reauthentication_required');
    const company=await this.db.prepare('SELECT owner,revision FROM companies WHERE id=?').bind(identifier(companyId)).first<{owner:string;revision:number}>();
    if(!company||company.owner!==actor.subject)throw new JobsError(403,'owner_required');if(company.revision!==finiteRevision(revision))throw new JobsError(409,'company_conflict');
    const now=this.clock();await this.db.batch([
      this.db.prepare('INSERT INTO company_retirements VALUES(?,?,?,?,?)').bind(companyId,actor.subject,bounded(reasonCode,80),now,revision),
      this.db.prepare('UPDATE companies SET restricted=1,revision=revision+1 WHERE id=? AND revision=?').bind(companyId,revision),
      this.db.prepare("UPDATE listings SET state='CLOSED',revision=revision+1 WHERE company=? AND state='ACTIVE'").bind(companyId),
      this.db.prepare('UPDATE memberships SET revoked_at=COALESCE(revoked_at,?) WHERE company=?').bind(now,companyId),
      this.db.prepare('UPDATE company_invitations SET revoked_at=? WHERE company=? AND used_at IS NULL AND revoked_at IS NULL').bind(now,companyId),
      this.db.prepare('DELETE FROM assignments WHERE company=?').bind(companyId),
      this.db.prepare('UPDATE ownership_transfers SET cancelled_at=? WHERE company=? AND accepted_at IS NULL AND cancelled_at IS NULL').bind(now,companyId)
    ]);
    await this.audit(actor,'OWNERSHIP','COMPANY',companyId,'RETIRE');return {company:companyId,retired:true};
  }
  async grantRole(actor:Identity,subject:string,role:AdminRole){
    await this.authorize(actor,'ROLE_GRANT',true);identifier(subject);if(subject===actor.subject)throw new JobsError(403,'self_grant_forbidden');
    if(!(role in permissions))throw new JobsError(400,'invalid_role');
    const target=await this.db.prepare('SELECT subject FROM jobs_users WHERE subject=? AND eligible=1 AND restricted=0 AND closed_at IS NULL').bind(subject).first();if(!target)throw new JobsError(404,'subject_not_found');
    await this.db.prepare("INSERT INTO admin_grants VALUES(?,'BILLIONJOBS',?,?,?,NULL) ON CONFLICT(subject,product,role) DO UPDATE SET granted_by=excluded.granted_by,granted_at=excluded.granted_at,revoked_at=NULL").bind(subject,role,actor.subject,this.clock()).run();
    await this.audit(actor,'ROLE_MANAGEMENT','USER',subject,'GRANT_'+role);
  }
  async revokeRole(actor:Identity,subject:string,role:AdminRole){
    await this.authorize(actor,'ROLE_GRANT',true);identifier(subject);if(!(role in permissions))throw new JobsError(400,'invalid_role');
    if(role==='PLATFORM_OWNER'){
      const owners=await this.db.prepare("SELECT count(*) n FROM admin_grants WHERE product='BILLIONJOBS' AND role='PLATFORM_OWNER' AND revoked_at IS NULL").first<{n:number}>();
      if((owners?.n||0)<=1)throw new JobsError(409,'final_owner_protected');
    }
    await this.db.prepare("UPDATE admin_grants SET revoked_at=? WHERE subject=? AND product='BILLIONJOBS' AND role=? AND revoked_at IS NULL").bind(this.clock(),subject,role).run();
    await this.audit(actor,'ROLE_MANAGEMENT','USER',subject,'REVOKE_'+role);
  }
  async requestPrivacy(actor:Identity,kind:'EXPORT'|'DELETE'){
    await requireEligible(this.db,actor);if(!fresh(actor.reauthenticatedAt,this.clock(),5*60_000))throw new JobsError(403,'reauthentication_required');
    if(!['EXPORT','DELETE'].includes(kind))throw new JobsError(400,'invalid_request');
    const existing=await this.db.prepare("SELECT id FROM privacy_requests WHERE subject=? AND kind=? AND status IN ('SUBMITTED','REVIEWING')").bind(actor.subject,kind).first();if(existing)throw new JobsError(409,'request_pending');
    const id=crypto.randomUUID();await this.db.prepare("INSERT INTO privacy_requests VALUES(?,?,?,'SUBMITTED',NULL,?,NULL)").bind(id,actor.subject,kind,this.clock()).run();
    await this.audit(actor,'PRIVACY','USER',actor.subject,'REQUEST_'+kind);return {id,status:'SUBMITTED'};
  }
  async publishPrivacyNotice(actor:Identity,version:string,summary:string){await this.authorize(actor,'PRIVACY_REVIEW',true);
    if(!/^BJ-[A-Za-z0-9.-]{1,40}$/.test(version))throw new JobsError(400,'invalid_notice_version');
    const now=this.clock();await this.db.batch([
      this.db.prepare('UPDATE jobs_privacy_notices SET active=0 WHERE active=1'),
      this.db.prepare('INSERT INTO jobs_privacy_notices VALUES(?,?,?,1)').bind(version,now,bounded(summary,1000))
    ]);await this.audit(actor,'PRIVACY_NOTICE','NOTICE',version,'PUBLISH');return {version,active:true};
  }
  async recordConsent(actor:Identity,purpose:'OPTIONAL_ANALYTICS'|'PUBLIC_INDEXING',granted:boolean){await requireEligible(this.db,actor);
    if(!['OPTIONAL_ANALYTICS','PUBLIC_INDEXING'].includes(purpose)||typeof granted!=='boolean')throw new JobsError(400,'invalid_consent');
    const notice=await this.db.prepare('SELECT version FROM jobs_privacy_notices WHERE active=1').first<{version:string}>();if(!notice)throw new JobsError(409,'notice_unavailable');
    await this.db.prepare('INSERT INTO jobs_consent_events(id,subject,purpose,notice_version,granted,at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.subject,purpose,notice.version,Number(granted),this.clock()).run();
    if(purpose==='PUBLIC_INDEXING'&&!granted)await this.db.prepare("UPDATE jobs_profiles SET indexing=0 WHERE subject=? AND indexing=1").bind(actor.subject).run();
    await this.audit(actor,'CONSENT','USER',actor.subject,granted?'GRANT_'+purpose:'WITHDRAW_'+purpose);return {purpose,granted,noticeVersion:notice.version};
  }
  async legalHold(actor:Identity,subject:string,scope:string,reasonCode:string,reviewAt:number){
    await this.authorize(actor,'PRIVACY_REVIEW',true);identifier(subject);
    if(!Number.isSafeInteger(reviewAt)||reviewAt<=this.clock()||reviewAt>this.clock()+365*86400000)throw new JobsError(400,'invalid_review_date');
    const id=crypto.randomUUID();await this.db.prepare('INSERT INTO legal_holds VALUES(?,?,?,?,?,?,?,NULL,NULL)').bind(id,subject,bounded(reasonCode,80),bounded(scope,80),actor.subject,this.clock(),reviewAt).run();
    await this.audit(actor,'LEGAL_HOLD','USER',subject,'CREATE');return {id};
  }
  async releaseHold(actor:Identity,id:string){await this.authorize(actor,'PRIVACY_REVIEW',true);identifier(id);
    const hold=await this.db.prepare('UPDATE legal_holds SET released_at=?,release_actor=? WHERE id=? AND released_at IS NULL RETURNING subject').bind(this.clock(),actor.subject,id).first<{subject:string}>();if(!hold)throw new JobsError(404,'hold_not_found');
    await this.audit(actor,'LEGAL_HOLD','USER',hold.subject,'RELEASE');return {id,released:true};
  }
  async completePrivacy(actor:Identity,id:string,approved:boolean,reasonCode:string){await this.authorize(actor,'PRIVACY_REVIEW',true);identifier(id);
    const request=await this.db.prepare('SELECT subject,kind FROM privacy_requests WHERE id=? AND status IN (\'SUBMITTED\',\'REVIEWING\')').bind(id).first<{subject:string;kind:string}>();if(!request)throw new JobsError(409,'request_conflict');
    if(approved&&request.kind==='DELETE'){
      const hold=await this.db.prepare('SELECT id FROM legal_holds WHERE subject=? AND released_at IS NULL').bind(request.subject).first();if(hold)throw new JobsError(409,'legal_hold_active');
    }
    const status=approved&&request.kind==='EXPORT'?'REVIEWING':approved?'COMPLETED':'DENIED',now=this.clock();
    const statements=[this.db.prepare('UPDATE privacy_requests SET status=?,reason_code=?,completed_at=? WHERE id=? AND status IN (\'SUBMITTED\',\'REVIEWING\')').bind(status,bounded(reasonCode,80),status==='REVIEWING'?null:now,id)];
    if(approved&&request.kind==='DELETE')statements.push(
      this.db.prepare("UPDATE jobs_users SET closed_at=?,visibility='PRIVATE',indexing=0 WHERE subject=? AND closed_at IS NULL").bind(now,request.subject),
      this.db.prepare('UPDATE memberships SET revoked_at=COALESCE(revoked_at,?) WHERE subject=?').bind(now,request.subject),
      this.db.prepare('UPDATE retained_records SET restricted=1 WHERE subject=?').bind(request.subject),
      this.db.prepare("INSERT INTO privacy_audit(actor,action,at) VALUES(?,'JOBS_CLOSED',?)").bind(request.subject,now));
    await this.db.batch(statements);
    await this.audit(actor,'PRIVACY','USER',request.subject,approved?'REVIEW_'+request.kind:'DENY_'+request.kind);return {id,status};
  }
  async createIncident(actor:Identity,severity:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL',summary:string){await this.authorize(actor,'INCIDENT',true);
    if(!['LOW','MEDIUM','HIGH','CRITICAL'].includes(severity))throw new JobsError(400,'invalid_severity');const id=crypto.randomUUID(),now=this.clock();
    await this.db.batch([this.db.prepare("INSERT INTO security_incidents(id,severity,status,owner,summary,created_at,updated_at) VALUES(?,?,'OPEN',?,?,?,?)").bind(id,severity,actor.subject,bounded(summary,500),now,now),
      this.db.prepare("INSERT INTO incident_events(id,incident,actor,action,at) VALUES(?,?,?,'OPEN',?)").bind(crypto.randomUUID(),id,actor.subject,now)]);
    await this.audit(actor,'SECURITY_INCIDENT','INCIDENT',id,'OPEN');return {id,status:'OPEN'};
  }
  async incidentTransition(actor:Identity,id:string,revision:number,status:'CONTAINED'|'RECOVERING'|'RESOLVED',note:string,evidenceRef?:string){
    await this.authorize(actor,'INCIDENT',true);identifier(id);const allowed:Record<string,string[]>={OPEN:['CONTAINED'],CONTAINED:['RECOVERING'],RECOVERING:['RESOLVED']};
    const current=await this.db.prepare('SELECT status,revision FROM security_incidents WHERE id=?').bind(id).first<{status:string;revision:number}>();
    if(!current||current.revision!==finiteRevision(revision)||!allowed[current.status]?.includes(status))throw new JobsError(409,'incident_conflict');
    const now=this.clock();await this.db.batch([
      this.db.prepare('UPDATE security_incidents SET status=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(status,now,id,revision),
      this.db.prepare('INSERT INTO incident_events VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,actor.subject,status,evidenceRef?bounded(evidenceRef,200):null,bounded(note,1000),now)
    ]);await this.audit(actor,'SECURITY_INCIDENT','INCIDENT',id,status,'SUCCESS',revision+1);return {id,status,revision:revision+1};
  }
  async addCorrectiveAction(actor:Identity,incidentId:string,ownerSubject:string,description:string,dueAt:number){
    await this.authorize(actor,'INCIDENT',true);identifier(incidentId);identifier(ownerSubject);
    if(!Number.isSafeInteger(dueAt)||dueAt<=this.clock())throw new JobsError(400,'invalid_due_date');
    const id=crypto.randomUUID();await this.db.prepare('INSERT INTO incident_corrective_actions VALUES(?,?,?,?,?,NULL,?)').bind(id,incidentId,ownerSubject,bounded(description,500),dueAt,this.clock()).run();
    await this.audit(actor,'SECURITY_INCIDENT','INCIDENT',incidentId,'CORRECTIVE_ACTION');return {id};
  }
  async updatePolicy(actor:Identity,key:string,value:number,revision:number){await this.authorize(actor,'POLICY',true);
    const bounds:Record<string,[number,number]>={moderation_daily_signal_threshold:[2,100],complaint_response_target_days:[1,30],retention_moderation_days:[30,365],retention_application_days:[180,3650]};
    if(!bounds[key]||!Number.isSafeInteger(value)||value<bounds[key][0]||value>bounds[key][1])throw new JobsError(400,'invalid_policy');
    const current=await this.db.prepare('SELECT revision FROM jobs_policy_versions WHERE key=?').bind(key).first<{revision:number}>();
    if((current?.revision||0)!==revision)throw new JobsError(409,'policy_conflict');
    if(current)await this.db.prepare('UPDATE jobs_policy_versions SET value=?,revision=revision+1,effective_at=?,actor=? WHERE key=? AND revision=?').bind(JSON.stringify(value),this.clock(),actor.subject,key,revision).run();
    else await this.db.prepare('INSERT INTO jobs_policy_versions VALUES(?,?,1,?,?)').bind(key,JSON.stringify(value),this.clock(),actor.subject).run();
    await this.audit(actor,'POLICY','SETTING',key,'UPDATE','SUCCESS',revision+1);return {key,value,revision:revision+1};
  }
  /** Deterministic review indicators; this never changes listings or account authority. */
  async scanCompany(actor:Identity,companyId:string){await this.authorize(actor,'CASE_READ');identifier(companyId);
    const listings=(await this.db.prepare('SELECT id,data,publication FROM listing_details WHERE company=? ORDER BY created_at DESC LIMIT 100').bind(companyId).all<{id:string;data:string;publication:string}>()).results;
    const actions=await this.db.prepare("SELECT count(*) n FROM posting_actions WHERE company=? AND at>?").bind(companyId,this.clock()-86400000).first<{n:number}>();
    const threshold=await this.db.prepare("SELECT value FROM jobs_policy_versions WHERE key='moderation_daily_signal_threshold'").first<{value:string}>();
    const complaints=await this.db.prepare("SELECT count(*) n FROM moderation_cases WHERE kind IN ('JOB','COMPANY','RECRUITER','SCAM') AND target_ref=? AND status='RESOLVED'").bind(companyId).first<{n:number}>();
    const indicators:{rule:string;target:string;severity:string}[]=[];
    if((actions?.n||0)>=(threshold?Number(JSON.parse(threshold.value)):8))indicators.push({rule:'POSTING_FREQUENCY',target:companyId,severity:'MEDIUM'});
    if((complaints?.n||0)>=3)indicators.push({rule:'REPEATED_COMPLAINTS',target:companyId,severity:'HIGH'});
    const fingerprints=new Map<string,number>();
    for(const listing of listings){
      let data:Record<string,unknown>;try{data=JSON.parse(listing.data) as Record<string,unknown>;}catch{continue;}
      const content=JSON.stringify(data).slice(0,16000).toLowerCase();
      if(/(?:registration|processing|training|security)\s+fee|pay\s+(?:us|a\s+fee)|refundable\s+(?:deposit|fee)/i.test(content))indicators.push({rule:'POTENTIAL_RECRUITMENT_FEE',target:companyId+'/'+listing.id,severity:'HIGH'});
      const fingerprint=String(data.title||'').trim().toLowerCase()+'|'+String(data.location||'').trim().toLowerCase();
      if(fingerprint!=='|'){fingerprints.set(fingerprint,(fingerprints.get(fingerprint)||0)+1);if(fingerprints.get(fingerprint)===3)indicators.push({rule:'REPEATED_DUPLICATE',target:companyId,severity:'MEDIUM'});}
    }
    let created=0;for(const item of indicators){const result=await this.db.prepare("INSERT OR IGNORE INTO fraud_signals VALUES(?,?,?, ?,?,NULL,'OPEN',?,NULL,NULL) RETURNING id").bind(crypto.randomUUID(),item.rule,item.target===companyId?'COMPANY':'LISTING',item.target,item.severity,this.clock()).first();if(result)created++;}
    await this.audit(actor,'FRAUD_REVIEW','COMPANY',companyId,'SCAN');return {indicators:indicators.map(i=>({rule:i.rule,target:i.target,severity:i.severity,humanReviewRequired:true})),created};
  }
  async reviewSignal(actor:Identity,id:string,refer:boolean){await this.authorize(actor,'CASE_DECIDE');identifier(id);
    const result=await this.db.prepare('UPDATE fraud_signals SET status=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status=\'OPEN\' RETURNING target_kind,target_ref').bind(refer?'REFERRED':'DISMISSED',actor.subject,this.clock(),id).first<{target_kind:string;target_ref:string}>();
    if(!result)throw new JobsError(409,'signal_conflict');await this.audit(actor,'FRAUD_REVIEW',result.target_kind,result.target_ref,refer?'REFER':'DISMISS');return {id,status:refer?'REFERRED':'DISMISSED'};
  }
  async operationalQueue(actor:Identity,url:URL){await this.authorize(actor,'DASHBOARD');const {limit,offset}=page(url);
    const rows=(await this.db.prepare("SELECT id,interview,operation,status,attempts,next_attempt_at,last_error,updated_at FROM interview_meeting_outbox WHERE status IN ('PENDING','FAILED') ORDER BY updated_at DESC,id LIMIT ? OFFSET ?").bind(limit,offset).all()).results;
    await this.audit(actor,'OPERATIONS','OUTBOX','BILLIONJOBS','LIST');return {rows,limit,offset};
  }
  async retryOutbox(actor:Identity,id:string){await this.authorize(actor,'INCIDENT',true);identifier(id);
    const row=await this.db.prepare("UPDATE interview_meeting_outbox SET status='PENDING',attempts=0,next_attempt_at=?,updated_at=? WHERE id=? AND status='FAILED' RETURNING interview").bind(this.clock(),this.clock(),id).first<{interview:string}>();
    if(!row)throw new JobsError(409,'outbox_not_retryable');await this.audit(actor,'OPERATIONS','INTERVIEW',row.interview,'RETRY_OUTBOX');return {id,queued:true};
  }
  async users(actor:Identity,url:URL){await this.authorize(actor,'DASHBOARD');const {limit,offset}=page(url),query=bounded(url.searchParams.get('q')||'*',80);
    const rows=(await this.db.prepare(`SELECT subject,eligible,restricted,closed_at,visibility,indexing,
      (SELECT count(*) FROM enforcement_actions e WHERE e.target_kind='USER' AND e.target_ref=u.subject AND e.revoked_at IS NULL
      AND e.starts_at<=? AND (e.expires_at IS NULL OR e.expires_at>?)) active_actions
      FROM jobs_users u WHERE (?='*' OR subject LIKE ? ESCAPE '\') ORDER BY subject LIMIT ? OFFSET ?`).bind(this.clock(),this.clock(),query,'%'+query.replace(/[\\%_]/g,'\\$&')+'%',limit,offset).all()).results;
    await this.audit(actor,'ACCOUNT_ADMIN','USER_DIRECTORY','BILLIONJOBS','LIST');return {rows,limit,offset,scope:'BILLIONJOBS',sharedAccountStatus:'outside_jobs_scope'};
  }
  async operationalAnalytics(actor:Identity,days:number){await this.authorize(actor,'DASHBOARD');if(!Number.isSafeInteger(days)||days<1||days>90)throw new JobsError(400,'invalid_period');
    const end=this.clock(),start=end-days*86400000;
    const counts=await this.db.prepare(`SELECT
      (SELECT count(*) FROM moderation_cases WHERE created_at>=? AND created_at<?) reported,
      (SELECT count(*) FROM moderation_cases WHERE status IN ('RESOLVED','CLOSED') AND updated_at>=? AND updated_at<?) resolved,
      (SELECT count(*) FROM enforcement_appeals WHERE created_at>=? AND created_at<?) appeals,
      (SELECT count(*) FROM enforcement_appeals WHERE status='OVERTURNED' AND updated_at>=? AND updated_at<?) overturned,
      (SELECT count(*) FROM fraud_signals WHERE created_at>=? AND created_at<?) signals,
      (SELECT count(*) FROM privacy_requests WHERE requested_at>=? AND requested_at<?) privacy_requests,
      (SELECT count(*) FROM admin_audit WHERE product='BILLIONJOBS' AND at>=? AND at<?) admin_events`)
      .bind(start,end,start,end,start,end,start,end,start,end,start,end,start,end).first<Record<string,number>>();
    await this.audit(actor,'ANALYTICS','BILLIONJOBS','OPERATIONS','READ');
    const safe=Object.fromEntries(Object.entries(counts||{}).map(([key,value])=>[key,value<5?null:value]));
    return {period:{start,end,days},counts:safe,suppression:'Counts below 5 are hidden.',denominators:{reported:'cases created in period',resolved:'cases resolved in period',appeals:'appeals created in period',overturned:'appeals overturned in period',signals:'signals created in period',privacy_requests:'requests created in period',admin_events:'audit events created in period'}};
  }
  async companies(actor:Identity,url:URL){await this.authorize(actor,'DASHBOARD');const {limit,offset}=page(url),query=bounded(url.searchParams.get('q')||'*',80);
    const rows=(await this.db.prepare(`SELECT c.id,json_extract(c.data,'$.name') name,c.owner,c.restricted,c.revision,
      COALESCE(v.state,'UNVERIFIED') employer_verification FROM companies c LEFT JOIN employer_verifications v ON v.company=c.id
      WHERE (?='*' OR json_extract(c.data,'$.name') LIKE ? ESCAPE '\') ORDER BY c.created_at DESC,c.id LIMIT ? OFFSET ?`).bind(query,'%'+query.replace(/[\\%_]/g,'\\$&')+'%',limit,offset).all()).results;
    await this.audit(actor,'EMPLOYER_ADMIN','COMPANY_DIRECTORY','BILLIONJOBS','LIST');return {rows,limit,offset,registration:'email_verified_free',employerVerification:'optional'};
  }
  async reviewEmployerVerification(actor:Identity,companyId:string,state:'IN_REVIEW'|'VERIFIED'|'REJECTED'|'EXPIRED',evidenceRef:string,revision:number){
    await this.authorize(actor,'CASE_DECIDE',true);identifier(companyId);if(!['IN_REVIEW','VERIFIED','REJECTED','EXPIRED'].includes(state))throw new JobsError(400,'invalid_verification');
    const evidence=bounded(evidenceRef,200);if(!/^[A-Za-z0-9_:/.-]+$/.test(evidence))throw new JobsError(400,'invalid_evidence_ref');
    const existing=await this.db.prepare('SELECT revision FROM employer_verifications WHERE company=?').bind(companyId).first<{revision:number}>();
    if((existing?.revision||0)!==revision)throw new JobsError(409,'verification_conflict');
    if(existing)await this.db.prepare('UPDATE employer_verifications SET state=?,evidence_ref=?,reviewer=?,reviewed_at=?,revision=revision+1 WHERE company=? AND revision=?').bind(state,evidence,actor.subject,this.clock(),companyId,revision).run();
    else await this.db.prepare('INSERT INTO employer_verifications(company,state,evidence_ref,reviewer,reviewed_at) VALUES(?,?,?,?,?)').bind(companyId,state,evidence,actor.subject,this.clock()).run();
    await this.audit(actor,'EMPLOYER_VERIFICATION','COMPANY',companyId,state,'SUCCESS',revision+1);return {company:companyId,state,revision:revision+1};
  }
  async purgeModerationEvidence(actor:Identity){await this.authorize(actor,'PRIVACY_REVIEW',true);
    const configured=await this.db.prepare("SELECT value FROM jobs_policy_versions WHERE key='retention_moderation_days'").first<{value:string}>();
    const days=configured?Number(JSON.parse(configured.value)):90,cutoff=this.clock()-days*86400000;
    const result=await this.db.prepare(`UPDATE moderation_events SET internal_note=NULL,evidence_ref=NULL WHERE case_id IN (
      SELECT c.id FROM moderation_cases c WHERE c.status='CLOSED' AND c.updated_at<=?
      AND NOT EXISTS(SELECT 1 FROM legal_holds h WHERE h.released_at IS NULL AND (h.subject=c.reporter OR h.subject=c.target_ref)))
      AND (internal_note IS NOT NULL OR evidence_ref IS NOT NULL) RETURNING id`).bind(cutoff).all();
    await this.audit(actor,'RETENTION','MODERATION_EVIDENCE','BILLIONJOBS','PURGE');return {redacted:result.results.length};
  }
}
