import { afterAll, beforeAll, expect, it } from 'vitest';
import { createJobsRuntime, seedIdentity } from '../scripts/jobs-runtime.mjs';
import { JobsGovernance } from '../src/jobs/governance';
import { digest } from '../src/jobs/companies';
import { executeGovernanceExtension } from '../src/jobs/intelligence';
import { JobsPrivacy } from '../src/jobs/privacy';
import { JobsOperations } from '../src/jobs/operations';

let runtime:Awaited<ReturnType<typeof createJobsRuntime>>;
let governance:JobsGovernance;
const tokens={owner:'o'.repeat(43),recipient:'r'.repeat(43),stranger:'s'.repeat(43)};
const now=()=>Date.now();
const owner=()=>({subject:'owner',recipientHash:'',privilegedMfaAt:now(),reauthenticatedAt:now()});
const recipient=async()=>({subject:'recipient',recipientHash:await digest('recipient@example.invalid'),reauthenticatedAt:now()});
async function request(path:string,who:keyof typeof tokens='owner',method='GET',body?:unknown){return runtime.mf.dispatchFetch('http://localhost/api/jobs/v1/'+path,{method,headers:{Cookie:'bt_account_session='+tokens[who],Origin:'http://localhost','Content-Type':'application/json','X-Jobs-Request':'1'},body:body===undefined?undefined:JSON.stringify(body)});}
async function company(){const r=await request('companies','owner','POST',{data:{name:'Synthetic',industry:'',description:'',website:'',location:'',size:'',businessEmail:''}});expect(r.status).toBe(201);return r.json() as Promise<{id:string;revision:number}>;}
beforeAll(async()=>{runtime=await createJobsRuntime({enabled:true});for(const [subject,token] of Object.entries(tokens)){await seedIdentity(runtime.accounts,subject,token);await runtime.jobs.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(subject).run();}governance=new JobsGovernance(runtime.jobs);},60000);
afterAll(async()=>{await runtime?.mf.dispose();});

it('denies administrative authority without MFA, role and recent reauthentication',async()=>{
  await runtime.jobs.prepare("INSERT INTO admin_grants VALUES('owner','BILLIONJOBS','PLATFORM_OWNER','synthetic_fixture',?,NULL)").bind(now()).run();
  await expect(governance.dashboard({subject:'owner'})).rejects.toMatchObject({code:'admin_mfa_required'});
  await expect(governance.dashboard({subject:'stranger',privilegedMfaAt:now()})).rejects.toMatchObject({code:'admin_forbidden'});
  const summary=await governance.dashboard(owner());expect(summary.counts).toMatchObject({users:3,restricted_users:0});
  await expect(governance.enforce({subject:'owner',privilegedMfaAt:now()}, {caseId:'case',targetKind:'USER',targetRef:'stranger',kind:'WARNING',reasonCode:'ABUSE'})).rejects.toMatchObject({code:'admin_reauthentication_required'});
});
it('keeps reporter cases confidential, audits review, and requires human enforcement',async()=>{
  const created=await request('reports','stranger','POST',{kind:'SCAM',targetRef:'listing_1',category:'RECRUITMENT_FEE',detail:'Synthetic report'});expect(created.status).toBe(201);
  const {id}=await created.json() as {id:string};
  expect((await request('reports/'+id,'recipient')).status).toBe(404);
  const queue=await governance.cases(owner(),new URL('http://localhost/?status=OPEN'));expect(queue.rows).toEqual(expect.arrayContaining([expect.objectContaining({id})]));
  const result=await governance.decideCase(owner(),id,{revision:1,status:'RESOLVED',note:'Synthetic review'});expect(result.revision).toBe(2);
  const action=await governance.enforce(owner(),{caseId:id,targetKind:'USER',targetRef:'stranger',kind:'JOBS_TEMP',reasonCode:'SUBSTANTIATED',expiresAt:now()+86400000});
  expect(await governance.activeRestrictions('USER','stranger')).toEqual([expect.objectContaining({id:action.id})]);
  const appeal=await request('enforcement/'+action.id+'/appeals','stranger','POST',{reason:'Synthetic dispute'});expect(appeal.status).toBe(201);
  const appealId=(await appeal.json() as {id:string}).id;await governance.resolveAppeal(owner(),appealId,1,true,'Reviewed evidence');
  expect(await governance.activeRestrictions('USER','stranger')).toHaveLength(0);
  const audit=await governance.auditPage(owner(),new URL('http://localhost/'));expect(audit.rows.length).toBeGreaterThan(0);
  await expect(runtime.jobs.prepare('DELETE FROM admin_audit').run()).rejects.toThrow();
});
it('transfers ownership only by expiring single-use acceptance and permits retirement before closure',async()=>{
  const c=await company();
  await expect(governance.requestOwnershipTransfer({subject:'owner'},c.id,'recipient','recipient@example.invalid',c.revision)).rejects.toMatchObject({code:'reauthentication_required'});
  const transfer=await governance.requestOwnershipTransfer(owner(),c.id,'recipient','recipient@example.invalid',c.revision);
  await expect(governance.acceptOwnershipTransfer({subject:'stranger',recipientHash:await digest('stranger@example.invalid')},transfer.id,transfer.token)).rejects.toMatchObject({code:'transfer_not_found'});
  const accepted=await governance.acceptOwnershipTransfer(await recipient(),transfer.id,transfer.token);expect(accepted.accepted).toBe(true);
  await expect(governance.acceptOwnershipTransfer(await recipient(),transfer.id,transfer.token)).rejects.toMatchObject({code:'transfer_not_found'});
  expect((await runtime.jobs.prepare('SELECT owner FROM companies WHERE id=?').bind(c.id).first<{owner:string}>())?.owner).toBe('recipient');
  expect((await request('closure','recipient','POST',{})).status).toBe(409);
  const current=await runtime.jobs.prepare('SELECT revision FROM companies WHERE id=?').bind(c.id).first<{revision:number}>();
  await governance.retireCompany(await recipient(),c.id,'OWNER_REQUEST',current!.revision);
  expect((await request('closure','recipient','POST',{})).status).toBe(200);
});
it('rechecks role grants, preserves a final owner, and respects overlapping restrictions',async()=>{
  await expect(governance.revokeRole(owner(),'owner','PLATFORM_OWNER')).rejects.toMatchObject({code:'final_owner_protected'});
  await expect(governance.grantRole(owner(),'owner','MODERATOR')).rejects.toMatchObject({code:'self_grant_forbidden'});
  await governance.grantRole(owner(),'stranger','MODERATOR');
  await governance.authorize({subject:'stranger',privilegedMfaAt:now()},'CASE_READ');
  await governance.revokeRole(owner(),'stranger','MODERATOR');
  await expect(governance.authorize({subject:'stranger',privilegedMfaAt:now()},'CASE_READ')).rejects.toMatchObject({code:'admin_forbidden'});
  const report=await governance.report({subject:'owner'},{kind:'CANDIDATE',targetRef:'stranger',category:'ABUSE',detail:'Synthetic evidence'});
  const short=await governance.enforce(owner(),{caseId:report.id,targetKind:'USER',targetRef:'stranger',kind:'JOBS_TEMP',reasonCode:'TEST',expiresAt:now()+60_000});
  const long=await governance.enforce(owner(),{caseId:report.id,targetKind:'USER',targetRef:'stranger',kind:'JOBS_PERMANENT',reasonCode:'TEST'});
  await runtime.jobs.prepare('UPDATE enforcement_actions SET expires_at=0 WHERE id=?').bind(short.id).run();
  expect(await governance.activeRestrictions('USER','stranger')).toEqual([expect.objectContaining({id:long.id})]);
  expect((await request('status','stranger')).status).toBe(403);
  await runtime.jobs.prepare('UPDATE enforcement_actions SET revoked_at=? WHERE id=?').bind(now(),long.id).run();
});
it('requires active legal holds to be released before completing deletion review',async()=>{
  await runtime.jobs.prepare("INSERT INTO admin_grants VALUES('owner','BILLIONJOBS','PRIVACY_ADMIN','synthetic_fixture',?,NULL)").bind(now()).run();
  const privacyActor=owner();
  const requested=await governance.requestPrivacy({subject:'stranger',reauthenticatedAt:now()},'DELETE');
  const hold=await governance.legalHold(privacyActor,'stranger','JOBS','DISPUTE',now()+86400000);
  await expect(governance.completePrivacy(privacyActor,requested.id,true,'APPROVED')).rejects.toMatchObject({code:'legal_hold_active'});
  await governance.releaseHold(privacyActor,hold.id);
  await expect(governance.completePrivacy(privacyActor,requested.id,false,'NOT_ELIGIBLE')).resolves.toMatchObject({status:'DENIED'});
});
it('keeps governance AI assistance optional, bounded and human reviewed',async()=>{
  const fallback=await executeGovernanceExtension({purpose:'SCAM_REVIEW',authorized:true,caseRef:'case_1',data:{ruleIds:['POTENTIAL_RECRUITMENT_FEE']}});
  expect(fallback).toMatchObject({automaticDecision:false,humanReviewRequired:true,fallback:{used:false,reason:'provider_not_configured'}});
  await expect(executeGovernanceExtension({purpose:'SCAM_REVIEW',authorized:true,caseRef:'case_1',data:{email:'private@example.invalid'}})).rejects.toMatchObject({code:'governance_intelligence_forbidden'});
  const mock={name:'synthetic',model:'none',version:'1',run:async()=>({text:'Review the listing manually.'})} as const;
  const output=await executeGovernanceExtension({purpose:'SCAM_REVIEW',authorized:true,caseRef:'case_1',data:{ruleIds:['POTENTIAL_RECRUITMENT_FEE']}},mock);
  expect(output).toMatchObject({automaticDecision:false,output:{humanApprovalRequired:true,automaticAction:false}});
});
it('exports only requester-owned Jobs records after recent reauthentication',async()=>{
  const privacy=new JobsPrivacy(runtime.jobs);
  await expect(privacy.exportOwn({subject:'owner'})).rejects.toMatchObject({code:'reauthentication_required'});
  const request=await governance.requestPrivacy({subject:'owner',reauthenticatedAt:now()},'EXPORT');
  await expect(privacy.exportOwn({subject:'owner',reauthenticatedAt:now()})).rejects.toMatchObject({code:'export_review_required'});
  await governance.completePrivacy(owner(),request.id,true,'APPROVED');
  const exported=await privacy.exportOwn({subject:'owner',reauthenticatedAt:now()});
  expect(exported).toMatchObject({product:'BILLIONJOBS',subject:'owner'});
  expect(JSON.stringify(exported)).not.toContain('recruitment_notes');
  expect(JSON.stringify(exported)).not.toContain('account_password');
});
it('deduplicates explainable fraud indicators without enforcing automatically',async()=>{
  const c=await company();
  await runtime.jobs.prepare("INSERT INTO listing_details(company,id,data,publication,revision,created_at,updated_at) VALUES(?,?,?,'DRAFT',0,?,?)")
    .bind(c.id,'synthetic_fee_listing',JSON.stringify({title:'Engineer',location:'Chennai',description:'Registration fee required'}),now(),now()).run();
  const first=await governance.scanCompany(owner(),c.id);
  expect(first.indicators).toEqual([expect.objectContaining({rule:'POTENTIAL_RECRUITMENT_FEE',humanReviewRequired:true})]);
  expect(first.created).toBe(1);
  const again=await governance.scanCompany(owner(),c.id);expect(again.created).toBe(0);
  const signal=await runtime.jobs.prepare("SELECT id FROM fraud_signals WHERE rule='POTENTIAL_RECRUITMENT_FEE' AND target_ref='synthetic_fee_listing'").first<{id:string}>();
  await governance.reviewSignal(owner(),signal!.id,false);
  expect((await runtime.jobs.prepare("SELECT count(*) n FROM enforcement_actions WHERE target_ref='synthetic_fee_listing'").first<{n:number}>())?.n).toBe(0);
});
it('expires transfer requests and permits only one concurrent recipient acceptance',async()=>{
  const c=await company();const target={subject:'stranger',recipientHash:await digest('stranger@example.invalid')};
  const expired=await governance.requestOwnershipTransfer(owner(),c.id,'stranger','stranger@example.invalid',c.revision);
  await runtime.jobs.prepare('UPDATE ownership_transfers SET expires_at=0 WHERE id=?').bind(expired.id).run();
  await expect(governance.acceptOwnershipTransfer(target,expired.id,expired.token)).rejects.toMatchObject({code:'transfer_not_found'});
  const next=await governance.requestOwnershipTransfer(owner(),c.id,'stranger','stranger@example.invalid',c.revision);
  const attempts=await Promise.allSettled([governance.acceptOwnershipTransfer(target,next.id,next.token),governance.acceptOwnershipTransfer(target,next.id,next.token)]);
  expect(attempts.filter(a=>a.status==='fulfilled')).toHaveLength(1);
  expect((await runtime.jobs.prepare('SELECT count(*) n FROM company_ownership_history WHERE company=?').bind(c.id).first<{n:number}>())?.n).toBe(1);
});
it('versions operational policy and records incident containment without exporting case evidence',async()=>{
  const updated=await governance.updatePolicy(owner(),'moderation_daily_signal_threshold',6,0);
  expect(updated.revision).toBe(1);
  await expect(governance.updatePolicy(owner(),'moderation_daily_signal_threshold',7,0)).rejects.toMatchObject({code:'policy_conflict'});
  await expect(governance.updatePolicy(owner(),'retention_application_days',30,0)).rejects.toMatchObject({code:'invalid_policy'});
  const incident=await governance.createIncident(owner(),'HIGH','Synthetic service interruption');
  await expect(governance.incidentTransition(owner(),incident.id,1,'RESOLVED','Skipped recovery')).rejects.toMatchObject({code:'incident_conflict'});
  const contained=await governance.incidentTransition(owner(),incident.id,1,'CONTAINED','Synthetic containment');
  expect(contained.revision).toBe(2);
  const correction=await governance.addCorrectiveAction(owner(),incident.id,'owner','Review dispatcher',now()+86400000);
  expect(correction.id).toBeTruthy();
  const analytics=await governance.operationalAnalytics(owner(),7);
  expect(analytics.period.days).toBe(7);
  expect(analytics.counts).not.toHaveProperty('candidate');
});
it('persists and deduplicates in-app reminder dispatch and skips stale interview revisions',async()=>{
  const c=await company(),id='synthetic_reminder_interview',application='synthetic_reminder_application';
  const start=new Date(now()+30*60_000).toISOString(),end=new Date(now()+60*60_000).toISOString();
  await runtime.jobs.prepare("INSERT INTO applications(id,candidate,company,listing,attempt,status,snapshot,created_at,updated_at) VALUES(?,?,?,'listing',1,'SUBMITTED','{}',?,?)").bind(application,'stranger',c.id,now(),now()).run();
  await runtime.jobs.prepare("INSERT INTO interviews(id,application,company,listing,round,title,instructions,duration_minutes,scheduling_timezone,state,revision,created_by,created_at,updated_at) VALUES(?,?,?,'listing',1,'Synthetic interview','',30,'Asia/Kolkata','CONFIRMED',1,'owner',?,?)").bind(id,application,c.id,now(),now()).run();
  await runtime.jobs.prepare("INSERT INTO interview_slots(id,interview,starts_at,ends_at,original_timezone,expires_at,status,created_at) VALUES('reminder_slot',?,?,?,'Asia/Kolkata',?,'CONFIRMED',?)").bind(id,start,end,now()+86400000,now()).run();
  await runtime.jobs.prepare("UPDATE interviews SET confirmed_slot='reminder_slot' WHERE id=?").bind(id).run();
  const operations=new JobsOperations(runtime.jobs);
  expect((await operations.queueReminders(owner())).queued).toBe(2);
  expect((await operations.queueReminders(owner())).queued).toBe(0);
  expect((await operations.dispatchReminders(owner())).delivered).toBe(2);
  expect((await operations.dispatchReminders(owner())).delivered).toBe(0);
  expect((await runtime.jobs.prepare("SELECT count(*) n FROM jobs_notifications WHERE application=? AND kind='INTERVIEW_REMINDER'").bind(application).first<{n:number}>())?.n).toBe(2);
  await runtime.jobs.prepare('UPDATE interviews SET revision=2 WHERE id=?').bind(id).run();
  await runtime.jobs.prepare("UPDATE interview_reminder_outbox SET status='PENDING',next_attempt_at=0 WHERE interview=?").bind(id).run();
  expect((await operations.dispatchReminders(owner())).stale).toBe(2);
});
it('keeps Jobs consent versioned and independent of shared account data',async()=>{
  await governance.publishPrivacyNotice(owner(),'BJ-privacy-v1','Synthetic local notice');
  const grant=await governance.recordConsent({subject:'stranger'},'OPTIONAL_ANALYTICS',true);
  expect(grant).toMatchObject({noticeVersion:'BJ-privacy-v1',granted:true});
  await governance.recordConsent({subject:'stranger'},'OPTIONAL_ANALYTICS',false);
  const events=(await runtime.jobs.prepare("SELECT granted FROM jobs_consent_events WHERE subject='stranger' AND purpose='OPTIONAL_ANALYTICS' ORDER BY at,id").all<{granted:number}>()).results;
  expect(events.map(e=>e.granted).sort()).toEqual([0,1]);
  expect((await runtime.accounts.prepare("SELECT status FROM accounts WHERE id='stranger'").first<{status:string}>())?.status).toBe('ACTIVE');
});
