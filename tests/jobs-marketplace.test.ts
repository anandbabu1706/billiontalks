import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createJobsRuntime, seedIdentity } from '../scripts/jobs-runtime.mjs';
import { Marketplace, type ListingData } from '../src/jobs/marketplace';
import { JobsPrivacy } from '../src/jobs/privacy';
import { DAY, type Identity } from '../src/jobs/contracts';
import { jobPage, manageJobsPage, searchPage } from '../src/jobs/marketplace-ui';

describe('EP-07 local synthetic marketplace workflows',()=>{
  let runtime:Awaited<ReturnType<typeof createJobsRuntime>>;
  let now=Date.UTC(2026,10,27,6);
  let service:Marketplace;
  const company='synthetic-company';
  const people=['owner','recruiter','outsider','candidate1','candidate2','candidate3','candidate4','candidate5'];
  const actor=(subject:string):Identity=>({subject,recipientHash:'verified-'+subject});
  const data=(suffix:string,overrides:Partial<ListingData>={}):ListingData=>({title:'Engineer '+suffix,department:'Engineering',description:'Build useful local-only software.',responsibilities:'Design and test.',requiredSkills:['TypeScript'],qualifications:'Synthetic qualification',experienceMin:1,experienceMax:5,employmentType:'FULL_TIME',arrangement:'REMOTE',location:'Chennai',vacancies:2,salaryMin:500000,salaryMax:900000,currency:'INR',...overrides});
  const profile=(name:string)=>JSON.stringify({name,headline:'Engineer',summary:'Synthetic profile',location:'Chennai',skills:['TypeScript'],experience:[],education:[],certifications:[],openToWork:true,preferences:{roles:'Engineer',locations:'Chennai',workMode:'REMOTE'}});
  async function publish(suffix:string,overrides:Partial<ListingData>={}) {
    const draft=await service.createDraft(actor('owner'),company,{data:data(suffix,overrides)});
    return service.publish(actor('owner'),company,draft.id,{revision:draft.revision,key:'publish-'+suffix});
  }
  beforeAll(async()=>{
    runtime=await createJobsRuntime({enabled:true});
    service=new Marketplace(runtime.jobs,()=>now);
    for (const [index,subject] of people.entries()) {
      const token=String.fromCharCode(97+index).repeat(43);
      await seedIdentity(runtime.accounts,subject,token);
      await runtime.jobs.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,?)').bind(subject,now).run();
      if (subject.startsWith('candidate')) await runtime.jobs.prepare("INSERT INTO jobs_profiles VALUES(?,?,1,?,'[\"name\",\"headline\"]','PRIVATE',0,?)").bind(subject,'profile-'+subject,profile(subject),now).run();
    }
    await runtime.jobs.prepare('INSERT INTO companies VALUES(?,?,?,1,0,?)').bind(company,'owner',JSON.stringify({name:'Synthetic Company',industry:'Software',description:'Fixture',website:'https://example.invalid',location:'Chennai',size:'1-10',businessEmail:'team@example.invalid'}),now).run();
    await runtime.jobs.prepare("INSERT INTO memberships VALUES(?,?,'RECRUITER',NULL)").bind(company,'recruiter').run();
  },60000);
  afterAll(async()=>{await runtime?.mf.dispose();});

  it('keeps drafts private, previews them for the tenant and preserves revision-safe edits',async()=>{
    const draft=await service.createDraft(actor('owner'),company,{data:data('draft')});
    expect(draft.publication).toBe('DRAFT');
    await expect(service.publicListing(company,draft.id)).rejects.toMatchObject({status:404});
    const edited=await service.update(actor('owner'),company,draft.id,{revision:0,key:'draft-edit',data:data('draft edited')});
    expect(edited).toMatchObject({revision:1,publication:'DRAFT'});
    await expect(service.update(actor('owner'),company,draft.id,{revision:0,key:'stale',data:data('stale')})).rejects.toMatchObject({status:409});
  });

  it('publishes, closes, reopens and archives through the inherited atomic quota controls',async()=>{
    let listing=await publish('lifecycle');
    expect(listing).toMatchObject({publication:'PUBLISHED',state:'ACTIVE',revision:1});
    listing=await service.lifecycle(actor('owner'),company,listing.id,'CLOSE',{revision:listing.revision,key:'close-lifecycle'});
    expect(listing).toMatchObject({publication:'CLOSED',state:'CLOSED'});
    listing=await service.lifecycle(actor('owner'),company,listing.id,'REOPEN',{revision:listing.revision,key:'reopen-lifecycle'});
    expect(listing).toMatchObject({publication:'PUBLISHED',state:'ACTIVE'});
    listing=await service.lifecycle(actor('owner'),company,listing.id,'CLOSE',{revision:listing.revision,key:'close-again'});
    listing=await service.lifecycle(actor('owner'),company,listing.id,'ARCHIVE',{revision:listing.revision,key:'archive-lifecycle'});
    expect(listing).toMatchObject({publication:'ARCHIVED',state:'ARCHIVED'});
  });

  it('validates bounded structured listing input and rejects duplicate active vacancies',async()=>{
    await expect(service.createDraft(actor('owner'),company,{data:data('bad',{salaryMin:900000,salaryMax:500000})})).rejects.toMatchObject({status:400});
    await publish('duplicate');
    const duplicate=await service.createDraft(actor('owner'),company,{data:data('duplicate')});
    await expect(service.publish(actor('owner'),company,duplicate.id,{revision:0,key:'duplicate-two'})).rejects.toMatchObject({status:409});
  });

  it('discovers only active listings with bounded filters, sorting and pagination',async()=>{
    const remote=await publish('discovery',{requiredSkills:['Rust'],location:'Bengaluru'});
    const result=await service.search(new URL('https://example.invalid/api/jobs/v1/jobs?skill=rust&location=Bengaluru&industry=Software&limit=1'));
    expect(result).toMatchObject({limit:1,total:1,pages:1});
    expect(result.items[0]).toMatchObject({id:remote.id,company_name:'Synthetic Company'});
    const closed=await service.lifecycle(actor('owner'),company,remote.id,'CLOSE',{revision:remote.revision,key:'close-discovery'});
    expect(closed.publication).toBe('CLOSED');
    expect((await service.search(new URL('https://example.invalid/api/jobs/v1/jobs?skill=rust'))).total).toBe(0);
    await expect(service.search(new URL('https://example.invalid/api/jobs/v1/jobs?limit=100'))).rejects.toMatchObject({status:400});
  });

  it('saves and removes jobs without exposing unavailable listings as active',async()=>{
    const listing=await publish('saved');
    await service.save(actor('candidate1'),company,listing.id);
    expect(await service.saved(actor('candidate1'))).toEqual([expect.objectContaining({id:listing.id,available:true})]);
    await service.lifecycle(actor('owner'),company,listing.id,'CLOSE',{revision:listing.revision,key:'close-saved'});
    expect(await service.saved(actor('candidate1'))).toEqual([expect.objectContaining({id:listing.id,available:false})]);
    await service.unsave(actor('candidate1'),company,listing.id);
    expect(await service.saved(actor('candidate1'))).toEqual([]);
  });

  it('stores an immutable candidate-selected snapshot independent of later profile visibility',async()=>{
    const listing=await publish('snapshot');
    const application=await service.apply(actor('candidate1'),company,listing.id,{key:'snapshot-one',fields:['name','headline']});
    expect(application.snapshot.profile.fields).toEqual({name:'candidate1',headline:'Engineer'});
    await runtime.jobs.prepare("UPDATE jobs_profiles SET data=json_set(data,'$.headline','Changed'),visibility='PUBLIC',indexing=1 WHERE subject='candidate1'").run();
    expect((await service.application(actor('candidate1'),application.id)).snapshot.profile.fields.headline).toBe('Engineer');
    expect(JSON.stringify(await service.publicListing(company,listing.id))).not.toContain('candidate1');
  });

  it('makes same-key submission retries idempotent and prevents concurrent duplicate applications',async()=>{
    const listing=await publish('concurrency');
    const submissions=await Promise.all([service.apply(actor('candidate2'),company,listing.id,{key:'same-key',fields:['name']}),service.apply(actor('candidate2'),company,listing.id,{key:'same-key',fields:['name']})]);
    expect(new Set(submissions.map(item=>item.id)).size).toBe(1);
    await expect(service.apply(actor('candidate2'),company,listing.id,{key:'other-key',fields:['name']})).rejects.toMatchObject({code:'application_duplicate'});
    expect(await runtime.jobs.prepare('SELECT count(*) AS n FROM applications WHERE candidate=? AND listing=?').bind('candidate2',listing.id).first()).toEqual({n:1});
  });

  it('allows one reapplication only after a 24-hour voluntary-withdrawal wait',async()=>{
    const listing=await publish('reapply');
    const first=await service.apply(actor('candidate3'),company,listing.id,{key:'attempt-one',fields:['name']});
    await service.withdraw(actor('candidate3'),first.id);
    now+=DAY-1;
    await expect(service.apply(actor('candidate3'),company,listing.id,{key:'too-early',fields:['name']})).rejects.toMatchObject({code:'application_wait_required'});
    now+=1;
    const second=await service.apply(actor('candidate3'),company,listing.id,{key:'attempt-two',fields:['name']});
    expect(second.attempt).toBe(2);
    await service.withdraw(actor('candidate3'),second.id);
    now+=DAY;
    await expect(service.apply(actor('candidate3'),company,listing.id,{key:'attempt-three',fields:['name']})).rejects.toMatchObject({code:'application_reapply_denied'});
  });

  it('limits application access to currently assigned recruiters and forbids reapplication after rejection',async()=>{
    const listing=await publish('assignment');
    const application=await service.apply(actor('candidate4'),company,listing.id,{key:'assigned-one',fields:['name']});
    await runtime.jobs.prepare('INSERT INTO assignments VALUES(?,?,?)').bind(company,listing.id,'recruiter').run();
    expect(await service.assignedApplications(actor('recruiter'),company,listing.id)).toHaveLength(1);
    await expect(service.assignedApplications(actor('outsider'),company,listing.id)).rejects.toMatchObject({status:403});
    await service.transitionAssigned(actor('recruiter'),application.id,'REJECT');
    await expect(service.apply(actor('candidate4'),company,listing.id,{key:'after-rejection',fields:['name']})).rejects.toMatchObject({code:'application_reapply_denied'});
    await runtime.jobs.prepare("UPDATE memberships SET revoked_at=? WHERE company=? AND subject='recruiter'").bind(now,company).run();
    await expect(service.assignedApplications(actor('recruiter'),company,listing.id)).rejects.toMatchObject({status:403});
  });

  it('deduplicates candidate reports without revealing moderation state',async()=>{
    const listing=await publish('report');
    expect(await service.report(actor('candidate1'),company,listing.id,{reason:'MISLEADING',detail:'Synthetic concern'})).toEqual({received:true});
    expect(await service.report(actor('candidate1'),company,listing.id,{reason:'OTHER',detail:'Repeated concern'})).toEqual({received:false});
  });

  it('enforces CSRF on candidate writes while public discovery remains anonymous',async()=>{
    const listing=await publish('api');
    const publicResponse=await runtime.mf.dispatchFetch('http://localhost/api/jobs/v1/jobs/'+company+'/'+listing.id);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get('Cache-Control')).toContain('no-store');
    const rejected=await runtime.mf.dispatchFetch('http://localhost/api/jobs/v1/jobs/'+company+'/'+listing.id+'/saved',{method:'POST',headers:{Cookie:'bt_account_session='+'d'.repeat(43),'Content-Type':'application/json'},body:'{}'});
    expect(rejected.status).toBe(403);
  });

  it('renders responsive, labeled and non-indexed private marketplace interfaces',async()=>{
    for (const response of [searchPage(),jobPage(company,'listing'),manageJobsPage(company)]) {
      const html=await response.text();
      const dom=new JSDOM(html);
      expect(dom.window.document.querySelector('meta[name=viewport]')).toBeTruthy();
      for(const input of dom.window.document.querySelectorAll<HTMLInputElement>('input:not([type=hidden]),select,textarea')) expect(input.labels?.length).toBeGreaterThan(0);
      for(const script of dom.window.document.querySelectorAll('script')) expect(()=>new Function(script.textContent||'')).not.toThrow();
      dom.window.close();
    }
    const management=await manageJobsPage(company);
    expect(management.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(await management.text()).toContain('posting allowance');
  });

  it('restricts applications and clears saved jobs on Jobs-only closure without deleting shared accounts',async()=>{
    const listing=await publish('closure');
    await service.apply(actor('candidate5'),company,listing.id,{key:'before-closure',fields:['name']});
    await new JobsPrivacy(runtime.jobs,()=>now).close(actor('candidate5'));
    expect(await runtime.accounts.prepare("SELECT id FROM accounts WHERE id='candidate5'").first()).toBeTruthy();
    expect(await runtime.jobs.prepare("SELECT count(*) AS n FROM applications WHERE candidate='candidate5' AND restricted=1").first()).toEqual({n:1});
    expect(await runtime.jobs.prepare("SELECT count(*) AS n FROM retained_records WHERE subject='candidate5' AND kind='APPLICATION'").first()).toEqual({n:1});
    await expect(service.history(actor('candidate5'))).rejects.toMatchObject({status:403});
    await runtime.jobs.prepare("INSERT INTO platform_roles VALUES('outsider','PRIVACY_OPERATOR',NULL)").run();
    await new JobsPrivacy(runtime.jobs,()=>now+180*DAY).purge(actor('outsider'));
    expect(await runtime.jobs.prepare("SELECT count(*) AS n FROM applications WHERE candidate='candidate5'").first()).toEqual({n:0});
    expect(await runtime.jobs.prepare("SELECT count(*) AS n FROM deletion_ledger WHERE subject='candidate5'").first()).toEqual({n:2});
  });
});
