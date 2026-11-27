import { identifier, JobsError, type Identity, type JobsDatabase } from './contracts';
import { requireCompany, requireEligible } from './permissions';
import { executeGovernanceExtension } from './intelligence';
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
const policyBounds:Record<string,[number,number]>= {listing_daily_limit:[1,10],listing_active_limit:[1,30],listing_validity_days:[1,30],moderation_daily_signal_threshold:[2,100],complaint_response_target_days:[1,30],incident_reporting_hours:[1,168],incident_escalation_hours:[1,72],retention_moderation_days:[30,365],retention_application_days:[180,3650]};
const fresh=(at:number|undefined,now:number,window:number)=>typeof at==='number'&&at<=now&&now-at<=window;
function bounded(value:unknown,max=1000):string {if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new JobsError(400,'invalid_input');return value.trim();}
function finiteRevision(value:unknown):number {if(!Number.isSafeInteger(value)||Number(value)<1)throw new JobsError(400,'invalid_revision');return Number(value);}
function page(url:URL){const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit')||25)));const offset=Math.max(0,Number(url.searchParams.get('offset')||0));if(!Number.isSafeInteger(limit)||!Number.isSafeInteger(offset)||offset>100000)throw new JobsError(400,'invalid_page');return {limit,offset};}

export function detectCompanySignals(companyId:string,listings:{id:string;data:string}[],counts:{postings:number;complaints:number;recruitment:number;interviews:number},postingThreshold:number){
    const indicators:{rule:string;target:string;severity:string}[]=[];
    if(counts.postings>=postingThreshold)indicators.push({rule:'POSTING_FREQUENCY',target:companyId,severity:'MEDIUM'});
    if(counts.complaints>=3)indicators.push({rule:'REPEATED_COMPLAINTS',target:companyId,severity:'HIGH'});
    if(counts.recruitment>=50)indicators.push({rule:'RECRUITER_ACTIVITY_VOLUME',target:companyId,severity:'MEDIUM'});
    if(counts.interviews>=30)indicators.push({rule:'INTERVIEW_WORKFLOW_VOLUME',target:companyId,severity:'MEDIUM'});
    const fingerprints=new Map<string,number>();
    for(const listing of listings){
      let data:Record<string,unknown>;try{data=JSON.parse(listing.data) as Record<string,unknown>;}catch{continue;}
      const content=JSON.stringify(data).slice(0,16000).toLowerCase();
      if(/(?:registration|processing|training|security)\s+fee|pay\s+(?:us|a\s+fee)|refundable\s+(?:deposit|fee)/i.test(content))indicators.push({rule:'POTENTIAL_RECRUITMENT_FEE',target:companyId+'/'+listing.id,severity:'HIGH'});
      if(/(?:guaranteed|assured)\s+(?:job|placement)|(?:official|verified)\s+(?:government|employer)/i.test(content))indicators.push({rule:'MISLEADING_CLAIM',target:companyId+'/'+listing.id,severity:'MEDIUM'});
      const fingerprint=String(data.title||'').trim().toLowerCase()+'|'+String(data.location||'').trim().toLowerCase();
      if(fingerprint!=='|'){fingerprints.set(fingerprint,(fingerprints.get(fingerprint)||0)+1);if(fingerprints.get(fingerprint)===3)indicators.push({rule:'REPEATED_DUPLICATE',target:companyId,severity:'MEDIUM'});}
    }
    return {indicators,fingerprints};
}

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
    const allowed = new Set(grants.flatMap(grant => permissions[grant.role] || []));
    if (!allowed.has(permission)) throw new JobsError(403,'admin_forbidden');
    return allowed;
  }
  async dashboard(actor:Identity){
    const allowed = await this.authorize(actor,'DASHBOARD');
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
      (SELECT count(*) FROM security_incidents WHERE status<>'RESOLVED' AND review_due_at IS NOT NULL AND review_due_at<?) overdue_incident_reviews,
      (SELECT count(*) FROM legal_holds WHERE released_at IS NULL AND review_at<?) overdue_hold_reviews,
      (SELECT count(*) FROM interview_meeting_outbox WHERE status IN ('PENDING','FAILED')) operational_failures,
      (SELECT count(*) FROM fraud_signals WHERE status='OPEN') fraud_signals`).bind(this.clock(),this.clock(),this.clock()).first();
    const required:Record<string,AdminPermission> = {
      users:'DASHBOARD', companies:'DASHBOARD', recruiters:'DASHBOARD', active_jobs:'DASHBOARD',
      restricted_users:'ENFORCE', pending_cases:'CASE_READ', pending_appeals:'APPEAL_REVIEW',
      privacy_requests:'PRIVACY_REVIEW', overdue_hold_reviews:'PRIVACY_REVIEW',
      incidents:'INCIDENT', overdue_incident_reviews:'INCIDENT', operational_failures:'INCIDENT', fraud_signals:'CASE_DECIDE'
    };
    const visible = Object.fromEntries(Object.entries(counts || {}).filter(([key]) => allowed.has(required[key])));
    await this.audit(actor,'OPERATIONS','DASHBOARD','BILLIONJOBS','READ');
    return {asOf:this.clock(),counts:visible};
  }
  async cases(actor:Identity,url:URL){await this.authorize(actor,'CASE_READ');const {limit,offset}=page(url);const status=url.searchParams.get('status')||'';
    if(status&&!['OPEN','ASSIGNED','WAITING','RESOLVED','CLOSED'].includes(status))throw new JobsError(400,'invalid_status');
    const target=await this.db.prepare("SELECT value FROM effective_jobs_policies WHERE key='complaint_response_target_days'").first<{value:string}>();
    const days=target?Number(JSON.parse(target.value)):null,onlyOverdue=url.searchParams.get('overdue')==='1';
    const rows=(await this.db.prepare(`SELECT *,CASE WHEN status NOT IN ('RESOLVED','CLOSED') AND due_at<? THEN 1 ELSE 0 END overdue FROM
      (SELECT id,kind,target_ref,category,severity,status,assignee,created_at,updated_at,revision,created_at+?*86400000 due_at FROM moderation_cases)
      WHERE (?='' OR status=?) AND (?=0 OR (status NOT IN ('RESOLVED','CLOSED') AND due_at<?)) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`)
      .bind(this.clock(),days,status,status,Number(onlyOverdue),this.clock(),limit,offset).all()).results;
    await this.audit(actor,'MODERATION','CASE_QUEUE','BILLIONJOBS','LIST');return {rows,limit,offset};
  }
  async caseDetail(actor:Identity,id:string){
    const allowed=await this.authorize(actor,'CASE_READ');identifier(id);
    const investigate=allowed.has('CASE_DECIDE');
    const record=await this.db.prepare(`SELECT id,kind,target_ref,category,severity,status,assignee,revision,created_at,updated_at
      ${investigate?',reporter':''} FROM moderation_cases WHERE id=?`).bind(id).first();
    if(!record)throw new JobsError(404,'case_not_found');
    const history=(await this.db.prepare(`SELECT action,public_status,at ${investigate?',actor,internal_note,evidence_ref':''}
      FROM moderation_events WHERE case_id=? ${investigate?'':'AND public_status IS NOT NULL'} ORDER BY at,id LIMIT 200`).bind(id).all()).results;
    const enforce=allowed.has('ENFORCE');
    const actions=enforce?(await this.db.prepare("SELECT id,kind,reason_code,revoked_at,expires_at,revision FROM enforcement_actions WHERE case_id=? AND target_kind='LISTING' ORDER BY starts_at DESC,id LIMIT 100").bind(id).all()).results:[];
    await this.audit(actor,'MODERATION','CASE',id,'READ');return {record,history,investigate,enforce,actions};
  }
  async assistCase(actor:Identity,id:string){
    await this.authorize(actor,'CASE_DECIDE');identifier(id);
    const record=await this.db.prepare('SELECT severity FROM moderation_cases WHERE id=?').bind(id).first<{severity:string}>();
    if(!record)throw new JobsError(404,'case_not_found');
    const result=await executeGovernanceExtension({purpose:'MODERATION_ASSISTANCE',authorized:true,caseRef:id,data:{severity:record.severity}});
    await this.db.prepare("INSERT INTO admin_audit VALUES(?,?,'BILLIONJOBS','ASSISTANCE','CASE',?,'LOCAL_MANUAL_REVIEW','SUCCESS',NULL,?)")
      .bind(result.audit.requestId,actor.subject,id,this.clock()).run();
    return {caseId:id,auditRef:result.audit.requestId,humanReviewRequired:true,automaticDecision:false,instruction:'Review the recorded evidence and applicable policy before making a decision.'};
  }
  async addCaseEvidence(actor:Identity,id:string,evidenceRef:string,note:string){await this.authorize(actor,'CASE_DECIDE');identifier(id);
    const ref=bounded(evidenceRef,200);if(!/^[A-Za-z0-9_:/.-]+$/.test(ref))throw new JobsError(400,'invalid_evidence_ref');
    const event=crypto.randomUUID(),now=this.clock();
    await this.db.batch([
      this.db.prepare(`INSERT INTO moderation_events SELECT ?,id,?,'EVIDENCE',NULL,?,?,? FROM moderation_cases
        WHERE id=? AND status NOT IN ('RESOLVED','CLOSED')`).bind(event,actor.subject,bounded(note,2000),ref,now,id),
      this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','MODERATION','CASE',?,'ADD_EVIDENCE','SUCCESS',NULL,? WHERE changes()=1`)
        .bind(crypto.randomUUID(),actor.subject,id,now)
    ]);
    if(!await this.db.prepare('SELECT id FROM moderation_events WHERE id=?').bind(event).first())throw new JobsError(409,'case_closed');
    return {id,evidenceRef:ref};
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
  async reportedCases(actor:Identity,url:URL){
    const {limit,offset}=page(url);
    const rows=(await this.db.prepare('SELECT id,kind,category,status,created_at,updated_at FROM moderation_cases WHERE reporter=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?')
      .bind(actor.subject,limit,offset).all()).results;
    return {rows,limit,offset};
  }
  async ownCase(actor:Identity,id:string){const row=await this.db.prepare('SELECT id,kind,category,status,created_at,updated_at FROM moderation_cases WHERE id=? AND reporter=?').bind(identifier(id),actor.subject).first();if(!row)throw new JobsError(404,'case_not_found');return row;}
  async companyCaseStatus(actor:Identity,companyId:string,caseId:string){
    identifier(companyId);identifier(caseId);const company=await this.db.prepare('SELECT owner FROM companies WHERE id=?').bind(companyId).first<{owner:string}>();
    if(!company)throw new JobsError(404,'case_not_found');
    const member=await this.db.prepare("SELECT subject FROM memberships WHERE company=? AND subject=? AND role='COMPANY_ADMIN' AND revoked_at IS NULL").bind(companyId,actor.subject).first();
    if(company.owner!==actor.subject&&!member)throw new JobsError(404,'case_not_found');
    const row=await this.db.prepare("SELECT id,kind,category,status,created_at,updated_at FROM moderation_cases WHERE id=? AND (target_ref=? OR target_ref LIKE ? ESCAPE '\\')")
      .bind(caseId,companyId,companyId.replace(/[\\%_]/g,'\\$&')+'/%').first();
    if(!row)throw new JobsError(404,'case_not_found');return row;
  }
  async decideCase(actor:Identity,id:string,input:{revision:number;status:'ASSIGNED'|'WAITING'|'RESOLVED'|'CLOSED';note:string;assignee?:string;category?:string;severity?:string}){
    await this.authorize(actor,'CASE_DECIDE');identifier(id);
    if(!input||!['ASSIGNED','WAITING','RESOLVED','CLOSED'].includes(input.status))throw new JobsError(400,'invalid_status');
    const revision=finiteRevision(input.revision),note=bounded(input.note,2000),now=this.clock();
    const assignee=identifier(input.assignee??actor.subject),category=input.category===undefined?null:bounded(input.category,80);
    if(input.severity!==undefined&&!['LOW','MEDIUM','HIGH','CRITICAL'].includes(input.severity))throw new JobsError(400,'invalid_severity');
    const reviewers=Object.entries(permissions).filter(([,value])=>value.includes('CASE_DECIDE')).map(([role])=>role);
    const event=crypto.randomUUID();
    await this.db.batch([
      this.db.prepare(`UPDATE moderation_cases SET status=?,assignee=?,category=COALESCE(?,category),severity=COALESCE(?,severity),
        updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND status NOT IN ('CLOSED','RESOLVED')
        AND EXISTS(SELECT 1 FROM admin_grants g JOIN jobs_users u ON u.subject=g.subject WHERE g.subject=?
          AND g.product='BILLIONJOBS' AND g.revoked_at IS NULL AND u.closed_at IS NULL AND u.eligible=1 AND u.restricted=0
          AND g.role IN (SELECT value FROM json_each(?)))`)
        .bind(input.status,assignee,category,input.severity??null,now,id,revision,assignee,JSON.stringify(reviewers)),
      this.db.prepare(`INSERT INTO moderation_events SELECT ?,?,?,'STATUS',?,?,NULL,? WHERE changes()=1`)
        .bind(event,id,actor.subject,input.status,note,now),
      this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','MODERATION','CASE',?,'DECIDE','SUCCESS',?,? WHERE changes()=1`)
        .bind(crypto.randomUUID(),actor.subject,id,revision+1,now)
    ]);
    if(!await this.db.prepare('SELECT id FROM moderation_events WHERE id=?').bind(event).first())throw new JobsError(409,'case_conflict');
    return {id,status:input.status,revision:revision+1};
  }
  async enforce(actor:Identity,input:{caseId:string;targetKind:'USER'|'COMPANY'|'LISTING'|'RECRUITER';targetRef:string;kind:string;reasonCode:string;expiresAt?:number;evidenceRef?:string}){
    await this.authorize(actor,'ENFORCE',true);const caseId=identifier(input.caseId),targetRef=input.targetKind==='LISTING'?bounded(input.targetRef,161):identifier(input.targetRef),reason=bounded(input.reasonCode,80);
    if(!['WARNING','FEATURE','POSTING','RECRUITER','JOBS_TEMP','JOBS_PERMANENT','EMERGENCY','REMOVE_DISCOVERY'].includes(input.kind)||!['USER','COMPANY','LISTING','RECRUITER'].includes(input.targetKind))throw new JobsError(400,'invalid_action');
    if(input.targetKind==='LISTING'&&!/^[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}$/.test(targetRef))throw new JobsError(400,'invalid_listing_target');
    if(input.kind==='REMOVE_DISCOVERY'&&input.targetKind!=='LISTING'||input.kind.startsWith('JOBS_')&&input.targetKind!=='USER'||input.kind==='POSTING'&&!['USER','COMPANY'].includes(input.targetKind))throw new JobsError(400,'invalid_action_target');
    const moderationCase=await this.db.prepare('SELECT target_ref FROM moderation_cases WHERE id=?').bind(caseId).first<{target_ref:string}>();
    if(!moderationCase||moderationCase.target_ref!==targetRef)throw new JobsError(409,'case_target_mismatch');
    if(input.expiresAt!==undefined&&(!Number.isSafeInteger(input.expiresAt)||input.expiresAt<=this.clock()))throw new JobsError(400,'invalid_expiry');
    const id=crypto.randomUUID(),now=this.clock(),expiry=input.expiresAt??null;
    const ref=input.evidenceRef===undefined?null:bounded(input.evidenceRef,200);
    const same="case_id=? AND target_kind=? AND target_ref=? AND kind=? AND reason_code=? AND expires_at IS ? AND evidence_ref IS ? AND revoked_at IS NULL";
    const key=[caseId,input.targetKind,targetRef,input.kind,reason,expiry,ref];
    await this.db.batch([
      this.db.prepare(`INSERT INTO enforcement_actions(id,case_id,target_kind,target_ref,kind,reason_code,actor,evidence_ref,starts_at,expires_at)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM enforcement_actions WHERE ${same})`)
        .bind(id,caseId,input.targetKind,targetRef,input.kind,reason,actor.subject,ref,now,expiry,...key),
      this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','ENFORCEMENT',?,?,?,'SUCCESS',1,? WHERE changes()=1`)
        .bind(crypto.randomUUID(),actor.subject,input.targetKind,targetRef,input.kind,now)
    ]);
    const action=await this.db.prepare(`SELECT id FROM enforcement_actions WHERE ${same} ORDER BY starts_at DESC,id LIMIT 1`).bind(...key).first<{id:string}>();
    if(!action)throw new JobsError(409,'action_conflict');
    return action;
  }
  async moderateListing(actor:Identity,id:string,input:unknown){
    await this.authorize(actor,'ENFORCE',true);
    const body=input as {kind:string;reasonCode:string;expiresAt?:number};
    if(!body||!['REMOVE_DISCOVERY','FEATURE'].includes(body.kind))throw new JobsError(400,'invalid_action');
    const row=await this.db.prepare(`SELECT target_ref FROM moderation_cases c WHERE id=? AND kind='JOB' AND EXISTS(
      SELECT 1 FROM listings l WHERE c.target_ref=l.company||'/'||l.id)`).bind(identifier(id)).first<{target_ref:string}>();
    if(!row)throw new JobsError(409,'case_target_mismatch');
    return this.enforce(actor,{caseId:id,targetKind:'LISTING',targetRef:row.target_ref,kind:body.kind,reasonCode:body.reasonCode,expiresAt:body.expiresAt});
  }
  async userReview(actor:Identity,subject:string){
    await this.authorize(actor,'ENFORCE');identifier(subject);
    const user=await this.db.prepare('SELECT subject,eligible,closed_at,restricted FROM jobs_users WHERE subject=?').bind(subject).first();
    if(!user)throw new JobsError(404,'subject_not_found');
    const cases=(await this.db.prepare("SELECT id,category,status FROM moderation_cases WHERE target_ref=? AND kind IN ('CANDIDATE','RECRUITER','HARASSMENT','SCAM') ORDER BY updated_at DESC,id LIMIT 100").bind(subject).all()).results;
    const actions=(await this.db.prepare("SELECT id,case_id,kind,reason_code,expires_at,revoked_at,revision FROM enforcement_actions WHERE target_kind='USER' AND target_ref=? ORDER BY starts_at DESC,id LIMIT 100").bind(subject).all()).results;
    await this.audit(actor,'ACCOUNT_ADMIN','USER',subject,'REVIEW');
    const canClose=!!await this.db.prepare("SELECT 1 FROM admin_grants WHERE subject=? AND product='BILLIONJOBS' AND revoked_at IS NULL AND role IN ('PLATFORM_OWNER','PRODUCT_ADMIN')").bind(actor.subject).first();
    return {user,cases,actions,canClose};
  }
  async closeReviewedAccount(actor:Identity,subject:string,caseId:string){
    await this.authorize(actor,'ENFORCE',true);
    identifier(subject);identifier(caseId);
    if(subject===actor.subject)throw new JobsError(403,'self_closure_forbidden');
    const event=crypto.randomUUID(),now=this.clock();
    const guard='EXISTS(SELECT 1 FROM admin_audit WHERE id=?)';
    await this.db.batch([
      this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','ACCOUNT_ADMIN','CASE',?,'CLOSE_JOBS_ACCOUNT','SUCCESS',c.revision,?
        FROM moderation_cases c JOIN jobs_users u ON u.subject=c.target_ref
        WHERE c.id=? AND u.subject=? AND u.closed_at IS NULL AND c.status IN ('RESOLVED','CLOSED')
        AND c.kind IN ('CANDIDATE','RECRUITER','HARASSMENT','SCAM')
        AND NOT EXISTS(SELECT 1 FROM legal_holds WHERE subject=u.subject AND released_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM admin_grants WHERE subject=u.subject AND product='BILLIONJOBS' AND revoked_at IS NULL)
        AND EXISTS(SELECT 1 FROM admin_grants WHERE subject=? AND product='BILLIONJOBS'
          AND role IN ('PLATFORM_OWNER','PRODUCT_ADMIN') AND revoked_at IS NULL)`)
        .bind(event,actor.subject,caseId,now,caseId,subject,actor.subject),
      this.db.prepare(`UPDATE jobs_users SET closed_at=?,visibility='PRIVATE',indexing=0 WHERE subject=? AND ${guard}`).bind(now,subject,event),
      this.db.prepare(`UPDATE memberships SET revoked_at=COALESCE(revoked_at,?) WHERE subject=? AND ${guard}`).bind(now,subject,event),
      this.db.prepare(`UPDATE retained_records SET restricted=1 WHERE subject=? AND ${guard}`).bind(subject,event),
      this.db.prepare(`INSERT INTO privacy_audit(actor,action,at) SELECT ?,'JOBS_CLOSED',? WHERE ${guard}`).bind(subject,now,event)
    ]);
    if(!await this.db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(event).first())throw new JobsError(409,'closure_not_available');
    return {subject,closed:true};
  }
  async accountAction(actor:Identity,subject:string,input:unknown){
    await this.authorize(actor,'ENFORCE',true);identifier(subject);
    const cmd=input as {caseId:string;kind:string;reasonCode:string;expiresAt?:number};
    if(!cmd||typeof cmd!=='object'||!['WARNING','POSTING','JOBS_TEMP','JOBS_PERMANENT','EMERGENCY'].includes(cmd.kind))throw new JobsError(400,'invalid_action');
    if(cmd.kind==='JOBS_TEMP'&&!cmd.expiresAt || cmd.kind==='JOBS_PERMANENT'&&cmd.expiresAt!==undefined)throw new JobsError(400,'invalid_expiry');
    const target=await this.db.prepare(`SELECT u.subject FROM jobs_users u JOIN moderation_cases c ON c.target_ref=u.subject WHERE u.subject=? AND u.closed_at IS NULL
      AND c.id=? AND c.kind IN ('CANDIDATE','RECRUITER','HARASSMENT','SCAM')`).bind(subject,identifier(cmd.caseId)).first();
    if(!target)throw new JobsError(409,'case_target_mismatch');
    return this.enforce(actor,{caseId:cmd.caseId,kind:cmd.kind,reasonCode:cmd.reasonCode,expiresAt:cmd.expiresAt,targetKind:'USER',targetRef:subject});
  }
  async activeRestrictions(targetKind:string,targetRef:string){const rows=(await this.db.prepare('SELECT id,kind,reason_code,expires_at FROM enforcement_actions WHERE target_kind=? AND target_ref=? AND revoked_at IS NULL AND starts_at<=? AND (expires_at IS NULL OR expires_at>?)').bind(targetKind,targetRef,this.clock(),this.clock()).all()).results;return rows;}
  async revokeEnforcement(actor:Identity,id:string,revision:number,reason:string){await this.authorize(actor,'ENFORCE',true);identifier(id);
    const reasonCode=bounded(reason,80);
    const previous=finiteRevision(revision),now=this.clock(),audit=crypto.randomUUID();
    await this.db.batch([
      this.db.prepare('UPDATE enforcement_actions SET revoked_at=?,revision=revision+1 WHERE id=? AND revision=? AND revoked_at IS NULL').bind(now,id,previous),
      this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','ENFORCEMENT',target_kind,target_ref,?,'SUCCESS',revision,?
        FROM enforcement_actions WHERE id=? AND changes()=1`).bind(audit,actor.subject,'REVOKE_'+reasonCode,now,id)
    ]);
    const action=await this.db.prepare('SELECT target_type,target_ref,revision FROM admin_audit WHERE id=?').bind(audit).first<{target_type:string;target_ref:string;revision:number}>();
    if(!action)throw new JobsError(409,'action_conflict');
    return {id,revision:action.revision,remaining:await this.activeRestrictions(action.target_type,action.target_ref)};
  }
  async appeal(actor:Identity,actionId:string,reason:string){identifier(actionId);const enrolled=await this.db.prepare('SELECT subject FROM jobs_users WHERE subject=? AND eligible=1 AND closed_at IS NULL').bind(actor.subject).first();if(!enrolled)throw new JobsError(403,'jobs_ineligible');const action=await this.db.prepare('SELECT target_kind,target_ref FROM enforcement_actions WHERE id=?').bind(actionId).first<{target_kind:string;target_ref:string}>();if(!action)throw new JobsError(404,'action_not_found');
    let allowed=['USER','RECRUITER'].includes(action.target_kind)&&action.target_ref===actor.subject;
    if(action.target_kind==='COMPANY'||action.target_kind==='LISTING'){
      const companyId=action.target_kind==='COMPANY'?action.target_ref:action.target_ref.split('/')[0];
      const company=await this.db.prepare('SELECT owner FROM companies WHERE id=?').bind(companyId).first<{owner:string}>();allowed=company?.owner===actor.subject;
    }
    if(!allowed)throw new JobsError(404,'action_not_found');
    const id=crypto.randomUUID(),now=this.clock();try{await this.db.prepare("INSERT INTO enforcement_appeals VALUES(?,?,?,'SUBMITTED',NULL,?,NULL,?,?,1)").bind(id,actionId,actor.subject,bounded(reason,2000),now,now).run();}catch{throw new JobsError(409,'appeal_pending');}return {id,status:'SUBMITTED'};}
  async appeals(actor:Identity,admin:boolean,url:URL){
    if(admin)await this.authorize(actor,'APPEAL_REVIEW');
    const {limit,offset}=page(url);
    const rows=(await this.db.prepare(`SELECT id,status,revision,created_at,updated_at FROM enforcement_appeals
      WHERE (?=1 OR appellant=?) ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`).bind(Number(admin),actor.subject,limit,offset).all()).results;
    if(admin)await this.audit(actor,'APPEAL','QUEUE','BILLIONJOBS','LIST');
    const decisions=admin?[]:(await this.db.prepare(`SELECT e.id,e.kind,e.reason_code,e.expires_at FROM enforcement_actions e
      WHERE e.revoked_at IS NULL AND ((e.target_kind IN ('USER','RECRUITER') AND e.target_ref=?) OR EXISTS(
      SELECT 1 FROM companies c WHERE c.owner=? AND ((e.target_kind='COMPANY' AND c.id=e.target_ref)
      OR (e.target_kind='LISTING' AND c.id=substr(e.target_ref,1,instr(e.target_ref,'/')-1)))))
      ORDER BY e.starts_at DESC,e.id LIMIT ? OFFSET ?`).bind(actor.subject,actor.subject,limit,offset).all()).results;
    return {rows,decisions,limit,offset};
  }
  async appealReview(actor:Identity,id:string,admin:boolean){
    if(admin)await this.authorize(actor,'APPEAL_REVIEW');
    const record=await this.db.prepare(`SELECT id,status,reason,revision,created_at,updated_at ${admin?',reviewer,appellant,action_id':''}
      FROM enforcement_appeals WHERE id=? AND (?=1 OR appellant=?)`).bind(identifier(id),Number(admin),actor.subject).first();
    if(!record)throw new JobsError(404,'appeal_not_found');
    const history=(await this.db.prepare(`SELECT revision,status,message,recorded_at ${admin?',actor':''}
      FROM appeal_history WHERE appeal=? ORDER BY revision`).bind(id).all()).results;
    if(admin)await this.audit(actor,'APPEAL','APPEAL',id,'READ');
    return {record,history};
  }
  async progressAppeal(actor:Identity,id:string,admin:boolean,input:unknown){
    const cmd=input as {revision:number;status:string;message:string};
    if(!cmd||typeof cmd!=='object')throw new JobsError(400,'invalid_input');
    const revision=finiteRevision(cmd.revision),note=bounded(cmd.message,1000);
    if(admin){
      await this.authorize(actor,'APPEAL_REVIEW',true);
      if(cmd.status==='UPHELD'||cmd.status==='OVERTURNED')return this.resolveAppeal(actor,id,revision,cmd.status==='OVERTURNED',note);
      if(!['ACKNOWLEDGED','REVIEWING','MORE_INFO'].includes(cmd.status))throw new JobsError(400,'invalid_status');
    }else if(cmd.status!=='ACKNOWLEDGED')throw new JobsError(400,'invalid_status');
    const event=crypto.randomUUID(),now=this.clock();
    const update=admin?this.db.prepare(`UPDATE enforcement_appeals SET reviewer=?,status=?,decision_note=?,updated_at=?,revision=revision+1
      WHERE id=? AND revision=? AND appellant<>? AND (reviewer IS NULL OR reviewer=?) AND
      EXISTS(SELECT 1 FROM enforcement_actions WHERE id=enforcement_appeals.action_id AND actor<>?)
      AND ((status='SUBMITTED' AND ?='ACKNOWLEDGED') OR (status='ACKNOWLEDGED' AND ?='REVIEWING')
       OR (status IN ('ACKNOWLEDGED','REVIEWING') AND ?='MORE_INFO'))`)
      .bind(actor.subject,cmd.status,note,now,identifier(id),revision,actor.subject,actor.subject,actor.subject,cmd.status,cmd.status,cmd.status):
      this.db.prepare(`UPDATE enforcement_appeals SET status='ACKNOWLEDGED',decision_note=?,updated_at=?,revision=revision+1
        WHERE id=? AND revision=? AND appellant=? AND status='MORE_INFO'`).bind(note,now,identifier(id),revision,actor.subject);
    await this.db.batch([update,this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','APPEAL','APPEAL',?,?,'SUCCESS',?,? WHERE changes()=1`)
      .bind(event,actor.subject,id,admin?cmd.status:'PROVIDE_INFO',revision+1,now)]);
    if(!await this.db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(event).first())throw new JobsError(409,'appeal_conflict');
    return {id,status:cmd.status,revision:revision+1};
  }
  async resolveAppeal(actor:Identity,id:string,revision:number,overturn:boolean,note:string){await this.authorize(actor,'APPEAL_REVIEW',true);identifier(id);const now=this.clock();
    if(typeof overturn!=='boolean')throw new JobsError(400,'invalid_decision');
    const appeal=await this.db.prepare(`SELECT a.action_id,a.appellant,a.reviewer,e.actor original_actor
      FROM enforcement_appeals a JOIN enforcement_actions e ON e.id=a.action_id WHERE a.id=? AND a.revision=?
      AND a.status NOT IN ('UPHELD','OVERTURNED')`).bind(id,finiteRevision(revision)).first<{action_id:string;appellant:string;reviewer:string|null;original_actor:string}>();
    if(!appeal)throw new JobsError(409,'appeal_conflict');
    if([appeal.original_actor,appeal.appellant].includes(actor.subject)||appeal.reviewer&&appeal.reviewer!==actor.subject)throw new JobsError(403,'independent_reviewer_required');
    const status=overturn?'OVERTURNED':'UPHELD',auditId=crypto.randomUUID();
    const decision=this.db.prepare(`UPDATE enforcement_appeals SET status=?,reviewer=?,decision_note=?,updated_at=?,revision=revision+1
      WHERE id=? AND revision=? AND status NOT IN ('UPHELD','OVERTURNED')`).bind(status,actor.subject,bounded(note,2000),now,id,revision);
    const audit=this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','APPEAL','APPEAL',?,?,'SUCCESS',?,? WHERE changes()=1`)
      .bind(auditId,actor.subject,id,status,revision+1,now);
    const commands=[decision,audit];
    if(overturn)commands.push(this.db.prepare(`UPDATE enforcement_actions SET revoked_at=?,revision=revision+1 WHERE id=? AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM admin_audit WHERE id=?)`).bind(now,appeal.action_id,auditId));
    await this.db.batch(commands);
    if(!await this.db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(auditId).first())throw new JobsError(409,'appeal_conflict');
    return {id,status};
  }
  async auditPage(actor:Identity,url:URL){
    await this.authorize(actor,'AUDIT_READ');const {limit,offset}=page(url);
    const conditions=["product='BILLIONJOBS'"],bindings:(string|number)[]=[];
    for(const field of ['actor','action','target_ref','purpose']){
      const value=url.searchParams.get(field);
      if(value){conditions.push(field+'=?');bindings.push(bounded(value,161))}
    }
    for(const [key,operator] of [['from','>='],['until','<']]){
      const raw=url.searchParams.get(key);
      if(raw!==null){const value=Number(raw);if(!Number.isSafeInteger(value)||value<0)throw new JobsError(400,'invalid_period');
        conditions.push('at'+operator+'?');bindings.push(value)}
    }
    const rows=(await this.db.prepare(`SELECT id,actor,product,purpose,target_type,target_ref,action,outcome,revision,at
      FROM admin_audit WHERE ${conditions.join(' AND ')} ORDER BY at DESC,id DESC LIMIT ? OFFSET ?`).bind(...bindings,limit,offset).all()).results;
    await this.audit(actor,'AUDIT','AUDIT_TRAIL','BILLIONJOBS','LIST');return {rows,limit,offset};
  }

  async ownershipWorkspace(actor:Identity,url:URL){
    await requireEligible(this.db,actor);
    const {limit,offset}=page(url);
    const companies=(await this.db.prepare(`SELECT id,json_extract(data,'$.name') name,revision FROM companies WHERE owner=?
      AND NOT EXISTS(SELECT 1 FROM company_retirements WHERE company=companies.id) ORDER BY id LIMIT ? OFFSET ?`).bind(actor.subject,limit,offset).all()).results;
    const requests=(await this.db.prepare(`SELECT id,company,from_subject,to_subject,expires_at,accepted_at,cancelled_at,
      CASE WHEN from_subject=? THEN 'SENT' ELSE 'RECEIVED' END direction FROM ownership_transfers WHERE from_subject=? OR
      (to_subject=? AND recipient_hash=?) ORDER BY requested_at DESC,id LIMIT ? OFFSET ?`)
      .bind(actor.subject,actor.subject,actor.subject,actor.recipientHash||'',limit,offset).all()).results;
    return {companies,requests,limit,offset};
  }
  async ownershipRecovery(actor:Identity,admin:boolean,url:URL){
    if(admin)await this.authorize(actor,'ROLE_GRANT',true);else await requireEligible(this.db,actor);
    const {limit,offset}=page(url);
    const rows=(await this.db.prepare(`SELECT id,company,kind,status,revision,decision,updated_at ${admin?',requester,evidence_ref,reviewer':''}
      FROM ownership_recovery_cases WHERE (?=1 OR requester=?) ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`).bind(Number(admin),actor.subject,limit,offset).all()).results;
    if(admin)await this.audit(actor,'OWNERSHIP','RECOVERY_QUEUE','BILLIONJOBS','LIST');
    return {rows,limit,offset};
  }
  async requestRecovery(actor:Identity,company:string,kind:string,reference:string){
    await requireCompany(this.db,actor,identifier(company));
    if(!fresh(actor.reauthenticatedAt,this.clock(),5*60_000))throw new JobsError(403,'reauthentication_required');
    if(!['DISPUTED','UNAVAILABLE_OWNER'].includes(kind))throw new JobsError(400,'invalid_recovery_kind');
    const ref=bounded(reference,200);
    if(!/^[A-Za-z0-9_:/.-]+$/.test(ref))throw new JobsError(400,'invalid_evidence_ref');
    const id=crypto.randomUUID(),now=this.clock();
    const row=await this.db.prepare(`INSERT INTO ownership_recovery_cases(id,company,requester,kind,evidence_ref,status,created_at,updated_at)
      VALUES(?,?,?,?,?,'OPEN',?,?) ON CONFLICT DO NOTHING RETURNING id`).bind(id,company,actor.subject,kind,ref,now,now).first();
    if(!row)throw new JobsError(409,'recovery_pending');
    await this.audit(actor,'OWNERSHIP','RECOVERY',id,'OPEN');return {id,status:'OPEN'};
  }
  async updateRecovery(actor:Identity,id:string,input:unknown,admin:boolean){
    const cmd=input as {revision:number;status:string;note:string};
    if(!cmd||typeof cmd!=='object')throw new JobsError(400,'invalid_input');
    const note=bounded(cmd.note,500),revision=finiteRevision(cmd.revision),now=this.clock();
    let update;
    if(admin){
      await this.authorize(actor,'ROLE_GRANT',true);
      if(!['REVIEWING','MORE_INFO','CLOSED'].includes(cmd.status))throw new JobsError(400,'invalid_status');
      update=this.db.prepare(`UPDATE ownership_recovery_cases SET reviewer=?,status=?,decision=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?
        AND requester<>? AND (reviewer IS NULL OR reviewer=?) AND ((status='OPEN' AND ?='REVIEWING') OR (status='REVIEWING' AND ? IN ('MORE_INFO','CLOSED')))`)
        .bind(actor.subject,cmd.status,note,now,identifier(id),revision,actor.subject,actor.subject,cmd.status,cmd.status);
    }else{
      await requireEligible(this.db,actor);
      if(!fresh(actor.reauthenticatedAt,now,300000)||cmd.status!=='REVIEWING')throw new JobsError(403,'recovery_forbidden');
      if(!/^[A-Za-z0-9_:/.-]{1,200}$/.test(note))throw new JobsError(400,'invalid_evidence_ref');
      update=this.db.prepare(`UPDATE ownership_recovery_cases SET evidence_ref=?,status='REVIEWING',updated_at=?,revision=revision+1
        WHERE id=? AND revision=? AND requester=? AND status='MORE_INFO'`).bind(note,now,identifier(id),revision,actor.subject);
    }
    const audit=crypto.randomUUID();
    await this.db.batch([update,this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','OWNERSHIP','RECOVERY',?,?,'SUCCESS',?,? WHERE changes()=1`)
      .bind(audit,actor.subject,id,admin?cmd.status:'PROVIDE_EVIDENCE',revision+1,now)]);
    if(!await this.db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(audit).first())throw new JobsError(409,'recovery_conflict');
    return {id,status:cmd.status,revision:revision+1};
  }
  async endTransfer(actor:Identity,id:string,decline:boolean){
    await requireEligible(this.db,actor);
    if(!fresh(actor.reauthenticatedAt,this.clock(),5*60_000))throw new JobsError(403,'reauthentication_required');
    const now=this.clock(),audit=crypto.randomUUID();
    const condition=decline?'to_subject=? AND recipient_hash=?':'from_subject=? AND EXISTS(SELECT 1 FROM companies c WHERE c.id=ownership_transfers.company AND c.owner=?)';
    await this.db.batch([
      this.db.prepare(`UPDATE ownership_transfers SET cancelled_at=? WHERE id=? AND accepted_at IS NULL AND cancelled_at IS NULL
        AND expires_at>? AND ${condition}`).bind(now,identifier(id),now,actor.subject,decline?actor.recipientHash||'':actor.subject),
      this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','OWNERSHIP','TRANSFER',?,?,'SUCCESS',NULL,? WHERE changes()=1`)
        .bind(audit,actor.subject,id,decline?'DECLINE':'CANCEL',now)
    ]);
    if(!await this.db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(audit).first())throw new JobsError(409,'transfer_unavailable');
    return {id,status:decline?'DECLINED':'CANCELLED'};
  }
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
  async roleDirectory(actor:Identity,url:URL) {
    await this.authorize(actor,'ROLE_GRANT');
    const {limit,offset}=page(url);
    const rows=(await this.db.prepare(`SELECT subject,role,granted_at FROM admin_grants
      WHERE product='BILLIONJOBS' AND revoked_at IS NULL
      ORDER BY subject,role LIMIT ? OFFSET ?`).bind(limit,offset).all()).results;
    await this.audit(actor,'ROLE_MANAGEMENT','GRANTS','BILLIONJOBS','LIST');
    return {rows,limit,offset,roles:permissions};
  }
  private eligibleOwners() {
    return `SELECT g.subject FROM admin_grants g JOIN jobs_users u ON g.subject=u.subject
      WHERE g.product='BILLIONJOBS' AND g.role='PLATFORM_OWNER' AND g.revoked_at IS NULL
      AND u.eligible=1 AND u.restricted=0 AND u.closed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM enforcement_actions e WHERE e.target_kind='USER' AND e.target_ref=g.subject
        AND e.kind IN ('JOBS_TEMP','JOBS_PERMANENT','EMERGENCY') AND e.revoked_at IS NULL
        AND e.starts_at<=? AND (e.expires_at IS NULL OR e.expires_at>?))`;
  }
  async grantRole(actor:Identity,subject:string,role:AdminRole){
    await this.authorize(actor,'ROLE_GRANT',true);
    identifier(subject);
    if(subject===actor.subject)throw new JobsError(403,'self_grant_forbidden');
    if(typeof role!=='string'||!Object.prototype.hasOwnProperty.call(permissions,role))throw new JobsError(400,'invalid_role');
    const now=this.clock();
    const target=await this.db.prepare('SELECT subject FROM jobs_users WHERE subject=? AND eligible=1 AND restricted=0 AND closed_at IS NULL').bind(subject).first();
    if(!target)throw new JobsError(404,'subject_not_found');
    const grant=this.db.prepare(`INSERT INTO admin_grants(subject,product,role,granted_by,granted_at,revoked_at)
      SELECT subject,'BILLIONJOBS',?,?,?,NULL FROM jobs_users WHERE subject=? AND eligible=1 AND restricted=0 AND closed_at IS NULL
      AND ? IN (${this.eligibleOwners()})
      ON CONFLICT(subject,product,role) DO UPDATE SET granted_by=excluded.granted_by,granted_at=excluded.granted_at,revoked_at=NULL
      WHERE admin_grants.revoked_at IS NOT NULL`).bind(role,actor.subject,now,subject,actor.subject,now,now);
    await this.db.batch([grant,this.roleAudit(actor,subject,'GRANT_'+role,now)]);
    await this.authorize(actor,'ROLE_GRANT',true);
  }
  private roleAudit(actor:Identity,subject:string,action:string,at:number){
    return this.db.prepare(`INSERT INTO admin_audit
      SELECT ?,?,'BILLIONJOBS','ROLE_MANAGEMENT','USER',?,?,'SUCCESS',NULL,? WHERE changes()>0`)
      .bind(crypto.randomUUID(),actor.subject,subject,action,at);
  }
  async revokeRole(actor:Identity,subject:string,role:AdminRole){
    await this.authorize(actor,'ROLE_GRANT',true);
    identifier(subject);
    if(typeof role!=='string'||!Object.prototype.hasOwnProperty.call(permissions,role))throw new JobsError(400,'invalid_role');
    const now=this.clock(),owners=this.eligibleOwners();
    const revoke=this.db.prepare(`UPDATE admin_grants SET revoked_at=?
      WHERE subject=? AND product='BILLIONJOBS' AND role=? AND revoked_at IS NULL AND ? IN (${owners})
      AND (role<>'PLATFORM_OWNER' OR EXISTS (SELECT 1 FROM (${owners}) remaining WHERE remaining.subject<>?))`)
      .bind(now,subject,role,actor.subject,now,now,now,now,subject);
    await this.db.batch([revoke,this.roleAudit(actor,subject,'REVOKE_'+role,now)]);
    const active=await this.db.prepare("SELECT subject FROM admin_grants WHERE subject=? AND product='BILLIONJOBS' AND role=? AND revoked_at IS NULL").bind(subject,role).first();
    if(active){
      await this.authorize(actor,'ROLE_GRANT',true);
      throw new JobsError(409,role==='PLATFORM_OWNER'?'final_owner_protected':'role_conflict');
    }
  }
  async privacyWorkspace(actor:Identity,admin:boolean,url:URL){
    if(admin)await this.authorize(actor,'PRIVACY_REVIEW');
    else if(!await this.db.prepare('SELECT subject FROM jobs_users WHERE subject=?').bind(actor.subject).first())throw new JobsError(403,'jobs_ineligible');
    const {limit,offset}=page(url);
    const notice=await this.db.prepare('SELECT version,summary,published_at FROM jobs_privacy_notices WHERE active=1').first();
    const requests=(await this.db.prepare(`SELECT id,subject,kind,status,reason_code,requested_at,completed_at FROM privacy_requests
      WHERE ?=1 OR subject=? ORDER BY requested_at DESC,id LIMIT ? OFFSET ?`).bind(Number(admin),actor.subject,limit,offset).all()).results;
    const consent=admin?[]:(await this.db.prepare('SELECT purpose,notice_version,granted,at FROM jobs_consent_events WHERE subject=? ORDER BY at DESC,id LIMIT ? OFFSET ?').bind(actor.subject,limit,offset).all()).results;
    const holds=admin?(await this.db.prepare('SELECT id,subject,scope,reason_code,review_at,released_at FROM legal_holds ORDER BY created_at DESC,id LIMIT ? OFFSET ?').bind(limit,offset).all()).results:[];
    if(admin)await this.audit(actor,'PRIVACY','WORKSPACE','BILLIONJOBS','READ');
    return {notice,requests,consent,holds,limit,offset};
  }
  async requestPrivacy(actor:Identity,kind:'EXPORT'|'DELETE'){
    await requireEligible(this.db,actor);if(!fresh(actor.reauthenticatedAt,this.clock(),5*60_000))throw new JobsError(403,'reauthentication_required');
    if(!['EXPORT','DELETE'].includes(kind))throw new JobsError(400,'invalid_request');
    const id=crypto.randomUUID(),now=this.clock();
    await this.db.batch([
      this.db.prepare(`INSERT INTO privacy_requests SELECT ?,?,?,'SUBMITTED',NULL,?,NULL
        WHERE NOT EXISTS(SELECT 1 FROM privacy_requests WHERE subject=? AND kind=? AND status IN ('SUBMITTED','REVIEWING'))`).bind(id,actor.subject,kind,now,actor.subject,kind),
      this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','PRIVACY','PRIVACY_REQUEST',?,?,'SUCCESS',NULL,? WHERE changes()=1`)
        .bind(crypto.randomUUID(),actor.subject,id,'REQUEST_'+kind,now)
    ]);
    if(!await this.db.prepare('SELECT id FROM privacy_requests WHERE id=?').bind(id).first())throw new JobsError(409,'request_pending');
    return {id,status:'SUBMITTED'};
  }
  async publishPrivacyNotice(actor:Identity,version:string,summary:string){await this.authorize(actor,'PRIVACY_REVIEW',true);
    if(typeof version!=='string'||!/^BJ-[A-Za-z0-9.-]{1,40}$/.test(version))throw new JobsError(400,'invalid_notice_version');
    const now=this.clock();await this.db.batch([
      this.db.prepare('UPDATE jobs_privacy_notices SET active=0 WHERE active=1'),
      this.db.prepare('INSERT INTO jobs_privacy_notices VALUES(?,?,?,1)').bind(version,now,bounded(summary,1000))
    ]);await this.audit(actor,'PRIVACY_NOTICE','NOTICE',version,'PUBLISH');return {version,active:true};
  }
  async recordConsent(actor:Identity,purpose:'OPTIONAL_ANALYTICS'|'PUBLIC_INDEXING',granted:boolean,version?:string){await requireEligible(this.db,actor);
    if(!['OPTIONAL_ANALYTICS','PUBLIC_INDEXING'].includes(purpose)||typeof granted!=='boolean')throw new JobsError(400,'invalid_consent');
    const event=crypto.randomUUID(),now=this.clock();
    const commands=[this.db.prepare(`INSERT INTO jobs_consent_events(id,subject,purpose,notice_version,granted,at)
      SELECT ?,?,?,version,?,? FROM jobs_privacy_notices WHERE active=1 AND (? IS NULL OR version=?)`)
      .bind(event,actor.subject,purpose,Number(granted),now,version??null,version??null),
      this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','CONSENT','USER',?,?,'SUCCESS',NULL,? WHERE changes()=1`)
        .bind(crypto.randomUUID(),actor.subject,actor.subject,(granted?'GRANT_':'WITHDRAW_')+purpose,now)];
    if(purpose==='PUBLIC_INDEXING'&&!granted){
      for(const table of ['jobs_profiles','jobs_users'])commands.push(this.db.prepare(`UPDATE ${table} SET indexing=0 WHERE subject=? AND indexing=1
        AND EXISTS(SELECT 1 FROM jobs_consent_events WHERE id=?)`).bind(actor.subject,event));
    }
    await this.db.batch(commands);
    const consent=await this.db.prepare('SELECT notice_version FROM jobs_consent_events WHERE id=?').bind(event).first<{notice_version:string}>();
    if(!consent)throw new JobsError(409,'notice_unavailable');
    return {purpose,granted,noticeVersion:consent.notice_version};
  }
  async legalHold(actor:Identity,subject:string,scope:string,reasonCode:string,reviewAt:number){
    await this.authorize(actor,'PRIVACY_REVIEW',true);identifier(subject);
    if(!['JOBS','APPLICATION','CLOSURE','MODERATION'].includes(scope))throw new JobsError(400,'invalid_hold_scope');
    if(!Number.isSafeInteger(reviewAt)||reviewAt<=this.clock()||reviewAt>this.clock()+365*86400000)throw new JobsError(400,'invalid_review_date');
    const id=crypto.randomUUID();await this.db.prepare('INSERT INTO legal_holds VALUES(?,?,?,?,?,?,?,NULL,NULL)').bind(id,subject,bounded(reasonCode,80),bounded(scope,80),actor.subject,this.clock(),reviewAt).run();
    await this.audit(actor,'LEGAL_HOLD','USER',subject,'CREATE');return {id};
  }
  async reviewHold(actor:Identity,id:string,prior:number,next:number){
    await this.authorize(actor,'PRIVACY_REVIEW',true);identifier(id);const now=this.clock();
    if(!Number.isSafeInteger(prior)||!Number.isSafeInteger(next)||next<=now||next>now+365*86400000)throw new JobsError(400,'invalid_review_date');
    const audit=crypto.randomUUID();
    await this.db.batch([this.db.prepare('UPDATE legal_holds SET review_at=? WHERE id=? AND review_at=? AND released_at IS NULL').bind(next,id,prior),
      this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','LEGAL_HOLD','HOLD',?,'REVIEW','SUCCESS',NULL,? WHERE changes()=1`).bind(audit,actor.subject,id,now)]);
    if(!await this.db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(audit).first())throw new JobsError(409,'hold_conflict');
    return {id,reviewAt:next};
  }
  async releaseHold(actor:Identity,id:string){await this.authorize(actor,'PRIVACY_REVIEW',true);identifier(id);
    const hold=await this.db.prepare('UPDATE legal_holds SET released_at=?,release_actor=? WHERE id=? AND released_at IS NULL RETURNING subject').bind(this.clock(),actor.subject,id).first<{subject:string}>();if(!hold)throw new JobsError(404,'hold_not_found');
    await this.audit(actor,'LEGAL_HOLD','USER',hold.subject,'RELEASE');return {id,released:true};
  }
  async completePrivacy(actor:Identity,id:string,approved:boolean,reasonCode:string){await this.authorize(actor,'PRIVACY_REVIEW',true);identifier(id);
    if(typeof approved!=='boolean')throw new JobsError(400,'invalid_decision');
    const request=await this.db.prepare('SELECT subject,kind FROM privacy_requests WHERE id=? AND status IN (\'SUBMITTED\',\'REVIEWING\')').bind(id).first<{subject:string;kind:string}>();if(!request)throw new JobsError(409,'request_conflict');
    if(approved&&request.kind==='DELETE'){
      const hold=await this.db.prepare('SELECT id FROM legal_holds WHERE subject=? AND released_at IS NULL').bind(request.subject).first();if(hold)throw new JobsError(409,'legal_hold_active');
    }
    const status=approved?'REVIEWING':'DENIED',now=this.clock();
    const audit=crypto.randomUUID(),guard='EXISTS(SELECT 1 FROM admin_audit WHERE id=?)';
    const statements=[
      this.db.prepare("UPDATE privacy_requests SET status=?,reason_code=?,completed_at=? WHERE id=? AND status='SUBMITTED'").bind(status,bounded(reasonCode,80),status==='REVIEWING'?null:now,id),
      this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','PRIVACY','PRIVACY_REQUEST',?,?,'SUCCESS',NULL,? WHERE changes()=1`)
        .bind(audit,actor.subject,id,approved?'REVIEW_'+request.kind:'DENY_'+request.kind,now)
    ];
    if(approved&&request.kind==='DELETE')statements.push(
      this.db.prepare(`UPDATE jobs_users SET closed_at=?,visibility='PRIVATE',indexing=0 WHERE subject=? AND closed_at IS NULL AND ${guard}`).bind(now,request.subject,audit),
      this.db.prepare(`UPDATE memberships SET revoked_at=COALESCE(revoked_at,?) WHERE subject=? AND ${guard}`).bind(now,request.subject,audit),
      this.db.prepare(`UPDATE retained_records SET restricted=1 WHERE subject=? AND ${guard}`).bind(request.subject,audit),
      this.db.prepare(`INSERT INTO privacy_audit(actor,action,at) SELECT ?,'JOBS_CLOSED',? WHERE ${guard}`).bind(request.subject,now,audit));
    await this.db.batch(statements);
    if(!await this.db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(audit).first())throw new JobsError(409,'request_conflict');
    return {id,status};
  }
  async incidents(actor:Identity,url:URL){
    await this.authorize(actor,'INCIDENT');const {limit,offset}=page(url);
    const rows=(await this.db.prepare('SELECT id,severity,status,owner,summary,review_due_at,revision FROM security_incidents ORDER BY updated_at DESC,id LIMIT ? OFFSET ?').bind(limit,offset).all()).results;
    await this.audit(actor,'SECURITY_INCIDENT','QUEUE','BILLIONJOBS','LIST');return {rows,limit,offset};
  }
  async incidentDetail(actor:Identity,id:string){
    await this.authorize(actor,'INCIDENT');identifier(id);
    const incident=await this.db.prepare('SELECT * FROM security_incidents WHERE id=?').bind(id).first();
    if(!incident)throw new JobsError(404,'incident_not_found');
    const timeline=(await this.db.prepare('SELECT actor,action,note,evidence_ref,at FROM incident_events WHERE incident=? ORDER BY at,id').bind(id).all()).results;
    const corrective=(await this.db.prepare('SELECT id,owner,description,due_at,completed_at FROM incident_corrective_actions WHERE incident=? ORDER BY created_at,id').bind(id).all()).results;
    await this.audit(actor,'SECURITY_INCIDENT','INCIDENT',id,'READ');return {incident,timeline,corrective};
  }
  async assignIncident(actor:Identity,id:string,owner:string,severity:string,revision:number){
    await this.authorize(actor,'INCIDENT',true);identifier(id);identifier(owner);finiteRevision(revision);
    if(!['LOW','MEDIUM','HIGH','CRITICAL'].includes(severity))throw new JobsError(400,'invalid_severity');
    const event=crypto.randomUUID(),now=this.clock();
    await this.db.batch([this.db.prepare(`UPDATE security_incidents SET owner=?,severity=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status<>'RESOLVED'
      AND EXISTS(SELECT 1 FROM admin_grants g JOIN jobs_users u ON u.subject=g.subject WHERE g.subject=? AND g.product='BILLIONJOBS' AND g.role IN ('PLATFORM_OWNER','SECURITY_ADMIN')
      AND g.revoked_at IS NULL AND u.closed_at IS NULL AND u.eligible=1 AND u.restricted=0)`).bind(owner,severity,now,id,revision,owner),
      this.db.prepare(`INSERT INTO incident_events SELECT ?,?,?,'ASSIGN',NULL,?,? WHERE changes()=1`).bind(event,id,actor.subject,owner+' / '+severity,now)]);
    if(!await this.db.prepare('SELECT id FROM incident_events WHERE id=?').bind(event).first())throw new JobsError(409,'incident_conflict');
    await this.audit(actor,'SECURITY_INCIDENT','INCIDENT',id,'ASSIGN','SUCCESS',revision+1);return {revision:revision+1};
  }
  async finishCorrectiveAction(actor:Identity,incident:string,id:string){
    await this.authorize(actor,'INCIDENT',true);
    const result=await this.db.prepare('UPDATE incident_corrective_actions SET completed_at=? WHERE id=? AND incident=? AND completed_at IS NULL RETURNING id')
      .bind(this.clock(),identifier(id),identifier(incident)).first();
    if(!result)throw new JobsError(409,'action_conflict');
    await this.audit(actor,'SECURITY_INCIDENT','INCIDENT',incident,'COMPLETE_CORRECTIVE_ACTION');return result;
  }
  async createIncident(actor:Identity,severity:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL',summary:string){await this.authorize(actor,'INCIDENT',true);
    if(!['LOW','MEDIUM','HIGH','CRITICAL'].includes(severity))throw new JobsError(400,'invalid_severity');const id=crypto.randomUUID(),now=this.clock();
    const escalation=await this.db.prepare("SELECT value FROM effective_jobs_policies WHERE key='incident_escalation_hours'").first<{value:string}>();
    const reporting=await this.db.prepare("SELECT value FROM effective_jobs_policies WHERE key='incident_reporting_hours'").first<{value:string}>();
    const reportingDue=reporting?now+Number(reporting.value)*3600000:null;
    const reviewDue=now+(escalation?Number(JSON.parse(escalation.value)):24)*3600_000;
    await this.db.batch([this.db.prepare("INSERT INTO security_incidents(id,severity,status,owner,summary,created_at,updated_at,review_due_at,reporting_due_at) VALUES(?,?,'OPEN',?,?,?,?,?,?)").bind(id,severity,actor.subject,bounded(summary,500),now,now,reviewDue,reportingDue),
      this.db.prepare("INSERT INTO incident_events(id,incident,actor,action,at) VALUES(?,?,?,'OPEN',?)").bind(crypto.randomUUID(),id,actor.subject,now)]);
    await this.audit(actor,'SECURITY_INCIDENT','INCIDENT',id,'OPEN');return {id,status:'OPEN',reviewDueAt:reviewDue};
  }
  async incidentTransition(actor:Identity,id:string,revision:number,status:'CONTAINED'|'RECOVERING'|'RESOLVED',note:string,evidenceRef?:string){
    await this.authorize(actor,'INCIDENT',true);identifier(id);const allowed:Record<string,string[]>={OPEN:['CONTAINED'],CONTAINED:['RECOVERING'],RECOVERING:['RESOLVED']};
    const current=await this.db.prepare('SELECT status,revision FROM security_incidents WHERE id=?').bind(id).first<{status:string;revision:number}>();
    if(!current||current.revision!==finiteRevision(revision)||!allowed[current.status]?.includes(status))throw new JobsError(409,'incident_conflict');
    const now=this.clock(),event=crypto.randomUUID();await this.db.batch([
      this.db.prepare('UPDATE security_incidents SET status=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(status,now,id,revision),
      this.db.prepare('INSERT INTO incident_events SELECT ?,?,?,?,?,?,? WHERE changes()=1').bind(event,id,actor.subject,status,evidenceRef?bounded(evidenceRef,200):null,bounded(note,1000),now)
    ]);
    if(!await this.db.prepare('SELECT id FROM incident_events WHERE id=?').bind(event).first())throw new JobsError(409,'incident_conflict');
    await this.audit(actor,'SECURITY_INCIDENT','INCIDENT',id,status,'SUCCESS',revision+1);return {id,status,revision:revision+1};
  }
  async addCorrectiveAction(actor:Identity,incidentId:string,ownerSubject:string,description:string,dueAt:number){
    await this.authorize(actor,'INCIDENT',true);identifier(incidentId);identifier(ownerSubject);
    if(!await this.db.prepare("SELECT subject FROM jobs_users WHERE subject=? AND closed_at IS NULL AND eligible=1 AND restricted=0").bind(ownerSubject).first())throw new JobsError(400,'invalid_action_owner');
    if(!Number.isSafeInteger(dueAt)||dueAt<=this.clock())throw new JobsError(400,'invalid_due_date');
    const id=crypto.randomUUID();await this.db.prepare('INSERT INTO incident_corrective_actions VALUES(?,?,?,?,?,NULL,?)').bind(id,incidentId,ownerSubject,bounded(description,500),dueAt,this.clock()).run();
    await this.audit(actor,'SECURITY_INCIDENT','INCIDENT',incidentId,'CORRECTIVE_ACTION');return {id};
  }
  async policies(actor:Identity,url:URL){
    await this.authorize(actor,'POLICY');
    const {limit,offset}=page(url);
    const current=(await this.db.prepare('SELECT key,value,revision,effective_at FROM jobs_policy_versions ORDER BY key').all()).results;
    const history=(await this.db.prepare('SELECT key,value,revision,actor,effective_at FROM jobs_policy_history ORDER BY effective_at DESC,key,revision DESC LIMIT ? OFFSET ?').bind(limit,offset).all()).results;
    return {bounds:policyBounds,current,history,limit,offset};
  }
  async updatePolicy(actor:Identity,key:string,value:number,revision:number,effectiveAt=this.clock()){
    await this.authorize(actor,'POLICY',true);
    const limits=Object.hasOwn(policyBounds,key)?policyBounds[key]:undefined;
    if(!limits||!Number.isSafeInteger(value)||value<limits[0]||value>limits[1]||!Number.isSafeInteger(effectiveAt)||effectiveAt<0)throw new JobsError(400,'invalid_policy');
    if(!Number.isSafeInteger(revision)||revision<0)throw new JobsError(400,'invalid_revision');
    const audit=crypto.randomUUID(),at=this.clock();
    const write=revision===0?this.db.prepare('INSERT INTO jobs_policy_versions VALUES(?,?,1,?,?) ON CONFLICT(key) DO NOTHING').bind(key,JSON.stringify(value),effectiveAt,actor.subject):
      this.db.prepare('UPDATE jobs_policy_versions SET value=?,revision=revision+1,effective_at=?,actor=? WHERE key=? AND revision=?').bind(JSON.stringify(value),effectiveAt,actor.subject,key,revision);
    await this.db.batch([write,this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','POLICY','SETTING',?,'UPDATE','SUCCESS',?,? WHERE changes()=1`)
      .bind(audit,actor.subject,key,revision+1,at)]);
    if(!await this.db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(audit).first())throw new JobsError(409,'policy_conflict');
    return {key,value,revision:revision+1,effectiveAt};
  }
  /** Deterministic review indicators; this never changes listings or account authority. */
  async scanCompany(actor:Identity,companyId:string){await this.authorize(actor,'CASE_READ');identifier(companyId);
    const listings=(await this.db.prepare('SELECT id,data,publication FROM listing_details WHERE company=? ORDER BY created_at DESC LIMIT 100').bind(companyId).all<{id:string;data:string;publication:string}>()).results;
    const actions=await this.db.prepare("SELECT count(*) n FROM posting_actions WHERE company=? AND at>?").bind(companyId,this.clock()-86400000).first<{n:number}>();
    const threshold=await this.db.prepare("SELECT value FROM effective_jobs_policies WHERE key='moderation_daily_signal_threshold'").first<{value:string}>();
    const complaints=await this.db.prepare("SELECT count(*) n FROM moderation_cases WHERE kind IN ('JOB','COMPANY','RECRUITER','SCAM') AND (target_ref=? OR substr(target_ref,1,length(?)+1)=?||'/') AND status='RESOLVED'").bind(companyId,companyId,companyId).first<{n:number}>();
    const recruiterCommands=await this.db.prepare('SELECT count(*) n FROM recruitment_commands rc JOIN applications a ON a.id=rc.application WHERE a.company=? AND rc.at>?').bind(companyId,this.clock()-86400000).first<{n:number}>();
    const interviewCommands=await this.db.prepare("SELECT count(*) n FROM interview_commands ic JOIN interviews i ON i.id=ic.interview WHERE i.company=? AND ic.at>?").bind(companyId,this.clock()-86400000).first<{n:number}>();
    const {indicators,fingerprints}=detectCompanySignals(companyId,listings,{
      postings:actions?.n||0,complaints:complaints?.n||0,recruitment:recruiterCommands?.n||0,interviews:interviewCommands?.n||0
    },threshold?Number(JSON.parse(threshold.value)):8);
    let created=0;
    const observations:Record<string,number>={
      POSTING_FREQUENCY:actions?.n||0,REPEATED_COMPLAINTS:complaints?.n||0,
      RECRUITER_ACTIVITY_VOLUME:recruiterCommands?.n||0,INTERVIEW_WORKFLOW_VOLUME:interviewCommands?.n||0
    };
    for(const item of indicators){
      const listing=listings.find(row=>companyId+'/'+row.id===item.target);
      const observed=listing?.data??(item.rule==='REPEATED_DUPLICATE'?JSON.stringify([...fingerprints].sort()):String(observations[item.rule]));
      const evidence=await digest(item.rule+'|'+observed);
      const result=await this.db.prepare(`INSERT OR IGNORE INTO fraud_signals
        SELECT ?,?,?,?,?,?,'OPEN',?,NULL,NULL WHERE NOT EXISTS(SELECT 1 FROM fraud_signals WHERE rule=? AND target_ref=? AND evidence_ref=?) RETURNING id`)
        .bind(crypto.randomUUID(),item.rule,item.target===companyId?'COMPANY':'LISTING',item.target,item.severity,evidence,this.clock(),item.rule,item.target,evidence).first();
      if(result)created++;
    }
    await this.audit(actor,'FRAUD_REVIEW','COMPANY',companyId,'SCAN');return {indicators:indicators.map(i=>({rule:i.rule,target:i.target,severity:i.severity,humanReviewRequired:true})),created};
  }
  async signals(actor:Identity,url:URL){
    await this.authorize(actor,'CASE_DECIDE');const {limit,offset}=page(url);
    const rows=(await this.db.prepare("SELECT id,rule,target_kind,target_ref,severity,status,created_at FROM fraud_signals WHERE status='OPEN' ORDER BY created_at,id LIMIT ? OFFSET ?").bind(limit,offset).all()).results;
    await this.audit(actor,'FRAUD_REVIEW','SIGNALS','BILLIONJOBS','LIST');return {rows,limit,offset};
  }
  async reviewSignal(actor:Identity,id:string,refer:boolean){
    await this.authorize(actor,'CASE_DECIDE');identifier(id);
    if(typeof refer!=='boolean')throw new JobsError(400,'invalid_signal_decision');
    const audit=crypto.randomUUID(),now=this.clock(),status=refer?'REFERRED':'DISMISSED';
    const commands=[
      this.db.prepare("UPDATE fraud_signals SET status=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status='OPEN'").bind(status,actor.subject,now,id),
      this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','FRAUD_REVIEW',target_kind,target_ref,?,'SUCCESS',NULL,?
        FROM fraud_signals WHERE id=? AND changes()=1`).bind(audit,actor.subject,status,now,id)
    ];
    const caseId=crypto.randomUUID();
    if(refer)commands.push(
      this.db.prepare(`INSERT INTO moderation_cases(id,kind,target_ref,reporter,category,severity,status,created_at,updated_at)
        SELECT ?,CASE target_kind WHEN 'LISTING' THEN 'JOB' ELSE 'COMPANY' END,target_ref,?,rule,severity,'OPEN',?,?
        FROM fraud_signals WHERE id=? AND EXISTS(SELECT 1 FROM admin_audit WHERE id=?)`).bind(caseId,actor.subject,now,now,id,audit),
      this.db.prepare(`INSERT INTO moderation_events SELECT ?,?,?,'SIGNAL_REFERRAL','OPEN',NULL,?,? WHERE changes()=1`).bind(crypto.randomUUID(),caseId,actor.subject,id,now));
    await this.db.batch(commands);
    if(!await this.db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(audit).first())throw new JobsError(409,'signal_conflict');
    return {id,status,caseId:refer?caseId:null};
  }
  async operationalQueue(actor:Identity,url:URL){await this.authorize(actor,'INCIDENT');const {limit,offset}=page(url);
    const rows=(await this.db.prepare(`SELECT * FROM (
      SELECT id,interview,operation,status,attempts,next_attempt_at,last_error,updated_at,8 max_attempts FROM interview_meeting_outbox
      UNION ALL SELECT id,interview,'REMINDER' operation,status,attempts,next_attempt_at,NULL last_error,updated_at,5 max_attempts FROM interview_reminder_outbox)
      WHERE status IN ('PENDING','FAILED') ORDER BY updated_at,id LIMIT ? OFFSET ?`).bind(limit,offset).all()).results;
    await this.audit(actor,'OPERATIONS','OUTBOX','BILLIONJOBS','LIST');return {rows,limit,offset};
  }
  async retryOutbox(actor:Identity,id:string,reminder=false){
    await this.authorize(actor,'INCIDENT',true);identifier(id);const now=this.clock();
    const table=reminder?'interview_reminder_outbox':'interview_meeting_outbox';
    const guard=reminder?'':" AND NOT EXISTS(SELECT 1 FROM meeting_outbox_leases WHERE job=? AND expires_at>?)";
    const args=reminder?[now,now,id]:[now,now,id,id,now];
    const audit=crypto.randomUUID();
    await this.db.batch([this.db.prepare(`UPDATE ${table} SET status='PENDING',attempts=0,next_attempt_at=?,updated_at=? WHERE id=? AND status='FAILED'${guard}`).bind(...args),
      this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','OPERATIONS','OUTBOX',?,'RETRY','SUCCESS',NULL,? WHERE changes()=1`).bind(audit,actor.subject,id,now)]);
    if(!await this.db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(audit).first())throw new JobsError(409,'outbox_not_retryable');
    return {id,queued:true};
  }
  async users(actor:Identity,url:URL){await this.authorize(actor,'DASHBOARD');const {limit,offset}=page(url),query=bounded(url.searchParams.get('q')||'*',80);
    const rows=(await this.db.prepare(`SELECT subject,eligible,restricted,closed_at,visibility,indexing,
      (SELECT count(*) FROM enforcement_actions e WHERE e.target_kind='USER' AND e.target_ref=u.subject AND e.revoked_at IS NULL
      AND e.starts_at<=? AND (e.expires_at IS NULL OR e.expires_at>?)) active_actions
      FROM jobs_users u WHERE (?='*' OR subject LIKE ? ESCAPE '\\') ORDER BY subject LIMIT ? OFFSET ?`).bind(this.clock(),this.clock(),query,'%'+query.replace(/[\\%_]/g,'\\$&')+'%',limit,offset).all()).results;
    await this.audit(actor,'ACCOUNT_ADMIN','USER_DIRECTORY','BILLIONJOBS','LIST');return {rows,limit,offset,scope:'BILLIONJOBS',sharedAccountStatus:'outside_jobs_scope'};
  }
  async operationalAnalytics(actor:Identity,days:number,group?:string|null){const allowed=await this.authorize(actor,'DASHBOARD');if(!Number.isSafeInteger(days)||days<1||days>90)throw new JobsError(400,'invalid_period');
    const end=this.clock(),start=end-days*86400000;
    const counts=await this.db.prepare(`SELECT
      (SELECT count(*) FROM moderation_cases WHERE created_at>=? AND created_at<?) reported,
      (SELECT count(*) FROM moderation_cases WHERE status IN ('RESOLVED','CLOSED') AND updated_at>=? AND updated_at<?) resolved,
      (SELECT count(*) FROM enforcement_appeals WHERE created_at>=? AND created_at<?) appeals,
      (SELECT count(*) FROM enforcement_appeals WHERE status='OVERTURNED' AND updated_at>=? AND updated_at<?) overturned,
      (SELECT count(*) FROM fraud_signals WHERE created_at>=? AND created_at<?) signals,
      (SELECT count(*) FROM privacy_requests WHERE requested_at>=? AND requested_at<?) privacy_requests,
      (SELECT count(*) FROM enforcement_actions WHERE starts_at>=? AND starts_at<?) enforced,
      (SELECT count(*) FROM security_incidents WHERE created_at>=? AND created_at<?) incidents,
      (SELECT count(*) FROM admin_audit WHERE product='BILLIONJOBS' AND at>=? AND at<?) admin_events`)
      .bind(start,end,start,end,start,end,start,end,start,end,start,end,start,end,start,end,start,end).first<Record<string,number>>();
    await this.audit(actor,'ANALYTICS','BILLIONJOBS','OPERATIONS','READ');
    const metricPermissions:Record<string,AdminPermission>={reported:'CASE_READ',resolved:'CASE_READ',appeals:'APPEAL_REVIEW',overturned:'APPEAL_REVIEW',signals:'CASE_DECIDE',privacy_requests:'PRIVACY_REVIEW',enforced:'ENFORCE',incidents:'INCIDENT',admin_events:'AUDIT_READ'};
    const safe=Object.fromEntries(Object.entries(counts||{}).filter(([key])=>allowed.has(metricPermissions[key])).map(([key,value])=>[key,value<5?null:value]));
    const dimensions:Record<string,[string,string,string]>={reported:['moderation_cases','kind','created_at'],appeals:['enforcement_appeals','status','created_at'],
      signals:['fraud_signals','rule','created_at'],privacy_requests:['privacy_requests','kind','requested_at'],enforced:['enforcement_actions','kind','starts_at'],
      incidents:['security_incidents','severity','created_at'],admin_events:['admin_audit','purpose','at']};
    let breakdown:unknown[]=[];
    if(group){
      if(!Object.hasOwn(dimensions,group)||!allowed.has(metricPermissions[group]))throw new JobsError(403,'metric_forbidden');
      const [table,field,time]=dimensions[group];
      breakdown=(await this.db.prepare(`SELECT ${field} category,count(*) count FROM ${table} WHERE ${time}>=? AND ${time}<?
        ${group==='admin_events'?"AND product='BILLIONJOBS'":''} GROUP BY ${field} HAVING count(*)>=5 ORDER BY count(*) DESC,${field}`).bind(start,end).all()).results;
    }
    return {period:{start,end,days},counts:safe,breakdown,suppression:'Counts below 5 are hidden.',denominators:{reported:'cases created in period',resolved:'cases resolved in period',appeals:'appeals created in period',overturned:'appeals overturned in period',signals:'signals created in period',privacy_requests:'requests created in period',enforced:'enforcement actions started in period',incidents:'incidents opened in period',admin_events:'audit events created in period'}};
  }
  async companyMembers(actor:Identity,company:string,url:URL){
    await this.authorize(actor,'ENFORCE');
    const {limit,offset}=page(url);
    const record=await this.db.prepare('SELECT owner,revision FROM companies WHERE id=?').bind(identifier(company)).first<{owner:string;revision:number}>();
    if(!record)throw new JobsError(404,'company_not_found');
    const rows=(await this.db.prepare('SELECT subject,role,revoked_at FROM memberships WHERE company=? ORDER BY subject LIMIT ? OFFSET ?')
      .bind(company,limit,offset).all()).results;
    await this.audit(actor,'EMPLOYER_ADMIN','COMPANY',company,'READ_MEMBERS');
    return {...record,rows,limit,offset};
  }
  async revokeCompanyMember(actor:Identity,company:string,subject:string,input:unknown){
    await this.authorize(actor,'ENFORCE',true);
    identifier(company);identifier(subject);
    const revision=finiteRevision((input as {revision?:unknown}|null)?.revision);
    const event=crypto.randomUUID(),now=this.clock();
    const roles=Object.entries(permissions).filter(([,allowed])=>allowed.includes('ENFORCE')).map(([role])=>role);
    const guard='EXISTS(SELECT 1 FROM admin_audit WHERE id=?)';
    // A single D1 transaction binds all cleanup to the authorized company revision.
    await this.db.batch([
      this.db.prepare(`INSERT INTO admin_audit SELECT ?,?,'BILLIONJOBS','EMPLOYER_ADMIN','MEMBERSHIP',?,
        'REVOKE','SUCCESS',?,? FROM companies c JOIN memberships m ON m.company=c.id
        WHERE c.id=? AND c.revision=? AND m.subject=? AND c.owner<>m.subject AND m.revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM admin_grants g JOIN jobs_users u ON u.subject=g.subject WHERE g.subject=?
          AND g.product='BILLIONJOBS' AND g.revoked_at IS NULL AND u.closed_at IS NULL AND u.restricted=0 AND u.eligible=1
          AND g.role IN (SELECT value FROM json_each(?))
          AND NOT EXISTS(SELECT 1 FROM enforcement_actions e WHERE e.target_kind='USER' AND e.target_ref=u.subject
            AND e.kind IN ('JOBS_TEMP','JOBS_PERMANENT','EMERGENCY') AND e.revoked_at IS NULL
            AND e.starts_at<=? AND (e.expires_at IS NULL OR e.expires_at>?)))`)
        .bind(event,actor.subject,company+'/'+subject,revision+1,now,company,revision,subject,actor.subject,JSON.stringify(roles),now,now),
      this.db.prepare(`UPDATE memberships SET revoked_at=? WHERE company=? AND subject=? AND ${guard}`).bind(now,company,subject,event),
      this.db.prepare(`DELETE FROM assignments WHERE company=? AND subject=? AND ${guard}`).bind(company,subject,event),
      this.db.prepare(`UPDATE company_invitations SET revoked_at=? WHERE company=? AND revoked_at IS NULL AND used_at IS NULL
        AND (issuer=? OR recipient_hash IN (SELECT recipient_hash FROM company_invitations WHERE company=? AND accepted_by=?))
        AND ${guard}`).bind(now,company,subject,company,subject,event),
      this.db.prepare(`UPDATE companies SET revision=revision+1 WHERE id=? AND ${guard}`).bind(company,event)
    ]);
    if(!await this.db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(event).first()){
      await this.authorize(actor,'ENFORCE',true);
      throw new JobsError(409,'membership_conflict');
    }
    return {company,subject,revision:revision+1};
  }
  async companies(actor:Identity,url:URL){await this.authorize(actor,'DASHBOARD');const {limit,offset}=page(url),query=bounded(url.searchParams.get('q')||'*',80);
    const rows=(await this.db.prepare(`SELECT c.id,json_extract(c.data,'$.name') name,c.owner,c.restricted,c.revision,
      CASE WHEN v.state='VERIFIED' AND v.expires_at<=? THEN 'EXPIRED' ELSE COALESCE(v.state,'UNVERIFIED') END employer_verification FROM companies c LEFT JOIN employer_verifications v ON v.company=c.id
      WHERE (?='*' OR json_extract(c.data,'$.name') LIKE ? ESCAPE '\\') ORDER BY c.created_at DESC,c.id LIMIT ? OFFSET ?`).bind(this.clock(),query,'%'+query.replace(/[\\%_]/g,'\\$&')+'%',limit,offset).all()).results;
    await this.audit(actor,'EMPLOYER_ADMIN','COMPANY_DIRECTORY','BILLIONJOBS','LIST');return {rows,limit,offset,registration:'email_verified_free',employerVerification:'optional'};
  }
  async employerEvidence(actor:Identity,companyId:string,admin:boolean){
    identifier(companyId);
    if(admin)await this.authorize(actor,'CASE_DECIDE');
    else await requireCompany(this.db,actor,companyId,true);
    const row=await this.db.prepare(`SELECT c.id,CASE WHEN v.state='VERIFIED' AND v.expires_at<=? THEN 'EXPIRED' ELSE COALESCE(v.state,'UNVERIFIED') END state,COALESCE(v.revision,0) revision,v.evidence_ref reference,v.expires_at
      FROM companies c LEFT JOIN employer_verifications v ON v.company=c.id WHERE c.id=?`).bind(this.clock(),companyId).first();
    if(!row)throw new JobsError(404,'company_not_found');
    if(admin)await this.audit(actor,'EMPLOYER_VERIFICATION','COMPANY',companyId,'READ');
    return row;
  }
  async submitEmployerEvidence(actor:Identity,companyId:string,input:unknown) {
    identifier(companyId);
    await requireCompany(this.db,actor,companyId,true);
    const body=input as {reference?:unknown;revision?:unknown};
    if(!body || typeof body!=='object' || !Number.isSafeInteger(body.revision) || Number(body.revision)<0)
      throw new JobsError(400,'invalid_revision');
    const reference=bounded(body.reference,200);
    if(!/^[A-Za-z0-9_:/.-]+$/.test(reference))throw new JobsError(400,'invalid_evidence_ref');
    const revision=Number(body.revision);
    const existing=await this.db.prepare('SELECT revision FROM employer_verifications WHERE company=?').bind(companyId).first<{revision:number}>();
    if((existing?.revision||0)!==revision)throw new JobsError(409,'verification_conflict');
    const write=existing?this.db.prepare(`UPDATE employer_verifications SET state='EVIDENCE_PENDING',evidence_ref=?,
      reviewer=NULL,reviewed_at=NULL,expires_at=NULL,revision=revision+1 WHERE company=? AND revision=? AND (state IN ('UNVERIFIED','REJECTED','EXPIRED') OR state='VERIFIED' AND expires_at<=?) RETURNING revision`)
      .bind(reference,companyId,revision,this.clock()):this.db.prepare(`INSERT INTO employer_verifications(company,state,evidence_ref)
      VALUES(?,'EVIDENCE_PENDING',?) ON CONFLICT DO NOTHING RETURNING revision`).bind(companyId,reference);
    const result=await write.first<{revision:number}>();
    if(!result)throw new JobsError(409,'verification_conflict');
    await this.audit(actor,'EMPLOYER_VERIFICATION','COMPANY',companyId,'SUBMIT','SUCCESS',result.revision);
    return {state:'EVIDENCE_PENDING',revision:result.revision};
  }
  async reviewEmployerVerification(actor:Identity,companyId:string,state:'IN_REVIEW'|'VERIFIED'|'REJECTED'|'EXPIRED'|'UNVERIFIED',evidenceRef:string,revision:number,expiresAt?:number){
    await this.authorize(actor,'CASE_DECIDE',true);identifier(companyId);if(!['IN_REVIEW','VERIFIED','REJECTED','EXPIRED','UNVERIFIED'].includes(state))throw new JobsError(400,'invalid_verification');
    const evidence=bounded(evidenceRef,200);if(!/^[A-Za-z0-9_:/.-]+$/.test(evidence))throw new JobsError(400,'invalid_evidence_ref');
    if(expiresAt!==undefined&&(state!=='VERIFIED'||!Number.isSafeInteger(expiresAt)||expiresAt<=this.clock()))throw new JobsError(400,'invalid_expiry');
    const previous=state==='IN_REVIEW'?'EVIDENCE_PENDING':(state==='EXPIRED'||state==='UNVERIFIED')?'VERIFIED':'IN_REVIEW';
    const result=await this.db.prepare(`UPDATE employer_verifications SET state=?,reviewer=?,reviewed_at=?,expires_at=?,revision=revision+1
      WHERE company=? AND revision=? AND evidence_ref=? AND state=? RETURNING revision`)
      .bind(state,actor.subject,this.clock(),expiresAt??null,companyId,finiteRevision(revision),evidence,previous).first<{revision:number}>();
    if(!result)throw new JobsError(409,'verification_conflict');
    await this.audit(actor,'EMPLOYER_VERIFICATION','COMPANY',companyId,state,'SUCCESS',result.revision);
    return {company:companyId,state,revision:result.revision};
  }
  async purgeModerationEvidence(actor:Identity){await this.authorize(actor,'PRIVACY_REVIEW',true);
    const configured=await this.db.prepare("SELECT value FROM effective_jobs_policies WHERE key='retention_moderation_days'").first<{value:string}>();
    const days=configured?Number(JSON.parse(configured.value)):90,cutoff=this.clock()-days*86400000;
    const result=await this.db.prepare(`UPDATE moderation_events SET internal_note=NULL,evidence_ref=NULL WHERE case_id IN (
      SELECT c.id FROM moderation_cases c WHERE c.status='CLOSED' AND c.updated_at<=?
      AND NOT EXISTS(SELECT 1 FROM legal_holds h WHERE h.released_at IS NULL AND h.scope IN ('JOBS','MODERATION') AND (h.subject=c.reporter OR h.subject=c.target_ref)))
      AND (internal_note IS NOT NULL OR evidence_ref IS NOT NULL) RETURNING id`).bind(cutoff).all();
    await this.audit(actor,'RETENTION','MODERATION_EVIDENCE','BILLIONJOBS','PURGE');return {redacted:result.results.length};
  }
}
