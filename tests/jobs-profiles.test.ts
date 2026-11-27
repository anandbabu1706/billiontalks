import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createJobsRuntime, seedIdentity } from '../scripts/jobs-runtime.mjs';
import { Profiles, type ProfileInput } from '../src/jobs/profiles';
import { JobsPrivacy } from '../src/jobs/privacy';
import { DAY, type JobsDatabase } from '../src/jobs/contracts';
import { profilePage } from '../src/jobs/profile-ui';
import { accountPage } from '../src/account/ui';

const candidate={subject:'candidate'};
const input = (): ProfileInput => ({revision:0,visibility:'PRIVATE',indexing:false,visibleFields:[],data:{name:'Synthetic Candidate',headline:'Engineer',summary:'Builds useful tools',location:'Chennai',skills:['TypeScript'],experience:[{title:'Engineer',organization:'Example',start:'2020-01',end:'2024-02',description:'Synthetic work'}],education:[],certifications:[],openToWork:true,preferences:{roles:'Developer',locations:'Remote',workMode:'REMOTE'}}});
describe('EP-05 local synthetic profile workflows',()=>{
  let runtime:Awaited<ReturnType<typeof createJobsRuntime>>, db:JobsDatabase, service:Profiles;
  const tokens={candidate:'a'.repeat(43),other:'b'.repeat(43),recruiter:'c'.repeat(43)};
  const sql=(s:string,...values:unknown[])=>db.prepare(s).bind(...values).run();
  async function request(path='/api/jobs/v1/profile',method='GET',body?:unknown,who:keyof typeof tokens|null='candidate', extra:Record<string,string>={}){
    return runtime.mf.dispatchFetch('http://localhost'+path,{method,headers:{...(who?{Cookie:'bt_account_session='+tokens[who]}:{}),...(method==='GET'?{}:{Origin:'http://localhost','Content-Type':'application/json','X-Jobs-Request':'1'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  beforeAll(async()=>{runtime=await createJobsRuntime({enabled:true});db=runtime.jobs;service=new Profiles(db);for(const [id,token] of Object.entries(tokens))await seedIdentity(runtime.accounts,id,token);},60000);
  afterAll(async()=>{await runtime?.mf.dispose();});
  beforeEach(async()=>{
    for(const table of ['jobs_profiles','retention_exceptions','retained_records','deletion_ledger','privacy_audit','memberships','platform_roles','jobs_users'])await sql('DELETE FROM '+table);
    await sql('UPDATE restore_gate SET ready=1');
    for(const subject of Object.keys(tokens))await sql('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,?)',subject,Date.now());
    await sql("INSERT INTO platform_roles VALUES('other','PRIVACY_OPERATOR',NULL)");
  });
  it('creates, persists across requests, edits and deletes only the owned profile',async()=>{
    expect(await (await request()).json()).toEqual({profile:null});
    const created=await (await request(undefined,'PUT',input())).json() as {profile:{id:string;revision:number;completion:number}};
    expect(created.profile.revision).toBe(1);expect(created.profile.completion).toBeGreaterThan(0);
    expect((await service.get(candidate))?.data.name).toBe('Synthetic Candidate');
    expect(await (await request(undefined,'GET',undefined,'other')).json()).toEqual({profile:null});
    const edited=input();edited.revision=1;edited.data.name='Changed';
    expect((await request(undefined,'PUT',edited)).status).toBe(200);
    expect((await service.get(candidate))?.data.name).toBe('Changed');
    expect((await request(undefined,'DELETE',{revision:2},'other')).status).toBe(409);
    expect((await request(undefined,'DELETE',{revision:2})).status).toBe(200);
    expect(await service.get(candidate)).toBeNull();
    expect(await db.prepare('SELECT record_id FROM deletion_ledger WHERE record_id=?').bind(created.profile.id).first()).toBeTruthy();
    expect((await request(undefined,'PUT',input())).status).toBe(200);
    expect((await service.get(candidate))?.id).not.toBe(created.profile.id);
  });
  it('requires authentication and does not enroll ordinary signed-in accounts',async()=>{
    expect((await request(undefined,'GET',undefined,null)).status).toBe(401);
    await sql("DELETE FROM jobs_users WHERE subject='candidate'");
    const page=await request('/jobs/profile');expect(page.status).toBe(200);
    expect(await (await request('/api/jobs/v1/status')).json()).toEqual({enrolled:false});
    expect((await request(undefined,'PUT',input())).status).toBe(403);
    expect(await db.prepare("SELECT subject FROM jobs_users WHERE subject='candidate'").first()).toBeNull();
    expect((await request('/api/jobs/v1/eligibility','POST',{over18:true})).status).toBe(200);
    expect((await request(undefined,'PUT',input())).status).toBe(200);
  });
  it('keeps denied age attestations sticky and never requests date of birth or identity numbers',async()=>{
    await sql("DELETE FROM jobs_users WHERE subject='candidate'");
    expect((await request('/api/jobs/v1/eligibility','POST',{over18:false})).status).toBe(403);
    expect((await request('/api/jobs/v1/eligibility','POST',{over18:true})).status).toBe(403);
    expect((await request(undefined,'PUT',input())).status).toBe(403);
  });
  it('starts private and distinguishes public projection from owner data',async()=>{
    const saved=await service.save(candidate,input());
    expect(saved.visibility).toBe('PRIVATE');expect(saved.indexing).toBe(false);
    expect((await request('/jobs/profiles/'+saved.id,'GET',undefined,null)).status).toBe(404);
    const value=input();value.revision=1;value.visibility='PUBLIC';value.visibleFields=['name','headline'];
    await service.save(candidate,value);
    const response=await request('/api/jobs/v1/profiles/'+saved.id,'GET',undefined,null);
    expect(await response.json()).toEqual({profile:{name:'Synthetic Candidate',headline:'Engineer'}});
    expect((await service.get(candidate))?.data.preferences.roles).toBe('Developer');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
  });
  it('honors field removal, private transitions and independent indexing consent',async()=>{
    const value=input();value.visibility='PUBLIC';value.visibleFields=['name','skills'];
    const saved=await service.save(candidate,value);const url='/jobs/profiles/'+saved.id;
    expect((await request(url,'GET',undefined,null)).headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    value.revision=1;value.indexing=true;await service.save(candidate,value);
    expect((await request(url,'GET',undefined,null)).headers.get('X-Robots-Tag')).toBe('index, follow');
    value.revision=2;value.indexing=false;value.visibleFields=['name'];await service.save(candidate,value);
    const html=await request(url,'GET',undefined,null);expect(html.headers.get('X-Robots-Tag')).toContain('noindex');expect(await html.text()).not.toContain('TypeScript');
    value.revision=3;value.visibility='PRIVATE';await service.save(candidate,value);
    expect((await request(url,'GET',undefined,null)).status).toBe(404);
  });
  it('requires active server-side recruiter membership and revokes discovery immediately',async()=>{
    const value=input();value.visibility='RECRUITERS_ONLY';value.visibleFields=['name'];const saved=await service.save(candidate,value);const url='/api/jobs/v1/profiles/'+saved.id;
    expect((await request(url,'GET',undefined,'other')).status).toBe(404); // platform role is not discovery permission
    expect((await request(url,'GET',undefined,'recruiter',{'X-Role':'RECRUITER'})).status).toBe(404);
    await sql("INSERT INTO memberships VALUES('synthetic_company','recruiter','RECRUITER',NULL)");
    expect((await request(url,'GET',undefined,'recruiter')).status).toBe(200);
    await sql("UPDATE memberships SET revoked_at=1 WHERE subject='recruiter'");
    expect((await request(url,'GET',undefined,'recruiter')).status).toBe(404);
    await sql("UPDATE memberships SET revoked_at=NULL WHERE subject='recruiter'");
    await sql("UPDATE jobs_users SET restricted=1 WHERE subject='recruiter'");
    expect((await request(url,'GET',undefined,'recruiter')).status).toBe(404);
  });
  it('does not modify application records when visibility changes or profile is deleted',async()=>{
    await sql("INSERT INTO retained_records VALUES('application','candidate','APPLICATION',0,0,?)",JSON.stringify({private:'submission'}));
    const value=input();value.visibility='PUBLIC';value.visibleFields=['name'];const saved=await service.save(candidate,value);
    expect(await (await request('/api/jobs/v1/profiles/'+saved.id,'GET',undefined,null)).text()).not.toContain('submission');
    await service.remove(candidate,1);
    expect(await db.prepare("SELECT payload FROM retained_records WHERE id='application'").first()).toEqual({payload:'{"private":"submission"}'});
  });
  it('rejects foreign ownership, private-field disclosure, unknown fields and invalid dates',async()=>{
    const bad:unknown[]=[{...input(),subject:'other'},{...input(),visibleFields:['preferences']},{...input(),indexing:true},{...input(),data:{...input().data,email:'private@example.invalid'}},{...input(),data:{...input().data,name:' '}},{...input(),data:{...input().data,experience:[{...input().data.experience[0],end:'2019-12'}]}},{...input(),data:{...input().data,skills:['SQL','sql']}},{...input(),data:{...input().data,experience:Array(21).fill(input().data.experience[0])}}];
    for(const body of bad)expect((await request(undefined,'PUT',body)).status).toBe(400);
    expect(await service.get(candidate)).toBeNull();
  });
  it('checks CSRF, JSON type, malformed and bounded streaming bodies',async()=>{
    for(const headers of ([{Origin:'https://evil.invalid'},{'X-Jobs-Request':''},{'Sec-Fetch-Site':'cross-site'}] as Record<string,string>[]))expect((await request(undefined,'PUT',input(),'candidate',headers)).status).toBe(403);
    expect((await request(undefined,'PUT',input(),'candidate',{'Content-Type':'text/plain'})).status).toBe(415);
    expect((await request(undefined,'PUT',{...input(),extra:'x'.repeat(65536)})).status).toBe(413);
    expect((await runtime.mf.dispatchFetch('http://localhost/api/jobs/v1/profile',{method:'PUT',headers:{Cookie:'bt_account_session='+tokens.candidate,Origin:'http://localhost','X-Jobs-Request':'1','Content-Type':'application/json'},body:'{'})).status).toBe(400);
  });
  it('escapes stored HTML and treats SQL metacharacters only as data',async()=>{
    const value=input();value.data.name='<img src=x onerror=alert(1)>';value.data.summary="'; DROP TABLE jobs_users; --";value.visibility='PUBLIC';value.visibleFields=['name','summary'];const saved=await service.save(candidate,value);
    const response=await request('/jobs/profiles/'+saved.id,'GET',undefined,null);const html=await response.text();
    expect(html).toContain('&lt;img');expect(html).not.toContain('<img');expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(await db.prepare('SELECT COUNT(*) AS n FROM jobs_users').first()).toEqual({n:3});
  });
  it('allows one concurrent edit and rejects stale updates and deletes without overwriting',async()=>{
    await service.save(candidate,input());const value={...input(),revision:1};
    const results=await Promise.allSettled(Array.from({length:6},(_,i)=>service.save(candidate,{...value,data:{...value.data,headline:'Edit '+i}})));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await service.get(candidate))?.revision).toBe(2);
    await expect(service.remove(candidate,1)).rejects.toMatchObject({code:'profile_conflict'});
    await service.remove(candidate,2);
    await expect(service.save(candidate,value)).rejects.toMatchObject({code:'profile_conflict'});
  });
  it('closes Jobs only, hides immediately and purges the profile archive after 30 days',async()=>{
    const value=input();value.visibility='PUBLIC';value.visibleFields=['name'];const saved=await service.save(candidate,value);const now=Date.now();
    await new JobsPrivacy(db,()=>now).close(candidate);
    expect((await request('/jobs/profiles/'+saved.id,'GET',undefined,null)).status).toBe(404);
    expect((await request(undefined,'GET')).status).toBe(403);
    expect(await db.prepare('SELECT subject FROM jobs_profiles').first()).toBeNull();
    expect(await db.prepare('SELECT restricted FROM retained_records WHERE id=?').bind(saved.id).first()).toEqual({restricted:1});
    await new JobsPrivacy(db,()=>now+30*DAY-1).purge({subject:'other'});
    expect(await db.prepare('SELECT id FROM retained_records WHERE id=?').bind(saved.id).first()).toBeTruthy();
    await new JobsPrivacy(db,()=>now+30*DAY).purge({subject:'other'});
    expect(await db.prepare('SELECT id FROM retained_records WHERE id=?').bind(saved.id).first()).toBeNull();
    expect(await runtime.accounts.prepare("SELECT status FROM accounts WHERE id='candidate'").first()).toEqual({status:'ACTIVE'});
    expect(await runtime.accounts.prepare("SELECT account_id FROM account_sessions WHERE account_id='candidate'").first()).toBeTruthy();
    expect((await request('/api/jobs/v1/eligibility','POST',{over18:true})).status).toBe(403);
  });
  it('honors closure holds and replays deletion against restored live profiles',async()=>{
    const saved=await service.save(candidate,input());const now=Date.now();await new JobsPrivacy(db,()=>now).close(candidate);
    await new JobsPrivacy(db).restrict({subject:'other'},saved.id,true,null,'LEGAL_HOLD');
    await new JobsPrivacy(db,()=>now+31*DAY).purge({subject:'other'});
    expect(await db.prepare('SELECT id FROM retained_records WHERE id=?').bind(saved.id).first()).toBeTruthy();
    const second=await service.save({subject:'recruiter'},input());await sql('UPDATE restore_gate SET ready=0');
    await new JobsPrivacy(db).replayDeletionLedger({subject:'other'},[{record:second.id,subject:'recruiter',at:now}]);
    expect(await service.get({subject:'recruiter'})).toBeNull();
  });
  it('blocks restored/restricted profiles and fails safely for unsupported operations',async()=>{
    await service.save(candidate,input());await sql('UPDATE restore_gate SET ready=0');
    expect((await request()).status).toBe(503);
    await sql('UPDATE restore_gate SET ready=1');await sql("UPDATE jobs_users SET restricted=1 WHERE subject='candidate'");
    expect((await request(undefined,'PUT',{...input(),revision:1})).status).toBe(403);
    expect((await request('/api/jobs/v1/profile/other','GET',undefined,'other')).status).toBe(404);
    expect((await request(undefined,'PATCH',{},'other')).status).toBe(405);
  });
  it('keeps Jobs disabled by default and leaves account dashboard redirects unchanged',async()=>{
    const disabled=await createJobsRuntime();try{expect((await disabled.mf.dispatchFetch('http://localhost/jobs/profile')).status).toBe(404);}finally{await disabled.mf.dispose();}
    expect(accountPage()).not.toContain('>Jobs profile</a>');
    expect(accountPage(false,true)).toContain('>Jobs profile</a>');
    for(const target of ['https://evil.invalid','//evil.invalid','/jobs/profile/../dashboard']){
      const html=await (await request('/account?next='+encodeURIComponent(target))).text();expect(html).toContain("location.href = '/dashboard'");
    }
    expect(await (await request('/account?next=/jobs/profile')).text()).toContain("location.href = '/jobs/profile'");
  });
  it('persists synthetic profiles across complete runtime restarts without repeating migrations',async()=>{
    // Keep the nested workerd SQLite path short on Windows.
    const localState='test-'+crypto.randomUUID().replaceAll('-','').slice(0,12);
    let instance=await createJobsRuntime({enabled:true,localState});
    try {
      await seedIdentity(instance.accounts,'restart');
      await instance.jobs.prepare("INSERT INTO jobs_users(subject,eligible,attested_at) VALUES('restart',1,0)").run();
      const saved=await new Profiles(instance.jobs).save({subject:'restart'},input());
      await instance.mf.dispose();instance=await createJobsRuntime({enabled:true,localState});
      expect(await new Profiles(instance.jobs).get({subject:'restart'})).toEqual(saved);
      expect(await instance.jobs.prepare('SELECT COUNT(*) AS n FROM local_migrations').first()).toEqual({n:3});
    } finally {await instance.mf.dispose();}
    await expect(createJobsRuntime({localState:'../outside'})).rejects.toThrow('Invalid synthetic state');
  },60000);

  async function editor(){
    const dom=new JSDOM(await profilePage().text(),{url:'http://localhost/jobs/profile',runScripts:'dangerously',beforeParse(window){
      window.confirm=()=>true;
      Object.defineProperty(window,'fetch',{value:async(path:string,options:RequestInit={})=>request(path,options.method||'GET',options.body?JSON.parse(String(options.body)):undefined)});
    }});
    await until(()=>!dom.window.document.getElementById('profile-form')!.hidden);
    return dom;
  }
  async function until(check:()=>boolean){for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}throw new Error('UI did not settle');}
  it('edits repeated entries, saves, reloads and reports validation through the working UI',async()=>{
    const dom=await editor();try{const doc=dom.window.document;const field=(id:string)=>doc.getElementById(id) as HTMLInputElement;
      field('name').value='UI Candidate';(doc.querySelector('[data-add=education]') as HTMLButtonElement).click();
      const section=doc.getElementById('education-entries')!; (section.querySelector('[data-field=title]') as HTMLInputElement).value='Degree';(section.querySelector('[data-field=organization]') as HTMLInputElement).value='College';
      doc.getElementById('profile-form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
      await until(()=>doc.getElementById('status')!.textContent!.includes('Profile saved'));
      expect((await service.get(candidate))?.data.education[0].title).toBe('Degree');
      expect(doc.getElementById('completion-text')!.textContent).not.toBe('0%');
      (doc.querySelector('#education-entries button') as HTMLButtonElement).click();
      expect(doc.querySelectorAll('#education-entries .entry')).toHaveLength(0);
      (doc.getElementById('reload') as HTMLButtonElement).click();await until(()=>doc.getElementById('status')!.textContent==='Saved profile loaded.');
      expect(doc.querySelectorAll('#education-entries .entry')).toHaveLength(1);
    }finally{dom.window.close();}
  });
  it('makes indexing opt-in only for public visibility and labels all editor inputs',async()=>{
    const dom=await editor();try{const doc=dom.window.document;const visibility=doc.getElementById('visibility') as HTMLSelectElement;const indexing=doc.getElementById('indexing') as HTMLInputElement;
      expect(indexing.disabled).toBe(true);visibility.value='PUBLIC';visibility.dispatchEvent(new dom.window.Event('change'));expect(indexing.disabled).toBe(false);expect(indexing.checked).toBe(false);indexing.checked=true;
      visibility.value='RECRUITERS_ONLY';visibility.dispatchEvent(new dom.window.Event('change'));expect(indexing.checked).toBe(false);expect(indexing.disabled).toBe(true);
      for(const element of Array.from(doc.querySelectorAll<HTMLInputElement>('input,textarea,select')))expect(element.labels?.length).toBeGreaterThan(0);
      expect(doc.querySelector('meta[name=viewport]')).toBeTruthy();expect(doc.querySelector('style')!.textContent).toContain('@media(max-width:600px)');
    }finally{dom.window.close();}
  });
  it('keeps unsaved edits after a stale-tab conflict and exposes closure through the UI',async()=>{
    await service.save(candidate,input());const dom=await editor();try{
      const doc=dom.window.document;const name=doc.getElementById('name') as HTMLInputElement;name.value='Unsaved change';
      await service.save(candidate,{...input(),revision:1});
      doc.getElementById('profile-form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
      await until(()=>doc.getElementById('status')!.textContent!.includes('another tab'));
      expect(name.value).toBe('Unsaved change');expect((await service.get(candidate))?.data.name).toBe('Synthetic Candidate');
      (doc.getElementById('close') as HTMLButtonElement).click();
      await until(()=>doc.getElementById('status')!.textContent!.includes('participation closed'));
      expect(doc.getElementById('profile-form')!.hidden).toBe(true);
    }finally{dom.window.close();}
  });
});
