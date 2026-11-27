import { afterAll, beforeAll, expect, it } from 'vitest';
import { createJobsRuntime, seedIdentity } from '../scripts/jobs-runtime.mjs';
import { JobsGovernance } from '../src/jobs/governance';
import { digest } from '../src/jobs/companies';
import { executeGovernanceExtension } from '../src/jobs/intelligence';
import { JobsPrivacy } from '../src/jobs/privacy';
import { JobsOperations } from '../src/jobs/operations';
import { Marketplace } from '../src/jobs/marketplace';
import { administrationPage } from '../src/jobs/governance-ui';
import { JSDOM } from 'jsdom';

let runtime:Awaited<ReturnType<typeof createJobsRuntime>>;
let governance:JobsGovernance;
const tokens={owner:'o'.repeat(43),recipient:'r'.repeat(43),stranger:'s'.repeat(43)};
const now=()=>Date.now();
const owner=()=>({subject:'owner',recipientHash:'',privilegedMfaAt:now(),reauthenticatedAt:now()});
const recipient=async()=>({subject:'recipient',recipientHash:await digest('recipient@example.invalid'),reauthenticatedAt:now()});
async function request(path:string,who:keyof typeof tokens='owner',method='GET',body?:unknown){return runtime.mf.dispatchFetch('http://localhost/api/jobs/v1/'+path,{method,headers:{Cookie:'bt_account_session='+tokens[who],Origin:'http://localhost','Content-Type':'application/json','X-Jobs-Request':'1'},body:body===undefined?undefined:JSON.stringify(body)});}
async function company(who:keyof typeof tokens='owner'){const r=await request('companies',who,'POST',{data:{name:'Synthetic',industry:'',description:'',website:'',location:'',size:'',businessEmail:''}});expect(r.status).toBe(201);return r.json() as Promise<{id:string;revision:number}>;}
beforeAll(async()=>{runtime=await createJobsRuntime({enabled:true});for(const [subject,token] of Object.entries(tokens)){await seedIdentity(runtime.accounts,subject,token);await runtime.jobs.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(subject).run();}governance=new JobsGovernance(runtime.jobs);},60000);
afterAll(async()=>{await runtime?.mf.dispose();});

it('denies administrative authority without MFA, role and recent reauthentication',async()=>{
  await runtime.bootstrapOwner('owner');
  await expect(runtime.bootstrapOwner('stranger')).rejects.toThrow('bootstrap unavailable');
  await expect(governance.dashboard({subject:'owner'})).rejects.toMatchObject({code:'admin_mfa_required'});
  await expect(governance.dashboard({subject:'stranger',privilegedMfaAt:now()})).rejects.toMatchObject({code:'admin_forbidden'});
  const summary=await governance.dashboard(owner());expect(summary.counts).toMatchObject({users:3,restricted_users:0});
  await expect(governance.enforce({subject:'owner',privilegedMfaAt:now()}, {caseId:'case',targetKind:'USER',targetRef:'stranger',kind:'WARNING',reasonCode:'ABUSE'})).rejects.toMatchObject({code:'admin_reauthentication_required'});
});
it('keeps reporter cases confidential, audits review, and requires human enforcement',async()=>{
  const created=await request('reports','owner','POST',{kind:'SCAM',targetRef:'stranger',category:'RECRUITMENT_FEE',detail:'Synthetic report'});expect(created.status).toBe(201);
  const {id}=await created.json() as {id:string};
  expect((await request('reports/'+id,'recipient')).status).toBe(404);
  const queue=await governance.cases(owner(),new URL('http://localhost/?status=OPEN'));expect(queue.rows).toEqual(expect.arrayContaining([expect.objectContaining({id})]));
  await governance.addCaseEvidence(owner(),id,'synthetic:document-1','Bounded local evidence reference');
  const privateCase=await governance.caseDetail(owner(),id);expect(privateCase.history).toEqual(expect.arrayContaining([expect.objectContaining({evidence_ref:'synthetic:document-1'})]));
  expect(JSON.stringify(await governance.ownCase({subject:'owner'},id))).not.toContain('synthetic:document-1');
  const result=await governance.decideCase(owner(),id,{revision:1,status:'RESOLVED',note:'Synthetic review'});expect(result.revision).toBe(2);
  await expect(governance.enforce(owner(),{caseId:id,targetKind:'USER',targetRef:'recipient',kind:'JOBS_TEMP',reasonCode:'WRONG_TARGET'})).rejects.toMatchObject({code:'case_target_mismatch'});
  const action=await governance.enforce(owner(),{caseId:id,targetKind:'USER',targetRef:'stranger',kind:'JOBS_TEMP',reasonCode:'SUBSTANTIATED',expiresAt:now()+86400000});
  expect(await governance.activeRestrictions('USER','stranger')).toEqual([expect.objectContaining({id:action.id})]);
  const appeal=await request('enforcement/'+action.id+'/appeals','stranger','POST',{reason:'Synthetic dispute'});expect(appeal.status).toBe(201);
  const appealId=(await appeal.json() as {id:string}).id;await expect(governance.resolveAppeal(owner(),appealId,1,true,'Reviewed evidence')).rejects.toMatchObject({code:'independent_reviewer_required'});
  await governance.grantRole(owner(),'recipient','MODERATOR');
  await governance.resolveAppeal({...owner(),subject:'recipient'},appealId,1,true,'Reviewed evidence');
  await governance.revokeRole(owner(),'recipient','MODERATOR');
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
  expect((await governance.revokeEnforcement(owner(),long.id,1,'REVIEWED')).remaining).toHaveLength(0);
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
  const signal=await runtime.jobs.prepare("SELECT id FROM fraud_signals WHERE rule='POTENTIAL_RECRUITMENT_FEE' AND target_ref=?").bind(c.id+'/synthetic_fee_listing').first<{id:string}>();
  await governance.reviewSignal(owner(),signal!.id,false);
  expect((await governance.scanCompany(owner(),c.id)).created).toBe(0);
  await runtime.jobs.prepare("UPDATE listing_details SET data=json_set(data,'$.description','Registration fee required before interview') WHERE company=?").bind(c.id).run();
  expect((await governance.scanCompany(owner(),c.id)).created).toBe(1);
  const next=await runtime.jobs.prepare("SELECT id FROM fraud_signals WHERE target_ref=? AND status='OPEN'").bind(c.id+'/synthetic_fee_listing').first<{id:string}>();
  const referral=await governance.reviewSignal(owner(),next!.id,true);
  expect((await governance.caseDetail(owner(),referral.caseId!)).record).toMatchObject({kind:'JOB',category:'POTENTIAL_RECRUITMENT_FEE'});
  expect((await runtime.jobs.prepare("SELECT count(*) n FROM enforcement_actions WHERE target_ref=?").bind(c.id+'/synthetic_fee_listing').first<{n:number}>())?.n).toBe(0);
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
  await governance.updatePolicy(owner(),'incident_escalation_hours',2,0);
  const incident=await governance.createIncident(owner(),'HIGH','Synthetic service interruption');
  expect(incident.reviewDueAt-now()).toBeGreaterThan(7190_000);
  await expect(governance.incidentTransition(owner(),incident.id,1,'RESOLVED','Skipped recovery')).rejects.toMatchObject({code:'incident_conflict'});
  const contained=await governance.incidentTransition(owner(),incident.id,1,'CONTAINED','Synthetic containment');
  expect(contained.revision).toBe(2);
  const correction=await governance.addCorrectiveAction(owner(),incident.id,'owner','Review dispatcher',now()+86400000);
  expect(correction.id).toBeTruthy();
  const analytics=await governance.operationalAnalytics(owner(),7);
  expect(analytics.period.days).toBe(7);
  expect(analytics.counts).not.toHaveProperty('candidate');
});
it('removes only the intended company listing from public discovery',async()=>{
  const first=await company(),second=await company('stranger'),listing='shared_listing_id',timestamp=now();
  for(const c of [first,second]){
    await runtime.jobs.prepare("INSERT INTO listings VALUES(?,?,'fingerprint','ACTIVE',?,1)").bind(c.id,listing,timestamp+86400000).run();
    await runtime.jobs.prepare("INSERT INTO listing_details VALUES(?,?,?,'PUBLISHED',1,?,?,?)")
      .bind(c.id,listing,JSON.stringify({title:'Synthetic listing',description:'Local fixture'}),timestamp,timestamp,timestamp).run();
  }
  const report=await governance.report({subject:'owner'},{kind:'JOB',targetRef:first.id+'/'+listing,category:'MISLEADING',detail:'Synthetic review'});
  const action=await governance.enforce(owner(),{caseId:report.id,targetKind:'LISTING',targetRef:first.id+'/'+listing,kind:'REMOVE_DISCOVERY',reasonCode:'MISLEADING'});
  expect((await request('companies/'+first.id+'/cases/'+report.id,'owner')).status).toBe(200);
  expect((await request('companies/'+first.id+'/cases/'+report.id,'stranger')).status).toBe(404);
  expect((await request('enforcement/'+action.id+'/appeals','stranger','POST',{reason:'Not my listing'})).status).toBe(404);
  expect((await request('enforcement/'+action.id+'/appeals','owner','POST',{reason:'Review our listing'})).status).toBe(201);
  const market=new Marketplace(runtime.jobs);
  await expect(market.publicListing(first.id,listing)).rejects.toMatchObject({status:404});
  expect((await market.publicListing(second.id,listing)).id).toBe(listing);
  const search=await market.search(new URL('http://localhost/jobs/search'));
  expect(search.items.some(item=>item.company===first.id&&item.id===listing)).toBe(false);
  expect(search.items.some(item=>item.company===second.id&&item.id===listing)).toBe(true);
  await expect(runtime.jobs.prepare("INSERT INTO application_requests(candidate,company,listing,request_key,payload,at) VALUES(?,?,?,?,?,?)")
    .bind('stranger',first.id,listing,'blocked','{}',now()).run()).rejects.toThrow('application_forbidden');
  await governance.revokeEnforcement(owner(),action.id,1,'RESTORE');
  expect((await market.publicListing(first.id,listing)).id).toBe(listing);
  const limited=await governance.moderateListing(owner(),report.id,{kind:'FEATURE',reasonCode:'APPLICATION_REVIEW'});
  expect((await market.publicListing(first.id,listing)).id).toBe(listing);
  await expect(runtime.jobs.prepare("INSERT INTO application_requests(candidate,company,listing,request_key,payload,at) VALUES(?,?,?,?,?,?)")
    .bind('stranger',first.id,listing,'blocked-again','{}',now()).run()).rejects.toThrow('application_forbidden');
  await governance.revokeEnforcement(owner(),limited.id,1,'RESTORE');
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
it('renders a responsive, labeled administration workspace without case details in the document',async()=>{
  const response=administrationPage();expect(response.headers.get('Cache-Control')).toContain('no-store');
  const html=await response.text();const dom=new JSDOM(html,{runScripts:'outside-only'});
  try{const document=dom.window.document;
    expect(document.querySelector('meta[name="viewport"]')).not.toBeNull();
    expect(document.querySelector('select#status')?.getAttribute('id')).toBe(document.querySelector('label[for="status"]')?.getAttribute('for'));
    expect(document.querySelectorAll('th[scope="col"]')).toHaveLength(4);
    expect(document.querySelector('button#next')?.getAttribute('type')).toBe('button');
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(html).not.toContain('Synthetic report');
  }finally{dom.window.close();}
});

it('changes delegated access through the role form, scoped dashboard and real Jobs router',async()=>{
  const {handleJobs}=await import('../src/jobs/api');
  await runtime.jobs.prepare("INSERT INTO jobs_users(subject,eligible,attested_at) VALUES('role-reviewer',1,0)").run();
  const base='http://localhost';
  // Only this test injects a trusted resolver. The production resolver still reads the shared session.
  const fetchAs=(subject:string,path:string,init:RequestInit={},recent=true)=>{
    const headers=new Headers(init.headers);
    headers.set('Origin',base);
    const request=new Request(new URL(path,base),{...init,headers});
    return handleJobs(request,true,runtime.jobs,async()=>({subject,privilegedMfaAt:now(),reauthenticatedAt:recent?now():0}));
  };
  const url='/api/jobs/v1/admin/roles';
  const page=await fetchAs('owner','/jobs/admin/roles');
  expect(page.status).toBe(200);
  const dom=new JSDOM(await page.text(),{url:base+'/jobs/admin/roles',runScripts:'outside-only'});
  try {
    dom.window.fetch=(path,init)=>fetchAs('owner',String(path),init);
    dom.window.eval(dom.window.document.querySelector('script')!.textContent!);
    const doc=dom.window.document;
    const select=doc.querySelector('select')!;
    await expect.poll(()=>select.options.length).toBe(7);
    doc.querySelector('input')!.value='role-reviewer';
    select.value='AUDITOR';
    doc.querySelector<HTMLButtonElement>('button[value="grant"]')!.click();
    await expect.poll(()=>doc.querySelector('ul')!.textContent).toContain('role-reviewer — AUDITOR');
    for(const [kind,q] of [['users','role-reviewer'],['companies','Synthetic']]){
      const page=await fetchAs('owner','/jobs/admin/'+kind);
      expect(page.status).toBe(200);
      const data=await fetchAs('owner','/api/jobs/v1/admin/'+kind+'?q='+q);
      expect(data.status).toBe(200);
      expect((await data.json() as {rows:unknown[]}).rows.length).toBeGreaterThan(0);
      const literal=await fetchAs('owner','/api/jobs/v1/admin/'+kind+'?q=%25');
      expect((await literal.json() as {rows:unknown[]}).rows).toEqual([]);
    }
    const analytics=await fetchAs('role-reviewer','/api/jobs/v1/admin/analytics');
    expect(Object.keys((await analytics.json() as {counts:object}).counts)).toEqual(['admin_events']);
    expect((await fetchAs('role-reviewer','/api/jobs/v1/admin/operations')).status).toBe(403);
    const dashboard=await fetchAs('role-reviewer','/api/jobs/v1/admin/dashboard');
    expect(dashboard.status).toBe(200);
    expect(Object.keys((await dashboard.json() as {counts:object}).counts).sort()).toEqual(['active_jobs','companies','recruiters','users']);
    expect((await fetchAs('role-reviewer',url)).status).toBe(403);
    const command={method:'POST',headers:{'X-Jobs-Request':'1','Content-Type':'application/json'},body:JSON.stringify({action:'revoke',subject:'role-reviewer',role:'AUDITOR'})};
    expect((await fetchAs('owner',url,command,false)).status).toBe(403);
    select.value='AUDITOR';
    doc.querySelector<HTMLButtonElement>('button[value="revoke"]')!.click();
    await expect.poll(()=>doc.querySelector('ul')!.textContent).not.toContain('role-reviewer — AUDITOR');
    expect((await fetchAs('role-reviewer','/api/jobs/v1/admin/dashboard')).status).toBe(403);
  } finally {dom.window.close();}
});

it('binds employer evidence to the company and serializes competing verification decisions',async()=>{
  const {handleJobs}=await import('../src/jobs/api');
  const companyId=crypto.randomUUID();
  await runtime.jobs.prepare("INSERT INTO jobs_users(subject,eligible,attested_at) VALUES('evidence-owner',1,0)").run();
  await runtime.jobs.prepare("INSERT INTO companies(id,owner,data,created_at) VALUES(?,'evidence-owner','{}',?)").bind(companyId,now()).run();
  const path='companies/'+companyId+'/verification', reference='synthetic:employer-document';
  async function call(subject:string,route:string,data?:object){
    const req=new Request('http://localhost/api/jobs/v1/'+route,{method:data?'POST':'GET',headers:{Origin:'http://localhost','X-Jobs-Request':'1','Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
    return handleJobs(req,true,runtime.jobs,async()=>({subject,privilegedMfaAt:now(),reauthenticatedAt:now()}));
  }
  const review=(state:string,revision:number)=>call('owner','admin/'+path,{state,reference,revision});
  expect((await call('owner',path)).status).toBe(403);
  expect((await call('evidence-owner',path,{reference,revision:0})).status).toBe(200);
  expect((await call('evidence-owner','admin/'+path)).status).toBe(403);
  expect((await review('VERIFIED',1)).status).toBe(409);
  expect((await review('IN_REVIEW',1)).status).toBe(200);
  const outcomes=await Promise.all([review('VERIFIED',2),review('VERIFIED',2)]);
  expect(outcomes.map(r=>r.status).sort()).toEqual([200,409]);
  expect((await review('UNVERIFIED',3)).status).toBe(200);
  expect((await call('evidence-owner',path,{reference,revision:4})).status).toBe(200);
  expect((await review('IN_REVIEW',5)).status).toBe(200);
  expect((await review('REJECTED',6)).status).toBe(200);
  expect(await (await call('evidence-owner',path)).json()).toMatchObject({state:'REJECTED',revision:7});
});

it('preserves an available owner across simultaneous suspensions, closure and grant revocation',async()=>{
  const db=runtime.jobs;
  const other='backup-owner';
  await db.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(other).run();
  await governance.grantRole(owner(),other,'PLATFORM_OWNER');
  const cases=await Promise.all(['owner',other].map(subject=>governance.report({subject:other},{kind:'CANDIDATE',targetRef:subject,category:'ABUSE',detail:'Synthetic fixture'})));
  const suspended=await Promise.allSettled(cases.map((c,i)=>governance.enforce(owner(),{caseId:c.id,targetKind:'USER',targetRef:i?other:'owner',kind:'JOBS_TEMP',reasonCode:'REVIEW',expiresAt:now()+60000})));
  expect(suspended.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const rows=(await db.prepare('SELECT subject FROM available_jobs_owners').all<{subject:string}>()).results;
  expect(rows).toHaveLength(1);
  const remaining=rows[0].subject;
  await expect(db.prepare('UPDATE jobs_users SET restricted=1 WHERE subject=?').bind(remaining).run()).rejects.toThrow('final_owner_protected');
  await expect(db.prepare('UPDATE jobs_users SET closed_at=? WHERE subject=?').bind(now(),remaining).run()).rejects.toThrow('final_owner_protected');
  await expect(db.prepare("UPDATE admin_grants SET revoked_at=? WHERE subject=? AND role='PLATFORM_OWNER'").bind(now(),remaining).run()).rejects.toThrow('final_owner_protected');
});

it('revokes only the selected company membership and rejects conflicting administrative requests',async()=>{
  const {handleJobs}=await import('../src/jobs/api');
  const db=runtime.jobs;
  for(const subject of ['member-reviewer','member-owner','member-target']){
    await db.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(subject).run();
  }
  await db.prepare("INSERT INTO admin_grants VALUES('member-reviewer','BILLIONJOBS','PRODUCT_ADMIN','fixture',?,NULL)").bind(now()).run();
  const companies=[crypto.randomUUID(),crypto.randomUUID()];
  for(const id of companies){
    await db.prepare("INSERT INTO companies(id,owner,data,created_at) VALUES(?,'member-owner','{}',?)").bind(id,now()).run();
    await db.prepare("INSERT INTO memberships VALUES(?,'member-target','RECRUITER',NULL)").bind(id).run();
    await db.prepare("INSERT INTO company_invitations(id,company,recipient_hash,token_hash,role,issuer,expires_at) VALUES(?,?,?,?,'RECRUITER','member-target',?)")
      .bind(crypto.randomUUID(),id,'synthetic',crypto.randomUUID(),now()+60000).run();
  }
  async function call(company:string,target='',subject='member-reviewer',fresh=true){
    const path='/api/jobs/v1/admin/companies/'+company+'/members'+(target?'/'+target:'');
    const req=new Request('http://localhost'+path,{method:target?'DELETE':'GET',headers:{Origin:'http://localhost','X-Jobs-Request':'1','Content-Type':'application/json'},body:target?JSON.stringify({revision:1}):undefined});
    return handleJobs(req,true,db,async()=>({subject,privilegedMfaAt:now(),reauthenticatedAt:fresh?now():0}));
  }
  expect((await call(companies[0],'','member-owner')).status).toBe(403);
  expect((await call(companies[0],'member-target','member-reviewer',false)).status).toBe(403);
  expect((await call(companies[0],'member-owner')).status).toBe(409);
  expect((await call(companies[0])).status).toBe(200);
  const results=await Promise.all([call(companies[0],'member-target'),call(companies[0],'member-target')]);
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  for(const [i,company] of companies.entries()){
    const members=await (await call(company)).json() as {rows:{subject:string;revoked_at:number|null}[]};
    expect(members.rows.find(row=>row.subject==='member-target')?.revoked_at===null).toBe(i===1);
    const invite=await db.prepare("SELECT revoked_at FROM company_invitations WHERE company=? AND issuer='member-target'").bind(company).first<{revoked_at:number|null}>();
    expect(invite?.revoked_at===null).toBe(i===1);
  }
  expect(await db.prepare("SELECT count(*) n FROM admin_audit WHERE target_ref=? AND action='REVOKE'").bind(companies[0]+'/member-target').first()).toEqual({n:1});
});

it('requires a matching case and a fresh privileged session for Jobs account decisions',async()=>{
  const {handleJobs}=await import('../src/jobs/api');
  const db=runtime.jobs,subject='account-target',reviewer='account-reviewer';
  await seedIdentity(runtime.accounts,subject,'account-fixture'.padEnd(43,'x'));
  for(const id of [subject,reviewer])await db.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(id).run();
  await db.prepare("INSERT INTO admin_grants VALUES(?,'BILLIONJOBS','PRODUCT_ADMIN','fixture',?,NULL)").bind(reviewer,now()).run();
  const actor={subject:reviewer,privilegedMfaAt:now(),reauthenticatedAt:now()};
  const report=await governance.report({subject:reviewer},{kind:'CANDIDATE',targetRef:subject,detail:'Synthetic account case',category:'ABUSE'});
  const account='users/'+subject;
  async function call(path:string,data?:object,recent=true){
    return handleJobs(new Request('http://localhost/api/jobs/v1/admin/'+path,{method:data?'POST':'GET',headers:{Origin:'http://localhost','X-Jobs-Request':'1','Content-Type':'application/json'},body:data?JSON.stringify(data):undefined}),true,db,async()=>({...actor,reauthenticatedAt:recent?now():0}));
  }
  expect((await call(account)).status).toBe(200);
  const command={kind:'JOBS_TEMP',caseId:report.id,reasonCode:'ABUSE',expiresAt:now()+60000};
  expect((await call(account+'/actions',command,false)).status).toBe(403);
  expect((await call(account+'/actions',{...command,caseId:'wrong-case'})).status).toBe(409);
  const action=await call(account+'/actions',command);
  expect(action.status).toBe(201);
  const {id}=await action.json() as {id:string};
  expect((await call('actions/'+id+'/revoke',{revision:1,reason:''})).status).toBe(400);
  expect(await governance.activeRestrictions('USER',subject)).toHaveLength(1);
  expect((await call('actions/'+id+'/revoke',{revision:1,reason:'REVIEWED'})).status).toBe(200);
  expect((await call(account+'/closure',{caseId:report.id})).status).toBe(409);
  await governance.decideCase(actor,report.id,{revision:1,status:'RESOLVED',note:'Synthetic decision'});
  await db.prepare("INSERT INTO legal_holds VALUES('account-hold',?,'TEST','CLOSURE',?,?,?,NULL,NULL)").bind(subject,reviewer,now(),now()+60000).run();
  expect((await call(account+'/closure',{caseId:report.id})).status).toBe(409);
  await db.prepare("UPDATE legal_holds SET released_at=? WHERE id='account-hold'").bind(now()).run();
  expect((await call(account+'/closure',{caseId:report.id})).status).toBe(200);
  expect((await call(account+'/closure',{caseId:report.id})).status).toBe(409);
  expect(await runtime.accounts.prepare('SELECT status FROM accounts WHERE id=?').bind(subject).first()).toEqual({status:'ACTIVE'});
});

it('limits investigation evidence and reporter identity to authorized investigators',async()=>{
  const db=runtime.jobs;
  for(const [subject,role] of [['case-investigator','MODERATOR'],['case-support','SUPPORT']]){
    await db.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(subject).run();
    await db.prepare("INSERT INTO admin_grants VALUES(?,'BILLIONJOBS',?,'fixture',?,NULL)").bind(subject,role,now()).run();
  }
  const investigator={subject:'case-investigator',privilegedMfaAt:now()};
  const support={subject:'case-support',privilegedMfaAt:now()};
  const report=await governance.report(investigator,{kind:'JOB',targetRef:'company/listing',category:'FEE',detail:'Private complaint text'});
  await governance.addCaseEvidence(investigator,report.id,'synthetic:private','Private case note');
  const limited=await governance.caseDetail(support,report.id);
  expect(limited.record).not.toHaveProperty('reporter');
  expect(JSON.stringify(limited.history)).not.toMatch(/private|case-investigator/i);
  expect((await governance.caseDetail(investigator,report.id)).record).toHaveProperty('reporter',investigator.subject);
  const decision={revision:1,status:'RESOLVED' as const,note:'Case decision',category:'RECRUITMENT_FEE',severity:'HIGH'};
  await expect(governance.decideCase(support,report.id,decision)).rejects.toMatchObject({code:'admin_forbidden'});
  await expect(governance.decideCase(investigator,report.id,{...decision,assignee:support.subject})).rejects.toMatchObject({code:'case_conflict'});
  const outcomes=await Promise.allSettled([governance.decideCase(investigator,report.id,decision),governance.decideCase(investigator,report.id,decision)]);
  expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);
  await expect(governance.addCaseEvidence(investigator,report.id,'synthetic:late','Late')).rejects.toMatchObject({code:'case_closed'});
});

it('revalidates the seven product roles at privileged read and write boundaries',async()=>{
  const {handleJobs}=await import('../src/jobs/api');
  const db=runtime.jobs;
  const matrix=[
    ['PLATFORM_OWNER',200,200,200,200,200],
    ['PRODUCT_ADMIN',200,403,200,200,403],
    ['SECURITY_ADMIN',403,403,200,200,200],
    ['MODERATOR',200,403,403,200,403],
    ['SUPPORT',403,403,403,200,403],
    ['PRIVACY_ADMIN',403,403,200,200,403],
    ['AUDITOR',403,403,200,403,403]
  ] as const;
  for(const [role,signals,roles,audit,cases,operations] of matrix){
    const subject='matrix-'+role;
    await db.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(subject).run();
    await db.prepare("INSERT INTO admin_grants VALUES(?,'BILLIONJOBS',?,'local-fixture',?,NULL)").bind(subject,role,now()).run();
    const call=(path:string,mfa=true)=>handleJobs(new Request('http://localhost/api/jobs/v1/admin/'+path),true,db,async()=>({subject,privilegedMfaAt:mfa?now():0}));
    for(const [path,status] of [['signals',signals],['roles',roles],['audit',audit],['cases',cases],['operations',operations]] as const){
      expect((await call(path)).status,role+' '+path).toBe(status);
      expect((await call(path,false)).status).toBe(403);
    }
    const mutation=new Request('http://localhost/api/jobs/v1/admin/roles',{method:'POST',headers:{Origin:'http://localhost','X-Jobs-Request':'1','Content-Type':'application/json'},body:JSON.stringify({action:'grant',subject,role:'PLATFORM_OWNER'})});
    expect((await handleJobs(mutation,true,db,async()=>({subject,privilegedMfaAt:now(),reauthenticatedAt:now()}))).status).toBe(403);
  }
});

it('limits transfer cancellation to the sender and decline to the bound recipient',async()=>{
  const db=runtime.jobs,companyId=crypto.randomUUID();
  for(const subject of ['transfer-owner','transfer-recipient'])await db.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(subject).run();
  await db.prepare("INSERT INTO companies(id,owner,data,created_at) VALUES(?,'transfer-owner','{}',?)").bind(companyId,now()).run();
  const sender={subject:'transfer-owner',reauthenticatedAt:now()},email='transfer@example.invalid';
  const receiver={subject:'transfer-recipient',reauthenticatedAt:now(),recipientHash:await digest(email)};
  const create=()=>governance.requestOwnershipTransfer(sender,companyId,receiver.subject,email,1);
  const first=await create(),url=new URL('http://localhost');
  expect(JSON.stringify(await governance.ownershipWorkspace(receiver,url))).not.toContain(first.token);
  expect((await governance.ownershipWorkspace({...receiver,recipientHash:'other'},url)).requests).toHaveLength(0);
  await expect(governance.endTransfer(sender,first.id,true)).rejects.toMatchObject({code:'transfer_unavailable'});
  await expect(governance.endTransfer({...receiver,reauthenticatedAt:0},first.id,true)).rejects.toMatchObject({code:'reauthentication_required'});
  await governance.endTransfer(receiver,first.id,true);
  await expect(governance.acceptOwnershipTransfer(receiver,first.id,first.token)).rejects.toMatchObject({code:'transfer_not_found'});
  const second=await create();
  await governance.endTransfer(sender,second.id,false);
  expect(await db.prepare('SELECT owner FROM companies WHERE id=?').bind(companyId).first()).toEqual({owner:sender.subject});
});

it('delivers exactly one approved export per request and scopes audit search to its actor',async()=>{
  const user={subject:'case-review-export',reauthenticatedAt:now()};
  await runtime.jobs.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(user.subject).run();
  const admin={subject:'matrix-PRIVACY_ADMIN',privilegedMfaAt:now(),reauthenticatedAt:now()};
  const privacy=new JobsPrivacy(runtime.jobs);
  const first=await governance.requestPrivacy(user,'EXPORT');
  await expect(governance.requestPrivacy(user,'EXPORT')).rejects.toMatchObject({code:'request_pending'});
  const second=await governance.requestPrivacy({subject:'case-support',reauthenticatedAt:now()},'EXPORT');
  await governance.completePrivacy(admin,first.id,true,'REVIEWED');
  await governance.completePrivacy(admin,second.id,true,'REVIEWED');
  await expect(privacy.exportOwn({...user,subject:'case-support'},first.id)).rejects.toMatchObject({code:'export_review_required'});
  const attempts=await Promise.allSettled([privacy.exportOwn(user,first.id),privacy.exportOwn(user,first.id)]);
  expect(attempts.filter(a=>a.status==='fulfilled')).toHaveLength(1);
  expect(await runtime.jobs.prepare('SELECT status FROM privacy_requests WHERE id=?').bind(second.id).first()).toEqual({status:'REVIEWING'});
  const audit=await governance.auditPage(admin,new URL('http://localhost/?actor='+user.subject+'&action=EXPORT_DELIVERY&target_ref='+first.id));
  expect(audit.rows).toHaveLength(1);
});

it('keeps deletion under review through retention and legal hold and replays subject cleanup after restoration',async()=>{
  const db=runtime.jobs,subject='retention-target',operator='retention-operator',at=now();
  for(const who of [subject,operator])await db.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(who).run();
  await db.prepare("INSERT INTO admin_grants VALUES(?,'BILLIONJOBS','PRIVACY_ADMIN','fixture',?,NULL)").bind(operator,at).run();
  await db.prepare("INSERT INTO platform_roles VALUES(?,'PRIVACY_OPERATOR',NULL)").bind(operator).run();
  const gov=new JobsGovernance(db,()=>at),actor={subject:operator,privilegedMfaAt:at,reauthenticatedAt:at};
  const user={subject,reauthenticatedAt:at};
  const request=await gov.requestPrivacy(user,'DELETE');
  await db.prepare("INSERT INTO jobs_consent_events(id,subject,purpose,notice_version,granted,at) VALUES('retention-consent',?,'OPTIONAL_ANALYTICS','BJ-privacy-v1',1,?)").bind(subject,at).run();
  await gov.completePrivacy(actor,request.id,true,'REQUEST_VERIFIED');
  await new JobsPrivacy(db,()=>at).purge(actor);
  expect(await db.prepare('SELECT status FROM privacy_requests WHERE id=?').bind(request.id).first()).toEqual({status:'REVIEWING'});
  const later=at+31*86400000,privacy=new JobsPrivacy(db,()=>later);
  const hold=await gov.legalHold(actor,subject,'JOBS','DISPUTE',at+86400000);
  await privacy.purge(actor);
  expect(await db.prepare('SELECT id FROM jobs_consent_events WHERE subject=?').bind(subject).first()).not.toBeNull();
  await gov.releaseHold(actor,hold.id);
  await privacy.purge(actor);
  expect(await db.prepare('SELECT status FROM privacy_requests WHERE id=?').bind(request.id).first()).toEqual({status:'COMPLETED'});
  expect(await db.prepare('SELECT id FROM jobs_consent_events WHERE subject=?').bind(subject).first()).toBeNull();
  await db.prepare('UPDATE restore_gate SET ready=0 WHERE id=1').run();
  await db.prepare("INSERT INTO jobs_consent_events(id,subject,purpose,notice_version,granted,at) VALUES('restored-consent',?,'OPTIONAL_ANALYTICS','BJ-privacy-v1',1,?)").bind(subject,at).run();
  await privacy.replayDeletionLedger(actor,[],[{requestId:request.id,subject,at:later}]);
  expect(await db.prepare('SELECT id FROM jobs_consent_events WHERE subject=?').bind(subject).first()).toBeNull();
  expect(await db.prepare('SELECT ready FROM restore_gate WHERE id=1').first()).toEqual({ready:1});
});

it('atomically enforces effective listing policy revisions through retries and IST rollover',async()=>{
  const {PostingQuota}=await import('../src/jobs/quota');
  let at=Date.parse('2026-12-01T18:29:59Z');
  const db=runtime.jobs,subject='policy-employer',admin={subject:'matrix-PRODUCT_ADMIN',privilegedMfaAt:at,reauthenticatedAt:at};
  const gov=new JobsGovernance(db,()=>at),quota=new PostingQuota(db,()=>at),company=crypto.randomUUID();
  await db.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(subject).run();
  await db.prepare("INSERT INTO companies(id,owner,data,created_at) VALUES(?,?,'{}',?)").bind(company,subject,at).run();
  const future=at+1000;
  await gov.updatePolicy(admin,'listing_daily_limit',2,0,at);
  await gov.updatePolicy(admin,'listing_validity_days',4,0,future);
  await gov.updatePolicy(admin,'listing_active_limit',3,0,future);
  const post=(key:string)=>quota.apply({subject},{company,listing:key,key,operation:'CREATE',revision:0,vacancy:{position:key,location:'X',department:'Y',arrangement:'Z'}});
  const attempts=await Promise.allSettled(['one','two','three','four'].map(post));
  expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(2);
  for(const result of attempts)if(result.status==='fulfilled')expect(result.value.expiresAt).toBe(at+30*86400000);
  at=future;
  const outcomes=await Promise.allSettled(['five','six'].map(post));
  expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const accepted=outcomes[0].status==='fulfilled'?'five':'six';
  expect((await post(accepted)).expiresAt).toBe(at+4*86400000);
  await expect(post('seven')).rejects.toMatchObject({code:'active_limit'});
  await expect(gov.updatePolicy(admin,'listing_active_limit',31,1)).rejects.toMatchObject({code:'invalid_policy'});
});

it('keeps disputed ownership within case review and prevents self-review or a direct owner change',async()=>{
  const db=runtime.jobs,reviewer={subject:'matrix-PLATFORM_OWNER',privilegedMfaAt:now(),reauthenticatedAt:now()};
  const member={subject:'transfer-recipient',reauthenticatedAt:now()};
  const c=await db.prepare("SELECT id FROM companies WHERE owner='transfer-owner' LIMIT 1").first<{id:string}>();
  await db.prepare("INSERT INTO memberships VALUES(?,?,'RECRUITER',NULL)").bind(c!.id,member.subject).run();
  const request=await governance.requestRecovery(member,c!.id,'UNAVAILABLE_OWNER','synthetic:record');
  expect((await governance.ownershipRecovery({subject:'case-support'},false,new URL('http://local'))).rows).toEqual([]);
  await expect(governance.updateRecovery(member,request.id,{revision:1,status:'CLOSED',note:'Mine'},true)).rejects.toMatchObject({status:403});
  await governance.updateRecovery(reviewer,request.id,{revision:1,status:'REVIEWING',note:'Case received'},true);
  await governance.updateRecovery(reviewer,request.id,{revision:2,status:'MORE_INFO',note:'Clarify evidence'},true);
  await governance.updateRecovery(member,request.id,{revision:3,status:'REVIEWING',note:'synthetic:additional'},false);
  await governance.updateRecovery(reviewer,request.id,{revision:4,status:'CLOSED',note:'Normal transfer required'},true);
  expect(await db.prepare('SELECT owner FROM companies WHERE id=?').bind(c!.id).first()).toEqual({owner:'transfer-owner'});
});

it('records local assistance without sending report text and rejects nested or oversized provider data',async()=>{
  const reviewer={subject:'case-investigator',privilegedMfaAt:now()};
  const c=await runtime.jobs.prepare('SELECT id FROM moderation_cases LIMIT 1').first<{id:string}>();
  const guidance=await governance.assistCase(reviewer,c!.id);
  expect(guidance).toMatchObject({humanReviewRequired:true,automaticDecision:false});
  expect(await runtime.jobs.prepare('SELECT target_ref FROM admin_audit WHERE id=?').bind(guidance.auditRef).first()).toEqual({target_ref:c!.id});
  await expect(governance.assistCase({...reviewer,subject:'case-support'},c!.id)).rejects.toMatchObject({status:403});
  const base={purpose:'SCAM_REVIEW' as const,caseRef:'synthetic',authorized:true};
  for(const data of [{ruleIds:[{email:'hidden'}]},{signalCount:-1},{redactedCaseSummary:'test@example.invalid'}]){
    await expect(executeGovernanceExtension({...base,data})).rejects.toMatchObject({status:403});
  }
  const fake={name:'fixture',model:'local',version:'1',run:async()=>({text:'human review',attributes:{oversized:'a'.repeat(2500)}})};
  expect((await executeGovernanceExtension({...base,data:{severity:'LOW'}},fake)).fallback).toMatchObject({reason:'provider_timeout_or_invalid'});
});

it('recovers persisted meeting and reminder work after interruption without duplicate activation or notification',async()=>{
  const {Interviews}=await import('../src/jobs/interviews');
  const localState='ops-'+crypto.randomUUID().replaceAll('-','').slice(0,10);
  let instance=await createJobsRuntime({enabled:true,localState});
  const at=now(),ownerSubject='dispatch-owner',actor={subject:ownerSubject,privilegedMfaAt:at,reauthenticatedAt:at};
  let activations=0;
  const adapter={version:'billiontalks-meetings.v1' as const,activate:async()=>{activations++;return {meetingRef:'local-meeting',joinPath:'/local'}},revoke:async()=>{},authorizeJoin:async()=>({meetingRef:'local-meeting',joinPath:'/local'})};
  try{
    await seedIdentity(instance.accounts,ownerSubject);
    const db=instance.jobs;
    await db.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(ownerSubject).run();
    await instance.bootstrapOwner(ownerSubject);
    await db.prepare("INSERT INTO applications(id,candidate,company,listing,attempt,status,snapshot,created_at,updated_at) VALUES('app',?,'co','listing',1,'SUBMITTED','{}',?,?)").bind(ownerSubject,at,at).run();
    await db.prepare("INSERT INTO interviews(id,application,company,listing,round,title,instructions,duration_minutes,scheduling_timezone,state,revision,created_by,created_at,updated_at) VALUES('interview','app','co','listing',1,'Test','',30,'UTC','CONFIRMED',1,?,?,?)").bind(ownerSubject,at,at).run();
    await db.prepare("INSERT INTO interview_slots(id,interview,starts_at,ends_at,original_timezone,expires_at,status,created_at) VALUES('slot','interview',?,?,'UTC',?,'CONFIRMED',?)").bind(new Date(at+1800000).toISOString(),new Date(at+3600000).toISOString(),at+86400000,at).run();
    await db.prepare("UPDATE interviews SET confirmed_slot='slot' WHERE id='interview'").run();
    await db.prepare("INSERT INTO interview_meeting_outbox VALUES('job','interview',1,'ACTIVATE','{}','PENDING',0,?,NULL,?,?)").bind(at,at,at).run();
    await db.prepare("INSERT INTO meeting_outbox_leases VALUES('job','interrupted',?)").bind(at+1000).run();
    expect((await new JobsOperations(db,()=>at).queueReminders(actor)).queued).toBe(2);
    await instance.mf.dispose();instance=await createJobsRuntime({enabled:true,localState});
    let clock=at;
    const interviews=new Interviews(instance.jobs,adapter,()=>clock);
    expect((await interviews.reconcile()).processed).toBe(0);
    clock+=1001;
    await Promise.all([interviews.reconcile(),interviews.reconcile()]);
    expect(activations).toBe(1);
    expect(await instance.jobs.prepare("SELECT status,attempts FROM interview_meeting_outbox WHERE id='job'").first()).toEqual({status:'COMPLETED',attempts:1});
    const operations=new JobsOperations(instance.jobs,()=>clock);
    const dispatched=await Promise.all([operations.dispatchReminders(actor),operations.dispatchReminders(actor)]);
    expect(dispatched.reduce((n,r)=>n+r.delivered,0)).toBe(2);
    expect(await instance.jobs.prepare("SELECT count(*) n FROM jobs_notifications WHERE kind='INTERVIEW_REMINDER'").first()).toEqual({n:2});
    // Lose the response after adapter activation, then cancel before the next process retries.
    await instance.jobs.prepare("UPDATE interview_meeting_outbox SET status='PENDING',payload='{}',attempts=0 WHERE id='job'").run();
    await instance.jobs.prepare("UPDATE interviews SET meeting_ref=NULL WHERE id='interview'").run();
    let remoteActive=false;
    const uncertain={...adapter,activate:async()=>{remoteActive=true;throw new Error('lost response')},
      findActivation:async()=>remoteActive?'local-meeting':null,revoke:async()=>{remoteActive=false}};
    await new Interviews(instance.jobs,uncertain,()=>clock).reconcile();
    expect(remoteActive).toBe(true);
    await instance.jobs.prepare("UPDATE interviews SET state='CANCELLED',revision=2 WHERE id='interview'").run();
    await instance.mf.dispose();instance=await createJobsRuntime({enabled:true,localState});
    clock+=3000;
    await new Interviews(instance.jobs,uncertain,()=>clock).reconcile();
    expect(remoteActive).toBe(false);
    expect(await instance.jobs.prepare("SELECT status FROM interview_meeting_outbox WHERE id='job'").first()).toEqual({status:'COMPLETED'});
  }finally{await instance.mf.dispose();}
},60000);

it('explains every approved deterministic indicator and preserves below-threshold decisions',async()=>{
  const {detectCompanySignals}=await import('../src/jobs/governance');
  const below={postings:7,complaints:2,recruitment:49,interviews:29};
  const listing=(id:string,description:string)=>({id,data:JSON.stringify({title:'Engineer',location:'Pune',description})});
  expect(detectCompanySignals('co',[listing('a','Work on products'),listing('b','Support engineers')],below,8).indicators).toEqual([]);
  const result=detectCompanySignals('co',[listing('a','Registration fee'),listing('b','Guaranteed placement'),listing('c','Synthetic')],{postings:8,complaints:3,recruitment:50,interviews:30},8);
  expect(result.indicators.map(x=>x.rule).sort()).toEqual(['POSTING_FREQUENCY','REPEATED_COMPLAINTS','RECRUITER_ACTIVITY_VOLUME','INTERVIEW_WORKFLOW_VOLUME','POTENTIAL_RECRUITMENT_FEE','MISLEADING_CLAIM','REPEATED_DUPLICATE'].sort());
  expect(result.indicators.find(x=>x.rule==='POTENTIAL_RECRUITMENT_FEE')?.target).toBe('co/a');
});

it('bridges existing listing and company reports into confidential case tracking',async()=>{
  const db=runtime.jobs,reporter='case-support';
  const company=await db.prepare('SELECT id FROM companies LIMIT 1').first<{id:string}>();
  await db.prepare("INSERT INTO company_reports(id,company,reporter,reason,detail,at) VALUES('legacy-form',?,?,'ABUSE','Company form evidence',?)").bind(company!.id,reporter,now()).run();
  await db.prepare("INSERT INTO listing_reports(id,company,listing,reporter,reason,detail,at) VALUES('legacy-form',?,'listing',?,'FRAUD','Listing form evidence',?)").bind(company!.id,reporter,now()).run();
  const cases=await governance.reportedCases({subject:reporter},new URL('http://localhost'));
  expect(cases.rows).toEqual(expect.arrayContaining([expect.objectContaining({id:'company-legacy-form'}),expect.objectContaining({id:'listing-legacy-form'})]));
  expect(JSON.stringify(cases)).not.toContain('form evidence');
  const moderator={subject:'matrix-MODERATOR',privilegedMfaAt:now()};
  const detail=await governance.caseDetail(moderator,'listing-legacy-form');
  expect(detail.history).toEqual(expect.arrayContaining([expect.objectContaining({internal_note:'Listing form evidence'})]));
  await expect(governance.ownCase({subject:'case-investigator'},'company-legacy-form')).rejects.toMatchObject({status:404});
});

it('enforces timed employer verification on the directory, review and resubmission surfaces',async()=>{
  const db=runtime.jobs,at=now(),company=crypto.randomUUID();
  const submitter={subject:'evidence-owner'},reviewer={subject:'matrix-MODERATOR',privilegedMfaAt:at,reauthenticatedAt:at};
  await db.prepare("INSERT INTO companies(id,owner,data,created_at) VALUES(?,?,'{\"name\":\"Expiry fixture\"}',?)").bind(company,submitter.subject,at).run();
  let clock=at;
  const gov=new JobsGovernance(db,()=>clock);
  await gov.submitEmployerEvidence(submitter,company,{reference:'synthetic:expiry',revision:0});
  await gov.reviewEmployerVerification(reviewer,company,'IN_REVIEW','synthetic:expiry',1);
  await gov.reviewEmployerVerification(reviewer,company,'VERIFIED','synthetic:expiry',2,at+1000);
  clock+=1000;
  expect(await gov.employerEvidence(submitter,company,false)).toMatchObject({state:'EXPIRED'});
  expect((await gov.companies(reviewer,new URL('http://local/?q=Expiry'))).rows).toContainEqual(expect.objectContaining({id:company,employer_verification:'EXPIRED'}));
  expect(await gov.submitEmployerEvidence(submitter,company,{reference:'synthetic:renewal',revision:3})).toMatchObject({revision:4});
});

it('rolls back sensitive changes when the local audit append fails',async()=>{
  const db=runtime.jobs,at=now(),actor={subject:'matrix-PLATFORM_OWNER',privilegedMfaAt:at,reauthenticatedAt:at};
  await db.prepare("CREATE TRIGGER audit_failure_fixture BEFORE INSERT ON admin_audit WHEN NEW.purpose IN ('SECURITY_INCIDENT','LEGAL_HOLD','PRIVACY_NOTICE') BEGIN SELECT RAISE(ABORT,'audit_unavailable'); END").run();
  try{
    await expect(governance.createIncident(actor,'HIGH','Rollback fixture')).rejects.toThrow('audit_unavailable');
    await expect(governance.legalHold(actor,'stranger','JOBS','ROLLBACK',at+86400000)).rejects.toThrow('audit_unavailable');
    await expect(governance.publishPrivacyNotice(actor,'BJ-rollback','Synthetic')).rejects.toThrow('audit_unavailable');
    expect(await db.prepare("SELECT id FROM security_incidents WHERE summary='Rollback fixture'").first()).toBeNull();
    expect(await db.prepare("SELECT id FROM legal_holds WHERE reason_code='ROLLBACK'").first()).toBeNull();
    expect(await db.prepare("SELECT version FROM jobs_privacy_notices WHERE version='BJ-rollback'").first()).toBeNull();
    expect(await db.prepare("SELECT version FROM jobs_privacy_notices WHERE active=1").first()).not.toBeNull();
  }finally{await db.prepare('DROP TRIGGER audit_failure_fixture').run();}
});

it('replays profile, application, interview, notification, case and grant deletion from one Jobs snapshot',async()=>{
  const db=runtime.jobs,subject='snapshot-subject',at=now(),actor={subject:'retention-operator',privilegedMfaAt:at,reauthenticatedAt:at};
  await db.batch([
    db.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(subject),
    db.prepare("INSERT INTO jobs_profiles VALUES(?,'snapshot-profile',1,'{}','[]','PRIVATE',0,?)").bind(subject,at),
    db.prepare("INSERT INTO applications(id,candidate,company,listing,attempt,status,snapshot,created_at,updated_at) VALUES('snapshot-app',?,'co','listing',1,'SUBMITTED','{}',?,?)").bind(subject,at,at),
    db.prepare("INSERT INTO interviews(id,application,company,listing,round,title,instructions,duration_minutes,scheduling_timezone,state,revision,created_by,created_at,updated_at) VALUES('snapshot-interview','snapshot-app','co','listing',1,'Synthetic','',30,'UTC','CANCELLED',1,?,?,?)").bind(subject,at,at),
    db.prepare("INSERT INTO jobs_notifications VALUES('snapshot-note',?,'snapshot-app','snapshot-key','SYNTHETIC','{}',?,NULL)").bind(subject,at),
    db.prepare("INSERT INTO saved_jobs VALUES(?,'co','listing',?)").bind(subject,at),
    db.prepare("INSERT INTO admin_grants VALUES(?,'BILLIONJOBS','SUPPORT','fixture',?,NULL)").bind(subject,at),
    db.prepare("INSERT INTO moderation_cases(id,kind,target_ref,reporter,category,severity,status,created_at,updated_at) VALUES('snapshot-case','CANDIDATE',?,'fixture','PRIVACY','LOW','CLOSED',?,?)").bind(subject,at,at),
    db.prepare("INSERT INTO moderation_events VALUES('snapshot-evidence','snapshot-case','fixture','STATUS','CLOSED','private','synthetic:private',?)").bind(at),
    db.prepare("INSERT INTO privacy_requests VALUES('snapshot-request',?,'DELETE','REVIEWING',NULL,?,NULL)").bind(subject,at),
    db.prepare('UPDATE restore_gate SET ready=0 WHERE id=1')
  ]);
  const privacy=new JobsPrivacy(db);
  await privacy.replayDeletionLedger(actor,['snapshot-profile','snapshot-app'].map(record=>({record,subject,at})),[{requestId:'snapshot-request',subject,at}]);
  for(const table of ['jobs_profiles','applications','interviews','jobs_notifications']){
    expect(await db.prepare('SELECT id FROM '+table+" WHERE id LIKE 'snapshot-%'").first()).toBeNull();
  }
  expect(await db.prepare('SELECT candidate FROM saved_jobs WHERE candidate=?').bind(subject).first()).toBeNull();
  expect(await db.prepare("SELECT internal_note,evidence_ref FROM moderation_events WHERE id='snapshot-evidence'").first()).toEqual({internal_note:null,evidence_ref:null});
  expect(await db.prepare('SELECT revoked_at FROM admin_grants WHERE subject=?').bind(subject).first()).toEqual({revoked_at:at});
  expect(await db.prepare("SELECT status FROM privacy_requests WHERE id='snapshot-request'").first()).toEqual({status:'COMPLETED'});
  expect(await db.prepare('SELECT ready FROM restore_gate WHERE id=1').first()).toEqual({ready:1});
});

it('propagates temporary enforcement and expiry across discovery, applications, recruitment and interview admission',async()=>{
  const {Recruitment}=await import('../src/jobs/recruitment'),{Interviews}=await import('../src/jobs/interviews');
  const db=runtime.jobs,at=now(),subject='matrix-cross-surface',companyId=crypto.randomUUID(),actor={subject,recipientHash:'verified'};
  await db.batch([
    db.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(subject),
    db.prepare("INSERT INTO companies(id,owner,data,created_at) VALUES(?,'matrix-PLATFORM_OWNER','{}',?)").bind(companyId,at),
    db.prepare("INSERT INTO memberships VALUES(?,?,'RECRUITER',NULL)").bind(companyId,subject),
    db.prepare("INSERT INTO jobs_profiles VALUES(?,'matrix-public-profile',1,?,?,'PUBLIC',0,?)").bind(subject,JSON.stringify({name:'Matrix candidate'}),JSON.stringify(['name']),at),
    db.prepare("INSERT INTO listings VALUES(?,'matrix-vacancy','matrix','ACTIVE',?,1)").bind(companyId,at+86400000),
    db.prepare("INSERT INTO listing_details VALUES(?,'matrix-vacancy',?,'PUBLISHED',1,?,?,?)").bind(companyId,JSON.stringify({title:'Matrix vacancy'}),at,at,at),
    db.prepare("INSERT INTO applications(id,candidate,company,listing,attempt,status,snapshot,created_at,updated_at) VALUES('matrix-interview-app',?,?,'historical-listing',1,'SUBMITTED','{}',?,?)").bind(subject,companyId,at,at),
    db.prepare("INSERT INTO interviews(id,application,company,listing,round,title,instructions,duration_minutes,scheduling_timezone,state,revision,created_by,created_at,updated_at,meeting_ref,meeting_state) VALUES('matrix-admission','matrix-interview-app',?,'historical-listing',1,'Synthetic','',30,'UTC','CONFIRMED',1,?,?,?,'matrix-meeting','ACTIVE')").bind(companyId,subject,at,at),
    db.prepare("INSERT INTO interview_slots(id,interview,starts_at,ends_at,original_timezone,expires_at,status,created_at) VALUES('matrix-slot','matrix-admission',?,?,'UTC',?,'CONFIRMED',?)").bind(new Date(at).toISOString(),new Date(at+1800000).toISOString(),at+86400000,at),
    db.prepare("UPDATE interviews SET confirmed_slot='matrix-slot' WHERE id='matrix-admission'")
  ]);
  const recruiter={subject:'matrix-observer',recipientHash:'verified'};
  await db.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(recruiter.subject).run();
  await db.prepare("INSERT INTO memberships VALUES(?,?,'RECRUITER',NULL)").bind(companyId,recruiter.subject).run();
  const market=new Marketplace(db),recruit=new Recruitment(db);
  const interviews=new Interviews(db,{version:'billiontalks-meetings.v1',activate:async()=>{throw Error('unexpected')},revoke:async()=>{},authorizeJoin:async()=>({joinPath:'/fixture'})});
  const report=await governance.report(recruiter,{kind:'CANDIDATE',targetRef:subject,category:'MISLEADING',detail:'Fixture'});
  const decision=await governance.enforce({subject:'matrix-PLATFORM_OWNER',privilegedMfaAt:at,reauthenticatedAt:at},{caseId:report.id,targetKind:'USER',targetRef:subject,kind:'JOBS_TEMP',reasonCode:'REVIEW',expiresAt:at+60000});
  const query=new URL('http://localhost/?q=Matrix%20candidate');
  const visible=async()=>(await recruit.discover(recruiter,query)).items.some(item=>item.id==='matrix-public-profile');
  expect(await visible()).toBe(false);
  const apply=()=>market.apply(actor,companyId,'matrix-vacancy',{fields:['name'],key:'matrix-submission'});
  const join=()=>interviews.join(actor,'matrix-admission','Synthetic');
  for(const operation of [apply,()=>recruit.discover(actor,query),join])await expect(operation()).rejects.toMatchObject({status:403});
  // Advance this synthetic action's interval without modifying any process-wide clock.
  await db.prepare('UPDATE enforcement_actions SET starts_at=?,expires_at=? WHERE id=?').bind(at-60000,at-1,decision.id).run();
  expect(await visible()).toBe(true);
  await expect(recruit.discover(actor,query)).resolves.toMatchObject({total:1});
  await expect(join()).resolves.toEqual({joinPath:'/fixture'});
  await expect(apply()).resolves.toBeDefined();
});

it('enforces report capacity concurrently and limits period drilldowns to authorized aggregates',async()=>{
  const at=now(),db=runtime.jobs,subject='burst-reporter',actor={subject:'matrix-PLATFORM_OWNER',privilegedMfaAt:at,reauthenticatedAt:at};
  await db.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(subject).run();
  const attempts=await Promise.allSettled(Array.from({length:7},()=>governance.report({subject},{kind:'HARASSMENT',targetRef:'synthetic',category:'CAPACITY',detail:'Private evidence'})));
  expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(5);
  for(const r of attempts)if(r.status==='rejected')expect(r.reason).toMatchObject({status:429});
  const report=await governance.operationalAnalytics(actor,7,'reported');
  expect(report.breakdown).toContainEqual(expect.objectContaining({category:'HARASSMENT'}));
  expect(JSON.stringify(report.breakdown)).not.toContain(subject);
  expect((report.breakdown as {count:number}[]).every(r=>r.count>=5)).toBe(true);
  await expect(governance.operationalAnalytics({...actor,subject:'matrix-AUDITOR'},7,'reported')).rejects.toMatchObject({code:'metric_forbidden'});
  const hold=await governance.legalHold(actor,subject,'MODERATION','REVIEW',at+86400000);
  await governance.reviewHold(actor,hold.id,at+86400000,at+2*86400000);
  await expect(governance.reviewHold(actor,hold.id,at+86400000,at+3*86400000)).rejects.toMatchObject({code:'hold_conflict'});
  await governance.releaseHold(actor,hold.id);
});
