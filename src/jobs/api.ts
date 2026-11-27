import { Companies } from './companies';
import { companyPage } from './company-ui';
import { JobsError, type IdentityResolver, type JobsDatabase, type MeetingsAdapterV1 } from "./contracts";
import { requireEligible } from "./permissions";
import { JobsPrivacy } from "./privacy";
import { Marketplace } from './marketplace';
import { candidateJobsPage, jobPage, manageJobsPage, searchPage } from './marketplace-ui';
import { Profiles } from "./profiles";
import { profilePage, sharedProfilePage, signInPage } from "./profile-ui";
import { Recruitment } from './recruitment';
import { applicantReviewPage, applicantsPage, candidateStatusPage, discoveryPage, notificationsPage, recruiterDashboardPage } from './recruiter-ui';
import { JobsOperations } from './operations';
import { Interviews } from './interviews';
import { interviewPage, interviewsPage } from './interview-ui';
import { JobsGovernance, type AdminRole } from './governance';
import { administrationPage, analyticsPage, operationsPage, incidentWorkspacePage, policyWorkspacePage, auditWorkspacePage, privacyWorkspacePage, ownershipRecoveryPage, ownershipPage, signalsPage, reportsPage, appealsPage, moderationCasePage, accountReviewPage, companyMembersPage, directoryPage, employerVerificationPage, roleManagementPage } from './governance-ui';

export function isJobsPath(path: string): boolean { return path === "/jobs" || path.startsWith("/jobs/") || path === "/api/jobs/v1" || path.startsWith("/api/jobs/v1/"); }
function reply(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } });
}
export async function handleJobs(request: Request, enabled: boolean, db: JobsDatabase | undefined, identity: IdentityResolver, meetings?:MeetingsAdapterV1): Promise<Response> {
  if (!enabled) return reply(404, { error: "not_found" });
  try {
    if (!db) throw new JobsError(503, "jobs_unavailable");
    const gate = await db.prepare("SELECT ready FROM restore_gate WHERE id=1").first<{ ready: number }>();
    if (gate?.ready !== 1) throw new JobsError(503, "restore_pending");
    const actor = await identity(request);
    const path = new URL(request.url).pathname;
    const profiles = new Profiles(db);
    const marketplace = new Marketplace(db);
    const recruitment = new Recruitment(db);
    const interviews = new Interviews(db,meetings);
    if (path === '/jobs/search' && request.method === 'GET') return searchPage();
    if (path === '/api/jobs/v1/jobs' && request.method === 'GET') return reply(200, await marketplace.search(new URL(request.url)));
    const publicJob = path.match(/^\/api\/jobs\/v1\/jobs\/([\w-]+)\/([\w-]+)$/);
    if (publicJob && request.method === 'GET') return reply(200, await marketplace.publicListing(publicJob[1],publicJob[2]));
    const publicJobPage = path.match(/^\/jobs\/jobs\/([\w-]+)\/([\w-]+)$/);
    if (publicJobPage && request.method === 'GET') {
      await marketplace.publicListing(publicJobPage[1],publicJobPage[2]);
      return jobPage(publicJobPage[1],publicJobPage[2]);
    }
    const shared = path.match(/^\/(?:api\/jobs\/v1|jobs)\/profiles\/([^/]+)$/);
    if (shared && request.method === 'GET') {
      const result = await profiles.shared(shared[1], actor);
      return path.startsWith('/api/') ? reply(200, { profile: result.fields }) : sharedProfilePage(result.fields, result.indexing);
    }
    if (!actor) return (path === '/jobs' || path === '/jobs/profile' || path === '/jobs/companies' || path === '/jobs/saved' || path === '/jobs/applications' || path === '/jobs/notifications' || path === '/jobs/interviews' || path === '/jobs/recruitment/discovery' || /^\/jobs\/applications\/[\w-]+$/.test(path) || /^\/jobs\/interviews\/[\w-]+$/.test(path) || /^\/jobs\/companies\/[\w-]+\/jobs$/.test(path) || path.startsWith('/jobs/recruitment/')) && request.method === 'GET' ? signInPage() : reply(401, {error:'authentication_required'});
    if ((path === '/jobs' || path === '/jobs/profile') && request.method === 'GET') return profilePage();
    if (path === '/api/jobs/v1/status' && request.method === 'GET') {
      const enrolled = await db.prepare('SELECT subject FROM jobs_users WHERE subject=?').bind(actor.subject).first();
      if (enrolled) await requireEligible(db, actor);
      return reply(200, {enrolled:!!enrolled});
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      if (request.headers.get("Origin") !== new URL(request.url).origin || request.headers.get("Sec-Fetch-Site") === "cross-site" || request.headers.get("X-Jobs-Request") !== "1") throw new JobsError(403, "csrf_rejected");
    }
    if (path === "/api/jobs/v1/eligibility" && request.method === "POST") {
      const body = await readBody(request, 256);
      if (!body || typeof body !== "object" || Object.keys(body).join() !== "over18" || typeof (body as { over18: unknown }).over18 !== "boolean") throw new JobsError(400, "invalid_body");
      const eligible = (body as { over18: boolean }).over18;
      // A denied/closed/restricted record cannot be self-reactivated by retrying.
      await db.prepare("INSERT OR IGNORE INTO jobs_users(subject,eligible,attested_at) VALUES(?,?,?)").bind(actor.subject, Number(eligible), Date.now()).run();
      await requireEligible(db, actor);
      return reply(200, { eligible: true });
    }
    const governance=new JobsGovernance(db);
    const appealRoute=path.match(/^\/api\/jobs\/v1\/enforcement\/([\w-]+)\/appeals$/);
    if(appealRoute&&request.method==='POST'){const input=await readBody(request,2048) as {reason?:unknown};return reply(201,await governance.appeal(actor,appealRoute[1],input?.reason as string));}
    const ownCase=path.match(/^\/api\/jobs\/v1\/reports\/([\w-]+)$/);
    if(ownCase&&request.method==='GET')return reply(200,await governance.ownCase(actor,ownCase[1]));
    const companyCase=path.match(/^\/api\/jobs\/v1\/companies\/([\w-]+)\/cases\/([\w-]+)$/);
    if(companyCase&&request.method==='GET')return reply(200,await governance.companyCaseStatus(actor,companyCase[1],companyCase[2]));
    if(path==='/jobs/reports' && request.method==='GET')return reportsPage();
    if(path==='/api/jobs/v1/reports' && request.method==='GET')return reply(200,await governance.reportedCases(actor,new URL(request.url)));
    const appealsView=path.match(/^\/jobs\/(admin\/)?appeals$/);
    if(appealsView&&request.method==='GET'){
      if(appealsView[1])await governance.authorize(actor,'APPEAL_REVIEW');
      return appealsPage(!!appealsView[1]);
    }
    const appealsApi=path.match(/^\/api\/jobs\/v1\/(admin\/)?appeals(?:\/([\w-]+))?$/);
    if(appealsApi){
      const admin=!!appealsApi[1],id=appealsApi[2];
      if(request.method==='GET')return reply(200,id?await governance.appealReview(actor,id,admin):await governance.appeals(actor,admin,new URL(request.url)));
      if(request.method==='POST'&&id)return reply(200,await governance.progressAppeal(actor,id,admin,await readBody(request,8192)));
    }
    if(path==='/jobs/privacy'&&request.method==='GET')return privacyWorkspacePage(false);
    if(path==='/api/jobs/v1/privacy'&&request.method==='GET')return reply(200,await governance.privacyWorkspace(actor,false,new URL(request.url)));
    await requireEligible(db, actor);
    const privacyView=path.match(/^\/jobs\/(admin\/)?privacy$/);
    if(privacyView&&request.method==='GET'){
      if(privacyView[1])await governance.authorize(actor,'PRIVACY_REVIEW');
      return privacyWorkspacePage(!!privacyView[1]);
    }
    const privacyApi=path.match(/^\/api\/jobs\/v1\/(admin\/)?privacy(?:\/(requests|consent|notice|holds|purge)(?:\/([\w-]+))?)?$/);
    if(privacyApi){
      const [,privileged,section,id]=privacyApi,admin=!!privileged;
      if(request.method==='GET'&&!section)return reply(200,await governance.privacyWorkspace(actor,admin,new URL(request.url)));
      if(request.method==='POST'){
        const b=await readBody(request,8192) as {kind:'EXPORT'|'DELETE';purpose:'OPTIONAL_ANALYTICS'|'PUBLIC_INDEXING';granted:boolean;version:string;summary:string;approved:boolean;reason:string;subject:string;scope:string;reviewAt:number;previousReviewAt:number};
        if(!b||typeof b!=='object')throw new JobsError(400,'invalid_input');
        if(!admin&&section==='requests'&&!id)return reply(201,await governance.requestPrivacy(actor,b.kind));
        if(!admin&&section==='consent'&&!id){
          if(typeof b.version!=='string')throw new JobsError(400,'notice_version_required');
          return reply(201,await governance.recordConsent(actor,b.purpose,b.granted,b.version));
        }
        if(!admin&&section==='requests'&&id){
          const response=reply(200,await new JobsPrivacy(db).exportOwn(actor,id));
          response.headers.set('Content-Disposition','attachment; filename="jobs-export.json"');return response;
        }
        if(admin&&section==='requests'&&id)return reply(200,await governance.completePrivacy(actor,id,b.approved,b.reason));
        if(admin&&section==='notice'&&!id)return reply(201,await governance.publishPrivacyNotice(actor,b.version,b.summary));
        if(admin&&section==='purge'&&!id){await new JobsPrivacy(db).purgeDueRecordsForReview(actor);return reply(200,{processed:true});}
        if(admin&&section==='holds'&&id&&b.reviewAt!==undefined)return reply(200,await governance.reviewHold(actor,id,b.previousReviewAt,b.reviewAt));
        if(admin&&section==='holds')return id?reply(200,await governance.releaseHold(actor,id)):reply(201,await governance.legalHold(actor,b.subject,b.scope,b.reason,b.reviewAt));
      }
    }
    const recoveryPage=path.match(/^\/jobs\/(admin\/)?ownership-recovery$/);
    if(recoveryPage&&request.method==='GET'){
      if(recoveryPage[1])await governance.authorize(actor,'ROLE_GRANT',true);
      return ownershipRecoveryPage(!!recoveryPage[1]);
    }
    const ownershipRecovery=path.match(/^\/api\/jobs\/v1\/(admin\/)?ownership-recovery(?:\/([\w-]+))?$/);
    if(ownershipRecovery){
      const admin=!!ownershipRecovery[1],id=ownershipRecovery[2];
      if(!id&&request.method==='GET')return reply(200,await governance.ownershipRecovery(actor,admin,new URL(request.url)));
      if(request.method==='POST'){
        const body=await readBody(request,2048) as {company:string;kind:string;reference:string};
        if(!body)throw new JobsError(400,'invalid_input');
        if(id)return reply(200,await governance.updateRecovery(actor,id,body,admin));
        if(!admin)return reply(201,await governance.requestRecovery(actor,body.company,body.kind,body.reference));
      }
    }
    if(path==='/jobs/ownership'&&request.method==='GET')return ownershipPage();
    if(path==='/api/jobs/v1/ownership'&&request.method==='GET')return reply(200,await governance.ownershipWorkspace(actor,new URL(request.url)));
    const transferCommand=path.match(/^\/api\/jobs\/v1\/ownership\/([\w-]+)\/(request|retire|accept|decline|cancel)$/);
    if(transferCommand && request.method==='POST'){
      const [,id,op]=transferCommand;
      const body=await readBody(request,2048) as {subject:string;email:string;token:string;revision:number;reason:string};
      if(!body||typeof body!=='object')throw new JobsError(400,'invalid_input');
      if(op==='request')return reply(201,await governance.requestOwnershipTransfer(actor,id,body.subject,body.email,body.revision));
      if(op==='retire')return reply(200,await governance.retireCompany(actor,id,body.reason,body.revision));
      if(op==='accept')return reply(200,await governance.acceptOwnershipTransfer(actor,id,body.token));
      return reply(200,await governance.endTransfer(actor,id,op==='decline'));
    }
    if(path==='/api/jobs/v1/reports'&&request.method==='POST')return reply(201,await governance.report(actor,await readBody(request,4096)));
    if(path==='/jobs/admin'&&request.method==='GET'){const allowed=await governance.authorize(actor,'DASHBOARD');return administrationPage(allowed.has('CASE_READ'),allowed.has('ROLE_GRANT'),allowed.has('APPEAL_REVIEW'),allowed.has('CASE_DECIDE'),allowed.has('PRIVACY_REVIEW'),allowed.has('AUDIT_READ'),allowed.has('POLICY'),allowed.has('INCIDENT'));}
    if((path==='/jobs/admin/users'||path==='/jobs/admin/companies') && request.method==='GET'){
      const allowed=await governance.authorize(actor,'DASHBOARD');
      return directoryPage(path.endsWith('/users')?'users':'companies',allowed.has('CASE_DECIDE'),allowed.has('ENFORCE'));
    }
    if(path==='/jobs/admin/analytics'&&request.method==='GET'){await governance.authorize(actor,'DASHBOARD');return analyticsPage();}
    if(path==='/jobs/admin/operations'&&request.method==='GET'){await governance.authorize(actor,'INCIDENT');return operationsPage();}
    const recovery=path.match(/^\/api\/jobs\/v1\/admin\/operations\/(reconcile|queue-reminders|dispatch-reminders|retry)(?:\/([\w-]+))?$/);
    if(recovery&&request.method==='POST'){
      await governance.authorize(actor,'INCIDENT',true);
      const [,op,id]=recovery,operations=new JobsOperations(db);
      if(op==='retry'&&id){const body=await readBody(request,256) as {reminder:boolean};if(typeof body?.reminder!=='boolean')throw new JobsError(400,'invalid_input');return reply(200,await governance.retryOutbox(actor,id,body.reminder));}
      if(!id&&op==='reconcile')return reply(200,await interviews.reconcile(10));
      if(!id&&op==='queue-reminders')return reply(200,await operations.queueReminders(actor));
      if(!id&&op==='dispatch-reminders')return reply(200,await operations.dispatchReminders(actor));
    }
    if(path==='/jobs/admin/incidents'&&request.method==='GET'){await governance.authorize(actor,'INCIDENT');return incidentWorkspacePage();}
    const incidentApi=path.match(/^\/api\/jobs\/v1\/admin\/incidents(?:\/([\w-]+)(?:\/(assign|transition|corrective)(?:\/([\w-]+))?)?)?$/);
    if(incidentApi){
      const [,id,op,action]=incidentApi;
      if(request.method==='GET'&&!op)return reply(200,id?await governance.incidentDetail(actor,id):await governance.incidents(actor,new URL(request.url)));
      if(request.method==='POST'){
        const b=await readBody(request,8192) as {severity:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL';summary:string;owner:string;revision:number;status:'CONTAINED'|'RECOVERING'|'RESOLVED';note:string;description:string;dueAt:number};
        if(!b||typeof b!=='object')throw new JobsError(400,'invalid_input');
        if(!id)return reply(201,await governance.createIncident(actor,b.severity,b.summary));
        if(op==='assign')return reply(200,await governance.assignIncident(actor,id,b.owner,b.severity,b.revision));
        if(op==='transition')return reply(200,await governance.incidentTransition(actor,id,b.revision,b.status,b.note));
        if(op==='corrective')return action?reply(200,await governance.finishCorrectiveAction(actor,id,action)):reply(201,await governance.addCorrectiveAction(actor,id,b.owner,b.description,b.dueAt));
      }
    }
    if(path==='/jobs/admin/policies'&&request.method==='GET'){await governance.authorize(actor,'POLICY');return policyWorkspacePage();}
    if(path==='/api/jobs/v1/admin/policies'){
      if(request.method==='GET')return reply(200,await governance.policies(actor,new URL(request.url)));
      if(request.method==='POST'){
        const b=await readBody(request,1024) as {key:string;value:number;revision:number;effectiveAt?:number};
        if(!b||typeof b.key!=='string')throw new JobsError(400,'invalid_policy');
        return reply(200,await governance.updatePolicy(actor,b.key,b.value,b.revision,b.effectiveAt));
      }
    }
    if(path==='/jobs/admin/audit'&&request.method==='GET'){await governance.authorize(actor,'AUDIT_READ');return auditWorkspacePage();}
    if(path==='/jobs/admin/signals'&&request.method==='GET'){await governance.authorize(actor,'CASE_DECIDE');return signalsPage();}
    if(path==='/api/jobs/v1/admin/signals'&&request.method==='GET')return reply(200,await governance.signals(actor,new URL(request.url)));
    const signalReview=path.match(/^\/api\/jobs\/v1\/admin\/signals\/([\w-]+)$/);
    if(signalReview&&request.method==='POST'){
      const body=await readBody(request,256) as {refer:boolean};
      if(!body)throw new JobsError(400,'invalid_input');return reply(200,await governance.reviewSignal(actor,signalReview[1],body.refer));
    }
    const scanCompany=path.match(/^\/api\/jobs\/v1\/admin\/companies\/([\w-]+)\/scan$/);
    if(scanCompany && request.method==='POST'){await governance.authorize(actor,'CASE_DECIDE');return reply(200,await governance.scanCompany(actor,scanCompany[1]));}
    const casePage=path.match(/^\/jobs\/admin\/cases\/([\w-]+)$/);
    if(casePage && request.method==='GET'){
      await governance.authorize(actor,'CASE_READ');
      return moderationCasePage(casePage[1]);
    }
    const caseApi=path.match(/^\/api\/jobs\/v1\/admin\/cases\/([\w-]+)(?:\/(decision|evidence|listing|assistance))?$/);
    if(caseApi){
      const [,id,operation]=caseApi;
      if(request.method==='GET'&&!operation)return reply(200,await governance.caseDetail(actor,id));
      if(request.method==='POST'&&operation==='decision')return reply(200,await governance.decideCase(actor,id,await readBody(request,8192) as Parameters<JobsGovernance['decideCase']>[2]));
      if(request.method==='POST'&&operation==='assistance')return reply(200,await governance.assistCase(actor,id));
      if(request.method==='POST'&&operation==='listing')return reply(201,await governance.moderateListing(actor,id,await readBody(request,1024)));
      if(request.method==='POST'&&operation==='evidence'){
        const body=await readBody(request,8192) as {reference:string;note:string};
        if(!body)throw new JobsError(400,'invalid_input');
        return reply(201,await governance.addCaseEvidence(actor,id,body.reference,body.note));
      }
    }
    const accountPage=path.match(/^\/jobs\/admin\/users\/([\w-]+)$/);
    if(accountPage && request.method==='GET'){
      await governance.authorize(actor,'ENFORCE');
      return accountReviewPage(accountPage[1]);
    }
    const accountApi=path.match(/^\/api\/jobs\/v1\/admin\/users\/([\w-]+)(?:\/(actions|closure))?$/);
    if(accountApi){
      if(request.method==='GET'&&!accountApi[2])return reply(200,await governance.userReview(actor,accountApi[1]));
      if(request.method==='POST'&&accountApi[2]==='closure'){
        const body=await readBody(request,512) as {caseId:string};
        if(!body)throw new JobsError(400,'invalid_input');
        return reply(200,await governance.closeReviewedAccount(actor,accountApi[1],body.caseId));
      }
      if(request.method==='POST'&&accountApi[2]==='actions')return reply(201,await governance.accountAction(actor,accountApi[1],await readBody(request,2048)));
    }
    const revokeAction=path.match(/^\/api\/jobs\/v1\/admin\/actions\/([\w-]+)\/revoke$/);
    if(revokeAction && request.method==='POST'){
      const body=await readBody(request,1024) as {revision:number;reason:string};
      if(!body)throw new JobsError(400,'invalid_input');
      return reply(200,await governance.revokeEnforcement(actor,revokeAction[1],body.revision,body.reason));
    }
    const membersPage=path.match(/^\/jobs\/admin\/companies\/([\w-]+)\/members$/);
    if(membersPage && request.method==='GET'){
      await governance.authorize(actor,'ENFORCE');
      return companyMembersPage(membersPage[1]);
    }
    const membersApi=path.match(/^\/api\/jobs\/v1\/admin\/companies\/([\w-]+)\/members(?:\/([\w-]+))?$/);
    if(membersApi){
      if(request.method==='GET'&&!membersApi[2])return reply(200,await governance.companyMembers(actor,membersApi[1],new URL(request.url)));
      if(request.method==='DELETE'&&membersApi[2])return reply(200,await governance.revokeCompanyMember(actor,membersApi[1],membersApi[2],await readBody(request,256)));
    }
    const employerEvidence=path.match(/^\/api\/jobs\/v1\/companies\/([\w-]+)\/verification$/);
    const verificationPage=path.match(/^\/jobs\/(admin\/)?companies\/([\w-]+)\/verification$/);
    if(verificationPage && request.method==='GET'){
      await governance.employerEvidence(actor,verificationPage[2],!!verificationPage[1]);
      return employerVerificationPage(verificationPage[2],!!verificationPage[1]);
    }
    if(employerEvidence && request.method==='GET')return reply(200,await governance.employerEvidence(actor,employerEvidence[1],false));
    if(employerEvidence && request.method==='POST')return reply(200,await governance.submitEmployerEvidence(actor,employerEvidence[1],await readBody(request,1024)));
    const employerReview=path.match(/^\/api\/jobs\/v1\/admin\/companies\/([\w-]+)\/verification$/);
    if(employerReview && request.method==='GET')return reply(200,await governance.employerEvidence(actor,employerReview[1],true));
    if(employerReview && request.method==='POST'){
      const body=await readBody(request,1024) as {state:'IN_REVIEW'|'VERIFIED'|'REJECTED'|'EXPIRED'|'UNVERIFIED';reference:string;revision:number;expiresAt?:number};
      if(!body || typeof body!=='object')throw new JobsError(400,'invalid_verification');
      return reply(200,await governance.reviewEmployerVerification(actor,employerReview[1],body.state,body.reference,body.revision,body.expiresAt));
    }
    if(path==='/jobs/admin/roles' && request.method==='GET'){
      await governance.authorize(actor,'ROLE_GRANT');
      return roleManagementPage();
    }
    if(path==='/api/jobs/v1/admin/roles'){
      if(request.method==='GET')return reply(200,await governance.roleDirectory(actor,new URL(request.url)));
      if(request.method==='POST'){
        const body=await readBody(request,1024) as Record<string,unknown>;
        if(!body || typeof body.subject!=='string' || typeof body.role!=='string' ||
          Object.keys(body).some(key=>!['subject','role','action'].includes(key)))throw new JobsError(400,'invalid_role_command');
        if(body.action==='grant')await governance.grantRole(actor,body.subject,body.role as AdminRole);
        else if(body.action==='revoke')await governance.revokeRole(actor,body.subject,body.role as AdminRole);
        else throw new JobsError(400,'invalid_role_command');
        return reply(200,{subject:body.subject,role:body.role,action:body.action});
      }
    }
    if(path==='/api/jobs/v1/admin/dashboard'&&request.method==='GET')return reply(200,await governance.dashboard(actor));
    if(path==='/api/jobs/v1/admin/cases'&&request.method==='GET')return reply(200,await governance.cases(actor,new URL(request.url)));
    if(path==='/api/jobs/v1/admin/audit'&&request.method==='GET')return reply(200,await governance.auditPage(actor,new URL(request.url)));
    if(path==='/api/jobs/v1/admin/users'&&request.method==='GET')return reply(200,await governance.users(actor,new URL(request.url)));
    if(path==='/api/jobs/v1/admin/companies'&&request.method==='GET')return reply(200,await governance.companies(actor,new URL(request.url)));
    if(path==='/api/jobs/v1/admin/operations'&&request.method==='GET')return reply(200,await governance.operationalQueue(actor,new URL(request.url)));
    if(path==='/api/jobs/v1/admin/analytics'&&request.method==='GET')return reply(200,await governance.operationalAnalytics(actor,Number(new URL(request.url).searchParams.get('days')||30),new URL(request.url).searchParams.get('group')));
    if (path === "/api/jobs/v1/closure" && request.method === "POST") { await new JobsPrivacy(db).close(actor); return reply(200, { closed: true }); }
    if(path==='/jobs/recruitment/discovery'&&request.method==='GET'){await recruitment.discover(actor,new URL(request.url));return discoveryPage();}
    if(path==='/jobs/notifications'&&request.method==='GET')return notificationsPage();
    if(path==='/jobs/interviews'&&request.method==='GET'){await interviews.list(actor,new URL(request.url));return interviewsPage(new URL(request.url).searchParams.get('company')||undefined);}
    const interviewPageRoute=path.match(/^\/jobs\/interviews\/([\w-]+)$/);if(interviewPageRoute&&request.method==='GET'){await interviews.get(actor,interviewPageRoute[1]);return interviewPage(interviewPageRoute[1]);}
    const candidateStatusPageRoute=path.match(/^\/jobs\/applications\/([\w-]+)$/);if(candidateStatusPageRoute&&request.method==='GET'){await recruitment.candidateCase(actor,candidateStatusPageRoute[1]);return candidateStatusPage(candidateStatusPageRoute[1]);}
    const dashboardPageRoute=path.match(/^\/jobs\/recruitment\/companies\/([\w-]+)$/);if(dashboardPageRoute&&request.method==='GET'){await recruitment.dashboard(actor,dashboardPageRoute[1]);return recruiterDashboardPage(dashboardPageRoute[1]);}
    const applicantsPageRoute=path.match(/^\/jobs\/recruitment\/companies\/([\w-]+)\/jobs\/([\w-]+)\/applicants$/);if(applicantsPageRoute&&request.method==='GET'){await recruitment.applicants(actor,applicantsPageRoute[1],applicantsPageRoute[2],new URL(request.url));return applicantsPage(applicantsPageRoute[1],applicantsPageRoute[2]);}
    const reviewPageRoute=path.match(/^\/jobs\/recruitment\/applications\/([\w-]+)$/);if(reviewPageRoute&&request.method==='GET'){await recruitment.review(actor,reviewPageRoute[1]);return applicantReviewPage(reviewPageRoute[1]);}
    if(path==='/api/jobs/v1/recruitment/discovery'&&request.method==='GET')return reply(200,await recruitment.discover(actor,new URL(request.url)));
    if(path==='/api/jobs/v1/recruitment/notifications'&&request.method==='GET')return reply(200,await recruitment.notifications(actor));
    const notificationRead=path.match(/^\/api\/jobs\/v1\/recruitment\/notifications\/([\w-]+)\/read$/);if(notificationRead&&request.method==='POST')return reply(200,await recruitment.readNotification(actor,notificationRead[1]));
    const recruitmentCompany=path.match(/^\/api\/jobs\/v1\/recruitment\/companies\/([\w-]+)\/(dashboard|analytics)$/);if(recruitmentCompany&&request.method==='GET'){if(recruitmentCompany[2]==='dashboard')return reply(200,await recruitment.dashboard(actor,recruitmentCompany[1]));const url=new URL(request.url),days=Number(url.searchParams.get('days')||30);return reply(200,{...(await recruitment.analytics(actor,recruitmentCompany[1],url)),interviews:await interviews.analytics(actor,recruitmentCompany[1],days)});}
    const assignmentRoute=path.match(/^\/api\/jobs\/v1\/recruitment\/companies\/([\w-]+)\/jobs\/([\w-]+)\/assignments$/);if(assignmentRoute){if(request.method==='GET')return reply(200,await recruitment.assignments(actor,assignmentRoute[1],assignmentRoute[2]));if(request.method==='POST')return reply(200,await recruitment.assign(actor,assignmentRoute[1],assignmentRoute[2],await readBody(request,2048)));}
    const recruiterApplications=path.match(/^\/api\/jobs\/v1\/recruitment\/companies\/([\w-]+)\/jobs\/([\w-]+)\/applications$/);if(recruiterApplications&&request.method==='GET')return reply(200,await recruitment.applicants(actor,recruiterApplications[1],recruiterApplications[2],new URL(request.url)));
    const recruitmentApplication=path.match(/^\/api\/jobs\/v1\/recruitment\/applications\/([\w-]+)(?:\/(candidate|transition|notes|match))?$/);if(recruitmentApplication){const [,id,action]=recruitmentApplication;if(!action&&request.method==='GET')return reply(200,await recruitment.review(actor,id));if(action==='candidate'&&request.method==='GET')return reply(200,await recruitment.candidateCase(actor,id));if(action==='transition'&&request.method==='POST')return reply(200,await recruitment.transition(actor,id,await readBody(request,4096)));if(action==='notes'&&request.method==='GET')return reply(200,await recruitment.notes(actor,id));if(action==='notes'&&request.method==='POST')return reply(201,await recruitment.addNote(actor,id,await readBody(request,4096)));if(action==='match'&&request.method==='POST')return reply(200,await recruitment.match(actor,id,await readBody(request,2048)));}
    const createInterview=path.match(/^\/api\/jobs\/v1\/recruitment\/applications\/([\w-]+)\/interviews$/);if(createInterview&&request.method==='POST')return reply(201,await interviews.create(actor,createInterview[1],await readBody(request,32768)));
    if(path==='/api/jobs/v1/interviews/preparation'&&request.method==='GET')return reply(200,interviews.preparation());
    if(path==='/api/jobs/v1/interviews'&&request.method==='GET')return reply(200,await interviews.list(actor,new URL(request.url)));
    const calendarRoute=path.match(/^\/api\/jobs\/v1\/interviews\/([\w-]+)\/calendar\.ics$/);if(calendarRoute&&request.method==='GET')return new Response(await interviews.calendar(actor,calendarRoute[1]),{headers:{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':`attachment; filename="billionjobs-interview-${calendarRoute[1]}.ics"`,'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'}});
    const interviewApi=path.match(/^\/api\/jobs\/v1\/interviews\/([\w-]+)(?:\/(commands|slots|join|feedback|reconcile))?$/);if(interviewApi){const [,id,action]=interviewApi;if(!action&&request.method==='GET')return reply(200,await interviews.get(actor,id));if(action==='commands'&&request.method==='POST')return reply(200,await interviews.command(actor,id,await readBody(request,4096)));if(action==='slots'&&request.method==='POST')return reply(200,await interviews.addRescheduleSlots(actor,id,await readBody(request,8192)));if(action==='join'&&request.method==='POST'){const input=await readBody(request,512) as {displayName?:unknown};return reply(200,await interviews.join(actor,id,input?.displayName as string));}if(action==='feedback'&&request.method==='GET')return reply(200,await interviews.feedback(actor,id));if(action==='feedback'&&request.method==='POST')return reply(200,await interviews.submitFeedback(actor,id,await readBody(request,16384)));if(action==='reconcile'&&request.method==='POST'){await interviews.get(actor,id);return reply(200,await interviews.reconcile(3,id));}}
    if (path === '/jobs/saved' && request.method === 'GET') return candidateJobsPage('saved');
    if (path === '/jobs/applications' && request.method === 'GET') return candidateJobsPage('applications');
    const jobsManagementPage=path.match(/^\/jobs\/companies\/([\w-]+)\/jobs$/);
    if (jobsManagementPage && request.method === 'GET') {
      await marketplace.companyListings(actor,jobsManagementPage[1]);
      return manageJobsPage(jobsManagementPage[1]);
    }
    if (path === '/api/jobs/v1/saved' && request.method === 'GET') return reply(200,await marketplace.saved(actor));
    if (path === '/api/jobs/v1/applications' && request.method === 'GET') return reply(200,await marketplace.history(actor));
    const candidateApplication=path.match(/^\/api\/jobs\/v1\/applications\/([\w-]+)(?:\/(withdraw))?$/);
    if (candidateApplication) {
      if (!candidateApplication[2] && request.method === 'GET') return reply(200,await marketplace.application(actor,candidateApplication[1]));
      if (candidateApplication[2] === 'withdraw' && request.method === 'POST') return reply(200,await marketplace.withdraw(actor,candidateApplication[1]));
    }
    const listingApi=path.match(/^\/api\/jobs\/v1\/companies\/([\w-]+)\/jobs(?:\/([\w-]+)(?:\/(publish|close|renew|reopen|archive|applications))?)?$/);
    if (listingApi) {
      const [,company,id,action]=listingApi;
      if (!id && request.method === 'GET') return reply(200,await marketplace.companyListings(actor,company));
      if (!id && request.method === 'POST') return reply(201,await marketplace.createDraft(actor,company,await readBody(request,65536)));
      if (id && !action && request.method === 'GET') return reply(200,await marketplace.manage(actor,company,id));
      if (id && !action && request.method === 'PUT') return reply(200,await marketplace.update(actor,company,id,await readBody(request,65536)));
      if (id && action === 'publish' && request.method === 'POST') return reply(200,await marketplace.publish(actor,company,id,await readBody(request,1024)));
      if (id && ['close','renew','reopen','archive'].includes(action||'') && request.method === 'POST') return reply(200,await marketplace.lifecycle(actor,company,id,action!.toUpperCase() as 'CLOSE'|'RENEW'|'REOPEN'|'ARCHIVE',await readBody(request,1024)));
      if (id && action === 'applications' && request.method === 'GET') return reply(200,await marketplace.assignedApplications(actor,company,id));
    }
    const candidateListing=path.match(/^\/api\/jobs\/v1\/jobs\/([\w-]+)\/([\w-]+)\/(saved|disclosure|applications|reports)$/);
    if (candidateListing) {
      const [,company,id,action]=candidateListing;
      if (action === 'saved' && request.method === 'POST') return reply(200,await marketplace.save(actor,company,id));
      if (action === 'saved' && request.method === 'DELETE') return reply(200,await marketplace.unsave(actor,company,id));
      if (action === 'disclosure' && request.method === 'POST') return reply(200,await marketplace.disclosure(actor,company,id,(await readBody(request,4096) as {fields:unknown})?.fields));
      if (action === 'applications' && request.method === 'POST') return reply(201,await marketplace.apply(actor,company,id,await readBody(request,4096)));
      if (action === 'reports' && request.method === 'POST') return reply(202,await marketplace.report(actor,company,id,await readBody(request,4096)));
    }
    const companies = new Companies(db);
    if (path === '/jobs/companies' && request.method === 'GET') return companyPage();
    if (path === '/api/jobs/v1/companies') {
      if (request.method === 'GET') return reply(200, await companies.list(actor));
      if (request.method === 'POST') return reply(201, await companies.create(actor, await readBody(request, 8192)));
    }
    const acceptance = path.match(/^\/api\/jobs\/v1\/company-invitations\/([\w-]+)\/accept$/);
    if (acceptance && request.method === 'POST') return reply(200, await companies.accept(actor, acceptance[1], await readBody(request, 1024)));
    const company = path.match(/^\/api\/jobs\/v1\/companies\/([\w-]+)(?:\/(invitations|members|entitlements|restriction|reports)(?:\/([\w-]+))?)?$/);
    if (company) {
      const [, id, section, target] = company;
      const method = request.method;
      if (!section && method === 'GET') return reply(200, await companies.get(actor,id));
      if (!section && method === 'PUT') return reply(200, await companies.update(actor,id,await readBody(request,8192)));
      if (section === 'invitations' && !target && method === 'POST') return reply(201, await companies.invite(actor,id,await readBody(request,1024)));
      if (section === 'invitations' && target && method === 'DELETE') return reply(200, await companies.cancel(actor,id,target,await readBody(request,256)));
      if (section === 'members' && target && (method === 'PUT' || method === 'DELETE')) return reply(200, await companies.changeMember(actor,id,target,await readBody(request,1024),method === 'DELETE'));
      if (section === 'entitlements' && !target && method === 'GET') return reply(200, await companies.entitlements(actor,id));
      if (section === 'restriction' && !target && method === 'PUT') return reply(200, await companies.restrict(actor,id,await readBody(request,1024)));
      if (section === 'reports' && !target && method === 'POST') { await companies.report(actor,id,await readBody(request,4096)); return reply(202,{received:true}); }
    }
    if (path === '/api/jobs/v1/profile') {
      if (request.method === 'GET') return reply(200, {profile:await profiles.get(actor)});
      if (request.method === 'PUT') return reply(200, {profile:await profiles.save(actor, await readBody(request, 65536))});
      if (request.method === 'DELETE') {
        const body=await readBody(request,256);
        if (!body || typeof body!=='object' || Object.keys(body).join()!=='revision') throw new JobsError(400,'invalid_profile');
        await profiles.remove(actor,(body as {revision:unknown}).revision); return reply(200,{deleted:true});
      }
      return reply(405,{error:'method_not_allowed'});
    }
    if ((path === "/api/jobs/v1/foundation") && request.method === "GET") return reply(200, { module: "BillionJobs", stage: "foundation", subject: actor.subject });
    return reply(404, { error: "not_found" });
  } catch (error) {
    // Never log raw database errors, request bodies, cookies or account details.
    if(String(error).includes('final_owner_protected'))return reply(409,{error:'final_owner_protected'});
    const code = String(error).match(/company_(owner_protected|forbidden|conflict|restricted|duplicate_invitation|invalid_invitation|already_member|rate_limit)\b/)?.[0];
    if (code) return reply(code === 'company_rate_limit' ? 429 : ['company_forbidden','company_restricted'].includes(code) ? 403 : code === 'company_invalid_invitation' ? 404 : 409, {error:code});
    return error instanceof JobsError ? reply(error.status, { error: error.code }) : reply(503, { error: "jobs_unavailable" });
  }
}

async function readBody(request: Request, limit: number): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') throw new JobsError(415,'json_required');
  const reader=request.body?.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  if(reader) while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new JobsError(413,'body_too_large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new JobsError(400,'invalid_body');}
}
