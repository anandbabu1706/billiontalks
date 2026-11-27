import { afterAll, beforeAll, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createJobsRuntime, seedIdentity } from '../scripts/jobs-runtime.mjs';
import { PostingQuota } from '../src/jobs/quota';
import { companyPage } from '../src/jobs/company-ui';

let runtime: Awaited<ReturnType<typeof createJobsRuntime>>;
const tokens = {owner:'a'.repeat(43), recruit:'b'.repeat(43), other:'c'.repeat(43), unverified:'d'.repeat(43)};
type User=keyof typeof tokens;
const root='/api/jobs/v1/';
const data={name:'Synthetic Co',industry:'Software',description:'Local fixture',website:'https://example.invalid',location:'Chennai',size:'1-10',businessEmail:'team@example.invalid'};
async function request(path:string,user:User='owner',method='GET',body?:unknown){
  return runtime.mf.dispatchFetch('http://localhost'+(path.startsWith('/')?path:root+path),{method,headers:{Cookie:'bt_account_session='+tokens[user],Origin:'http://localhost','Content-Type':'application/json','X-Jobs-Request':'1'},body:body===undefined?undefined:JSON.stringify(body)});
}
async function json<T>(path:string,user:User='owner',method='GET',body?:unknown,status=200):Promise<T>{
  const response=await request(path,user,method,body);
  const result=await response.json();
  expect(response.status,JSON.stringify(result)).toBe(status);
  return result as T;
}
type Company={id:string;revision:number;role:string;members:{subject:string;role:string}[]};
const register=(user:User='owner')=>json<Company>('companies',user,'POST',{data},201);
const get=(id:string)=>json<Company>('companies/'+id);
async function invite(c:Company,who:User,role='RECRUITER'){
  return json<{id:string;token:string}>('companies/'+c.id+'/invitations','owner','POST',{email:who+'@example.invalid',role,revision:c.revision},201);
}
const accept=(i:{id:string;token:string},user:User='recruit')=>request('company-invitations/'+i.id+'/accept',user,'POST',{token:i.token});
beforeAll(async()=>{
  runtime=await createJobsRuntime({enabled:true});
  for(const user of Object.keys(tokens) as User[]){
    await seedIdentity(runtime.accounts,user,tokens[user]);
    await runtime.jobs.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(user).run();
  }
  await runtime.accounts.prepare("UPDATE accounts SET email_verified_at=NULL WHERE id='unverified'").run();
},60000);
afterAll(async()=>{await runtime?.mf.dispose();});

it('registers verified companies with an owner and rejects unverified accounts and foreign reads',async()=>{
  expect((await request('companies','unverified','POST',{data})).status).toBe(401);
  const c=await register();
  expect(c.role).toBe('OWNER');
  expect(c.members).toEqual([expect.objectContaining({subject:'owner',role:'OWNER'})]);
  expect((await request('companies/'+c.id,'other')).status).toBe(404);
  expect((await request('companies/'+c.id,'other','PUT',{revision:1,data})).status).toBe(404);
  expect((await request('companies/'+c.id,'owner','PUT',{revision:1,data:{...data,website:'javascript:alert(1)'}})).status).toBe(400);
});
it('enforces bound, expiring, single-use invitations under concurrent acceptance',async()=>{
  const c=await register();
  const i=await invite(c,'recruit');
  expect((await accept(i,'other')).status).toBe(404);
  const statuses=await Promise.all([accept(i),accept(i)].map(async result=>(await result).status));
  expect(statuses.filter(status=>status===200)).toHaveLength(1);
  expect((await accept(i)).status).toBe(404);
  const expired=await invite(await get(c.id),'other');
  await runtime.jobs.prepare('UPDATE company_invitations SET expires_at=0 WHERE id=?').bind(expired.id).run();
  expect((await accept(expired,'other')).status).toBe(404);
});
it('scopes roles to each tenant and protects ownership during updates and closure',async()=>{
  const c=await register();const i=await invite(c,'other','COMPANY_ADMIN');
  expect((await accept(i,'other')).status).toBe(200);
  const current=await get(c.id);
  expect((await request('companies/'+c.id+'/invitations','other','POST',{revision:current.revision,email:'recruit@example.invalid',role:'COMPANY_ADMIN'})).status).toBe(403);
  expect((await request('companies/'+c.id+'/members/owner','owner','DELETE',{revision:current.revision})).status).toBe(409);
  expect((await request('closure','owner','POST',{})).status).toBe(409);
  const changes=await Promise.all(['First','Second'].map(name=>request('companies/'+c.id,'owner','PUT',{revision:current.revision,data:{...data,name}})));
  expect(changes.map(r=>r.status).sort()).toEqual([200,409]);
  expect((await request('companies/'+c.id+'/members/other','owner','DELETE',{revision:(await get(c.id)).revision})).status).toBe(200);
  expect((await request('companies/'+c.id,'other')).status).toBe(404);
});
it('reuses quota enforcement and blocks it when a moderator restricts a company',async()=>{
  const c=await register();
  const quota=new PostingQuota(runtime.jobs);
  const action={company:c.id,listing:'job',key:'start',operation:'CREATE' as const,revision:0,vacancy:{position:'Engineer',location:'Chennai',department:'Product',arrangement:'Remote'}};
  await quota.apply({subject:'owner'},action);
  expect(await json('companies/'+c.id+'/entitlements')).toMatchObject({dailyUsed:1,activeUsed:1,dailyLimit:10,activeLimit:30,validityDays:30});
  expect((await request('companies/'+c.id+'/restriction','owner','PUT',{revision:1,restricted:true,reason:'REVIEW'})).status).toBe(403);
  await runtime.jobs.prepare("INSERT INTO platform_roles VALUES('other','MODERATOR',NULL)").run();
  expect((await request('companies/'+c.id+'/restriction','other','PUT',{revision:1,restricted:true,reason:'REVIEW'})).status).toBe(200);
  await expect(quota.apply({subject:'owner'},action)).rejects.toMatchObject({status:403});
});
it('renders labeled company controls and submits registration through the dashboard',async()=>{
  const dom=new JSDOM(await companyPage().text(),{url:'http://localhost/jobs/companies',runScripts:'dangerously',beforeParse(window){
    Object.defineProperty(window,'fetch',{value:(path:string,options:RequestInit)=>request(path,'recruit',options.method,options.body?JSON.parse(String(options.body)):undefined)});
  }});
  try {
    const doc=dom.window.document;
    const form=doc.querySelector<HTMLFormElement>('#company-form')!;
    const selector=doc.querySelector<HTMLSelectElement>('#company')!;
    const until=async(check:()=>boolean)=>{for(let i=0;i<100&&!check();i++)await new Promise(r=>setTimeout(r,20));expect(check()).toBe(true);};
    await until(()=>!selector.disabled);
    (form.elements.namedItem('name') as HTMLInputElement).value='Dashboard company';
    form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    await until(()=>doc.querySelector('#message')?.textContent==='Company saved.');
    expect(doc.querySelector<HTMLDivElement>('#workspace')?.hidden).toBe(false);
    for(const el of doc.querySelectorAll<HTMLInputElement>('input,select,textarea'))expect(el.labels?.length).toBeGreaterThan(0);
  }finally{dom.window.close();}
});
