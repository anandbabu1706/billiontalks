import { identifier, JobsError, type Identity, type JobsDatabase } from './contracts';
import { requireAssigned, requireCompany, requireEligible } from './permissions';
import { PostingQuota, type PostingAction } from './quota';

const EMPLOYMENT = ['FULL_TIME','PART_TIME','CONTRACT','INTERNSHIP','TEMPORARY'] as const;
const ARRANGEMENT = ['ONSITE','HYBRID','REMOTE'] as const;
const APPLICATION_FIELDS = ['name','headline','summary','location','experience','education','skills','certifications','openToWork','preferences'] as const;
type Employment = typeof EMPLOYMENT[number];
type Arrangement = typeof ARRANGEMENT[number];

export type ListingData = {
  title:string; department:string; description:string; responsibilities:string;
  requiredSkills:string[]; qualifications:string; experienceMin:number; experienceMax:number;
  employmentType:Employment; arrangement:Arrangement; location:string; vacancies:number;
  salaryMin:number|null; salaryMax:number|null; currency:string;
};
type ListingRow = {company:string;id:string;data:string;publication:string;revision:number;created_at:number;updated_at:number;posted_at:number|null;state?:string;expires_at?:number};
type ApplicationRow = {id:string;candidate:string;company:string;listing:string;attempt:number;status:string;snapshot:string;created_at:number;updated_at:number;withdrawn_at:number|null;restricted:number};

function object(value:unknown, keys:string[]):Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new JobsError(400,'invalid_marketplace_input');
  if (Object.keys(value).some(key=>!keys.includes(key)) || keys.some(key=>!Object.hasOwn(value,key))) throw new JobsError(400,'invalid_marketplace_input');
  return value as Record<string,unknown>;
}
function text(value:unknown,max:number,required=false,multiline=false):string {
  if (typeof value!=='string' || value.length>max) throw new JobsError(400,'invalid_marketplace_input');
  const checked=multiline ? value.replace(/[\r\n\t]/g,'') : value;
  if (/[\u0000-\u001f\u007f]/.test(checked)) throw new JobsError(400,'invalid_marketplace_input');
  const result=value.trim();
  if (required && !result) throw new JobsError(400,'invalid_marketplace_input');
  return result;
}
function integer(value:unknown,min:number,max:number):number {
  if (!Number.isSafeInteger(value) || (value as number)<min || (value as number)>max) throw new JobsError(400,'invalid_marketplace_input');
  return value as number;
}
function optionalMoney(value:unknown):number|null {
  if (value===null) return null;
  return integer(value,0,1_000_000_000);
}
function listingData(value:unknown):ListingData {
  const row=object(value,['title','department','description','responsibilities','requiredSkills','qualifications','experienceMin','experienceMax','employmentType','arrangement','location','vacancies','salaryMin','salaryMax','currency']);
  if (!Array.isArray(row.requiredSkills) || row.requiredSkills.length>30) throw new JobsError(400,'invalid_marketplace_input');
  const requiredSkills=row.requiredSkills.map(skill=>text(skill,60,true));
  if (new Set(requiredSkills.map(skill=>skill.toLowerCase())).size!==requiredSkills.length) throw new JobsError(400,'invalid_marketplace_input');
  const experienceMin=integer(row.experienceMin,0,80);
  const experienceMax=integer(row.experienceMax,experienceMin,80);
  if (!EMPLOYMENT.includes(row.employmentType as Employment) || !ARRANGEMENT.includes(row.arrangement as Arrangement)) throw new JobsError(400,'invalid_marketplace_input');
  const salaryMin=optionalMoney(row.salaryMin);
  const salaryMax=optionalMoney(row.salaryMax);
  if ((salaryMin===null)!==(salaryMax===null) || (salaryMin!==null && salaryMax!==null && salaryMax<salaryMin)) throw new JobsError(400,'invalid_marketplace_input');
  const currency=salaryMin===null ? '' : text(row.currency,3,true).toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw new JobsError(400,'invalid_marketplace_input');
  return {
    title:text(row.title,160,true),department:text(row.department,120),description:text(row.description,5000,true,true),
    responsibilities:text(row.responsibilities,5000,false,true),requiredSkills,qualifications:text(row.qualifications,3000,false,true),
    experienceMin,experienceMax,employmentType:row.employmentType as Employment,arrangement:row.arrangement as Arrangement,
    location:text(row.location,160,true),vacancies:integer(row.vacancies,1,1000),salaryMin,salaryMax,currency,
  };
}
function listingView(row:ListingRow) {
  return {...row,data:JSON.parse(row.data) as ListingData};
}
function escapeLike(value:string):string {
  return value.replace(/[\\%_]/g,character=>'\\'+character);
}
function fields(value:unknown):string[] {
  if (!Array.isArray(value) || !value.length || value.length>APPLICATION_FIELDS.length) throw new JobsError(400,'invalid_disclosure');
  if (value.some(field=>typeof field!=='string' || !APPLICATION_FIELDS.includes(field as typeof APPLICATION_FIELDS[number]))) throw new JobsError(400,'invalid_disclosure');
  if (new Set(value).size!==value.length || !value.includes('name')) throw new JobsError(400,'invalid_disclosure');
  return value as string[];
}
function marketplaceError(error:unknown):never {
  const code=String(error).match(/(application_(?:forbidden|listing_unavailable|duplicate|reapply_denied|wait_required|conflict)|jobs_(?:forbidden|conflict|daily_limit|active_limit|duplicate))/)?.[1];
  if (code) {
    const status=code==='application_listing_unavailable' ? 409 : code.endsWith('forbidden') ? 403 : 409;
    throw new JobsError(status,code);
  }
  throw error;
}

export class Marketplace {
  constructor(private readonly db:JobsDatabase, private readonly clock:()=>number=Date.now) {}

  private async verified(actor:Identity):Promise<void> {
    await requireEligible(this.db,actor);
    if (!actor.recipientHash) throw new JobsError(403,'verified_identity_required');
  }

  async createDraft(actor:Identity,company:string,value:unknown) {
    await this.verified(actor);
    await requireCompany(this.db,actor,identifier(company));
    const body=object(value,['data']);
    const data=listingData(body.data);
    const id=crypto.randomUUID();
    const now=this.clock();
    await this.db.prepare("INSERT INTO listing_details(company,id,data,publication,created_at,updated_at) VALUES(?,?,?,'DRAFT',?,?)")
      .bind(company,id,JSON.stringify(data),now,now).run();
    await this.db.prepare("INSERT INTO listing_audit VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),company,id,actor.subject,'DRAFT',now).run();
    return this.manage(actor,company,id);
  }

  async manage(actor:Identity,company:string,id:string) {
    await this.verified(actor);
    await requireCompany(this.db,actor,identifier(company));
    identifier(id);
    const row=await this.db.prepare(`SELECT d.*,l.state,l.expires_at FROM listing_details d LEFT JOIN listings l ON l.company=d.company AND l.id=d.id WHERE d.company=? AND d.id=?`).bind(company,id).first<ListingRow>();
    if (!row) throw new JobsError(404,'listing_not_found');
    return listingView(row);
  }

  async companyListings(actor:Identity,company:string) {
    await this.verified(actor);
    await requireCompany(this.db,actor,identifier(company));
    const rows=await this.db.prepare(`SELECT d.*,l.state,l.expires_at FROM listing_details d LEFT JOIN listings l ON l.company=d.company AND l.id=d.id WHERE d.company=? ORDER BY d.updated_at DESC,d.id LIMIT 100`).bind(company).all<ListingRow>();
    return rows.results.map(listingView);
  }

  async update(actor:Identity,company:string,id:string,value:unknown) {
    const body=object(value,['revision','data','key']);
    const current=await this.manage(actor,company,id);
    const expected=integer(body.revision,0,Number.MAX_SAFE_INTEGER);
    if (current.revision!==expected) throw new JobsError(409,'listing_conflict');
    const data=listingData(body.data);
    if (current.publication==='DRAFT') {
      const updated=await this.db.prepare(`UPDATE listing_details SET data=?,revision=revision+1,updated_at=? WHERE company=? AND id=? AND publication='DRAFT' AND revision=? RETURNING id`)
        .bind(JSON.stringify(data),this.clock(),company,id,expected).first();
      if (!updated) throw new JobsError(409,'listing_conflict');
      return this.manage(actor,company,id);
    }
    await this.posting(actor,company,id,'EDIT',expected,text(body.key,80,true),data);
    return this.manage(actor,company,id);
  }

  async publish(actor:Identity,company:string,id:string,value:unknown) {
    const body=object(value,['revision','key']);
    const current=await this.manage(actor,company,id);
    if (current.publication!=='DRAFT' || current.revision!==integer(body.revision,0,Number.MAX_SAFE_INTEGER)) throw new JobsError(409,'listing_conflict');
    await this.posting(actor,company,id,'CREATE',0,text(body.key,80,true),current.data);
    return this.manage(actor,company,id);
  }

  async lifecycle(actor:Identity,company:string,id:string,operation:'CLOSE'|'RENEW'|'REOPEN'|'ARCHIVE',value:unknown) {
    const body=object(value,['revision','key']);
    await this.manage(actor,company,id);
    await this.posting(actor,company,id,operation,integer(body.revision,1,Number.MAX_SAFE_INTEGER),text(body.key,80,true));
    return this.manage(actor,company,id);
  }

  private async posting(actor:Identity,company:string,id:string,operation:PostingAction['operation'],revision:number,key:string,data?:ListingData) {
    const source=data ?? (await this.manage(actor,company,id)).data;
    try {
      await new PostingQuota(this.db,this.clock).apply(actor,{company,listing:id,key,operation,revision,
        vacancy:{position:source.title,location:source.location,department:source.department,arrangement:source.arrangement},details:data});
    } catch(error) {
      marketplaceError(error);
    }
  }

  async search(url:URL) {
    const page=integer(Number(url.searchParams.get('page')||1),1,1000);
    const limit=integer(Number(url.searchParams.get('limit')||20),1,50);
    const clauses=["d.publication='PUBLISHED'","l.state='ACTIVE'","l.expires_at>?","c.restricted=0"];
    const values:unknown[]=[this.clock()];
    const filter=(name:string,path:string,max=160)=>{
      const value=text(url.searchParams.get(name)||'',max);
      if (value) { clauses.push(`json_extract(d.data,'$.${path}')=?`); values.push(value); }
    };
    filter('location','location'); filter('employmentType','employmentType',30); filter('arrangement','arrangement',30);
    const industry=text(url.searchParams.get('industry')||'',120);
    if (industry) { clauses.push("json_extract(c.data,'$.industry')=?"); values.push(industry); }
    const keyword=text(url.searchParams.get('q')||'',120);
    if (keyword) { clauses.push("(json_extract(d.data,'$.title') LIKE ? ESCAPE '\\' OR json_extract(d.data,'$.description') LIKE ? ESCAPE '\\')"); const pattern='%'+escapeLike(keyword)+'%'; values.push(pattern,pattern); }
    const skill=text(url.searchParams.get('skill')||'',60);
    if (skill) { clauses.push("EXISTS(SELECT 1 FROM json_each(d.data,'$.requiredSkills') WHERE lower(value)=lower(?))"); values.push(skill); }
    const experience=url.searchParams.get('experience');
    if (experience!==null && experience!=='') { const years=integer(Number(experience),0,80); clauses.push("json_extract(d.data,'$.experienceMin')<=? AND json_extract(d.data,'$.experienceMax')>=?"); values.push(years,years); }
    const salary=url.searchParams.get('salary');
    if (salary!==null && salary!=='') { const amount=integer(Number(salary),0,1_000_000_000); clauses.push("json_extract(d.data,'$.salaryMax') IS NOT NULL AND json_extract(d.data,'$.salaryMax')>=?"); values.push(amount); }
    const postedAfter=url.searchParams.get('postedAfter');
    if (postedAfter) { const timestamp=Date.parse(postedAfter); if (!Number.isFinite(timestamp)) throw new JobsError(400,'invalid_search'); clauses.push('d.posted_at>=?'); values.push(timestamp); }
    const sort=url.searchParams.get('sort')||'newest';
    const order=sort==='expiry' ? 'l.expires_at ASC,d.id' : sort==='salary' ? "COALESCE(json_extract(d.data,'$.salaryMax'),-1) DESC,d.posted_at DESC,d.id" : 'd.posted_at DESC,d.id';
    if (!['newest','expiry','salary'].includes(sort)) throw new JobsError(400,'invalid_search');
    const where=clauses.join(' AND ');
    const count=await this.db.prepare(`SELECT count(*) AS n FROM listing_details d JOIN listings l ON l.company=d.company AND l.id=d.id JOIN companies c ON c.id=d.company WHERE ${where}`).bind(...values).first<{n:number}>();
    const rows=await this.db.prepare(`SELECT d.*,l.state,l.expires_at,json_extract(c.data,'$.name') AS company_name,json_extract(c.data,'$.industry') AS industry FROM listing_details d JOIN listings l ON l.company=d.company AND l.id=d.id JOIN companies c ON c.id=d.company WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...values,limit,(page-1)*limit).all<ListingRow & {company_name:string;industry:string}>();
    return {items:rows.results.map(listingView),page,limit,total:count?.n||0,pages:Math.ceil((count?.n||0)/limit)};
  }

  async publicListing(company:string,id:string) {
    identifier(company); identifier(id);
    const row=await this.db.prepare(`SELECT d.*,l.state,l.expires_at,json_extract(c.data,'$.name') AS company_name,json_extract(c.data,'$.industry') AS industry,json_extract(c.data,'$.description') AS company_description,json_extract(c.data,'$.website') AS company_website,json_extract(c.data,'$.location') AS company_location,json_extract(c.data,'$.size') AS company_size FROM listing_details d JOIN listings l ON l.company=d.company AND l.id=d.id JOIN companies c ON c.id=d.company WHERE d.company=? AND d.id=? AND d.publication='PUBLISHED' AND l.state='ACTIVE' AND l.expires_at>? AND c.restricted=0`).bind(company,id,this.clock()).first<ListingRow>();
    if (!row) throw new JobsError(404,'listing_not_found');
    return listingView(row);
  }

  async save(actor:Identity,company:string,id:string) {
    await this.verified(actor);
    await this.publicListing(company,id);
    await this.db.prepare('INSERT OR IGNORE INTO saved_jobs VALUES(?,?,?,?)').bind(actor.subject,company,id,this.clock()).run();
    return {saved:true};
  }

  async unsave(actor:Identity,company:string,id:string) {
    await this.verified(actor); identifier(company); identifier(id);
    await this.db.prepare('DELETE FROM saved_jobs WHERE candidate=? AND company=? AND listing=?').bind(actor.subject,company,id).run();
    return {saved:false};
  }

  async saved(actor:Identity) {
    await this.verified(actor);
    const rows=await this.db.prepare(`SELECT d.*,l.state,l.expires_at,s.saved_at FROM saved_jobs s JOIN listing_details d ON d.company=s.company AND d.id=s.listing LEFT JOIN listings l ON l.company=d.company AND l.id=d.id WHERE s.candidate=? ORDER BY s.saved_at DESC LIMIT 100`).bind(actor.subject).all<ListingRow>();
    return rows.results.map(row=>({...listingView(row),available:row.publication==='PUBLISHED'&&row.state==='ACTIVE'&&(row.expires_at||0)>this.clock()}));
  }

  async disclosure(actor:Identity,company:string,id:string,selected:unknown) {
    await this.verified(actor);
    const listing=await this.publicListing(company,id);
    const selectedFields=fields(selected);
    const profile=await this.db.prepare('SELECT id,revision,data FROM jobs_profiles WHERE subject=?').bind(actor.subject).first<{id:string;revision:number;data:string}>();
    if (!profile) throw new JobsError(409,'profile_required');
    const profileData=JSON.parse(profile.data) as Record<string,unknown>;
    const disclosed=Object.fromEntries(selectedFields.map(field=>[field,profileData[field]]));
    return {listing:{company,id,title:listing.data.title},profile:{id:profile.id,revision:profile.revision,fields:disclosed},notice:'This snapshot remains with the application if general profile visibility changes.'};
  }

  async apply(actor:Identity,company:string,id:string,value:unknown) {
    const body=object(value,['key','fields']);
    const key=identifier(text(body.key,80,true));
    const snapshot=await this.disclosure(actor,company,id,body.fields);
    const prior=await this.db.prepare('SELECT payload,result_id FROM application_requests WHERE candidate=? AND company=? AND listing=? AND request_key=?').bind(actor.subject,company,id,key).first<{payload:string;result_id:string}>();
    if (prior) {
      const priorSnapshot=(JSON.parse(prior.payload) as {snapshot:unknown}).snapshot;
      if (JSON.stringify(priorSnapshot)!==JSON.stringify(snapshot) || !prior.result_id) throw new JobsError(409,'idempotency_conflict');
      return this.application(actor,prior.result_id);
    }
    const payload=JSON.stringify({id:crypto.randomUUID(),snapshot});
    try {
      await this.db.prepare(`INSERT INTO application_requests(candidate,company,listing,request_key,payload,at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM application_requests WHERE candidate=? AND company=? AND listing=? AND request_key=?)`)
        .bind(actor.subject,company,id,key,payload,this.clock(),actor.subject,company,id,key).run();
    } catch(error) { marketplaceError(error); }
    const result=await this.db.prepare('SELECT payload,result_id FROM application_requests WHERE candidate=? AND company=? AND listing=? AND request_key=?').bind(actor.subject,company,id,key).first<{payload:string;result_id:string}>();
    if (!result || !result.result_id) throw new JobsError(409,'idempotency_conflict');
    const resultSnapshot=(JSON.parse(result.payload) as {snapshot:unknown}).snapshot;
    if (JSON.stringify(resultSnapshot)!==JSON.stringify(snapshot)) throw new JobsError(409,'idempotency_conflict');
    return this.application(actor,result.result_id);
  }

  async application(actor:Identity,id:string) {
    await this.verified(actor); identifier(id);
    const row=await this.db.prepare(`SELECT * FROM applications WHERE id=? AND candidate=? AND restricted=0 AND NOT EXISTS(SELECT 1 FROM deletion_ledger WHERE record_id=applications.id)`).bind(id,actor.subject).first<ApplicationRow>();
    if (!row) throw new JobsError(404,'application_not_found');
    return {...row,snapshot:JSON.parse(row.snapshot)};
  }

  async history(actor:Identity) {
    await this.verified(actor);
    const rows=await this.db.prepare(`SELECT a.*,r.status AS recruitment_status,r.revision AS recruitment_revision,json_extract(d.data,'$.title') AS title,json_extract(c.data,'$.name') AS company_name FROM applications a JOIN recruitment_cases r ON r.application=a.id JOIN listing_details d ON d.company=a.company AND d.id=a.listing JOIN companies c ON c.id=a.company WHERE a.candidate=? AND a.restricted=0 AND NOT EXISTS(SELECT 1 FROM deletion_ledger WHERE record_id=a.id) ORDER BY a.created_at DESC,a.id LIMIT 200`).bind(actor.subject).all<ApplicationRow>();
    return rows.results.map(row=>({...row,snapshot:JSON.parse(row.snapshot)}));
  }

  async withdraw(actor:Identity,id:string) {
    const current=await this.application(actor,id);
    try {
      await this.db.prepare("INSERT INTO application_events VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),id,actor.subject,'WITHDRAW',current.status,this.clock()).run();
    } catch(error) { marketplaceError(error); }
    return this.application(actor,id);
  }

  async assignedApplications(actor:Identity,company:string,listing:string) {
    await this.verified(actor);
    await requireAssigned(this.db,actor,identifier(company),identifier(listing));
    const rows=await this.db.prepare(`SELECT * FROM applications WHERE company=? AND listing=? AND restricted=0 AND NOT EXISTS(SELECT 1 FROM deletion_ledger WHERE record_id=applications.id) ORDER BY created_at,id LIMIT 200`).bind(company,listing).all<ApplicationRow>();
    return rows.results.map(row=>({...row,snapshot:JSON.parse(row.snapshot)}));
  }

  async transitionAssigned(actor:Identity,application:string,action:'REJECT') {
    await this.verified(actor); identifier(application);
    const row=await this.db.prepare('SELECT company,listing,status FROM applications WHERE id=?').bind(application).first<{company:string;listing:string;status:string}>();
    if (!row) throw new JobsError(404,'application_not_found');
    await requireAssigned(this.db,actor,row.company,row.listing);
    try { await this.db.prepare('INSERT INTO application_events VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),application,actor.subject,action,row.status,this.clock()).run(); }
    catch(error) { marketplaceError(error); }
  }

  async report(actor:Identity,company:string,id:string,value:unknown) {
    await this.verified(actor); identifier(company); identifier(id);
    const body=object(value,['reason','detail']);
    if (!['MISLEADING','FRAUD','ABUSE','OTHER'].includes(String(body.reason))) throw new JobsError(400,'invalid_report');
    const detail=text(body.detail,500);
    const result=await this.db.prepare(`INSERT INTO listing_reports(id,company,listing,reporter,reason,detail,at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM listing_details WHERE company=? AND id=?) ON CONFLICT(company,listing,reporter,report_day) DO NOTHING RETURNING id`)
      .bind(crypto.randomUUID(),company,id,actor.subject,body.reason,detail,this.clock(),company,id).first();
    return {received:!!result};
  }
}
