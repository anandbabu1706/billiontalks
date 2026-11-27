import { Companies } from './companies';
import { companyPage } from './company-ui';
import { JobsError, type IdentityResolver, type JobsDatabase } from "./contracts";
import { requireEligible } from "./permissions";
import { JobsPrivacy } from "./privacy";
import { Marketplace } from './marketplace';
import { candidateJobsPage, jobPage, manageJobsPage, searchPage } from './marketplace-ui';
import { Profiles } from "./profiles";
import { profilePage, sharedProfilePage, signInPage } from "./profile-ui";

export function isJobsPath(path: string): boolean { return path === "/jobs" || path.startsWith("/jobs/") || path === "/api/jobs/v1" || path.startsWith("/api/jobs/v1/"); }
function reply(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } });
}
export async function handleJobs(request: Request, enabled: boolean, db: JobsDatabase | undefined, identity: IdentityResolver): Promise<Response> {
  if (!enabled) return reply(404, { error: "not_found" });
  try {
    if (!db) throw new JobsError(503, "jobs_unavailable");
    const gate = await db.prepare("SELECT ready FROM restore_gate WHERE id=1").first<{ ready: number }>();
    if (gate?.ready !== 1) throw new JobsError(503, "restore_pending");
    const actor = await identity(request);
    const path = new URL(request.url).pathname;
    const profiles = new Profiles(db);
    const marketplace = new Marketplace(db);
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
    if (!actor) return (path === '/jobs' || path === '/jobs/profile' || path === '/jobs/companies' || path === '/jobs/saved' || path === '/jobs/applications' || /^\/jobs\/companies\/[\w-]+\/jobs$/.test(path)) && request.method === 'GET' ? signInPage() : reply(401, {error:'authentication_required'});
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
    await requireEligible(db, actor);
    if (path === "/api/jobs/v1/closure" && request.method === "POST") { await new JobsPrivacy(db).close(actor); return reply(200, { closed: true }); }
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
