import { identifier, JobsError, type Identity, type JobsDatabase } from './contracts';
import { requireEligible } from './permissions';
import { istDate } from './quota';

export type CompanyData = {name:string;industry:string;description:string;website:string;location:string;size:string;businessEmail:string};
type CompanyRow = {id:string;owner:string;data:string;revision:number;restricted:number;created_at:number};
type Role = 'COMPANY_ADMIN'|'RECRUITER';
export function companyObject(value:unknown, keys:string[]):Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k)) || keys.some(k=>!Object.hasOwn(value,k))) throw new JobsError(400,'invalid_company_input');
  return value as Record<string,unknown>;
}
function text(value:unknown,max:number,required=false,multiline=false):string {
  if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(multiline ? value.replace(/[\r\n\t]/g,'') : value))throw new JobsError(400,'invalid_company_input');
  const s=value.trim();if(required&&!s)throw new JobsError(400,'invalid_company_input');return s;
}
function email(value:unknown):string {const s=text(value,254,true).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw new JobsError(400,'invalid_email');return s;}
export async function digest(value:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
function role(value:unknown):Role {if(value!=='COMPANY_ADMIN'&&value!=='RECRUITER')throw new JobsError(400,'invalid_role');return value;}
function revision(value:unknown):number {if(!Number.isSafeInteger(value)||(value as number)<1)throw new JobsError(400,'invalid_revision');return value as number;}
function companyData(input:unknown):CompanyData {
  const p=companyObject(input,['name','industry','description','website','location','size','businessEmail']);
  let website=text(p.website,300);if(website){let url:URL;try{url=new URL(website);}catch{throw new JobsError(400,'invalid_website');}if(url.protocol!=='https:'||url.username||url.password)throw new JobsError(400,'invalid_website');website=url.href;}
  const size=text(p.size,20);if(!['','1-10','11-50','51-200','201-1000','1001+'].includes(size))throw new JobsError(400,'invalid_company_input');
  return {name:text(p.name,160,true),industry:text(p.industry,120),description:text(p.description,2000,false,true),website,location:text(p.location,160),size,businessEmail:p.businessEmail===''?'':email(p.businessEmail)};
}
export class Companies {
  constructor(private readonly db:JobsDatabase,private readonly clock:()=>number=Date.now){}
  private async verified(actor:Identity){await requireEligible(this.db,actor);if(!actor.recipientHash)throw new JobsError(403,'verified_identity_required');}
  private async command(actor:Identity,id:string,action:string,expected:number,payload:Record<string,unknown>){
    await this.verified(actor);identifier(id);
    await this.db.prepare('INSERT INTO company_events VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,actor.subject,action,expected,JSON.stringify(payload),this.clock()).run();
  }
  async list(actor:Identity){await this.verified(actor);const result=await this.db.prepare(`SELECT c.id,json_extract(c.data,'$.name') AS name,c.restricted,CASE WHEN c.owner=? THEN 'OWNER' ELSE m.role END AS role FROM companies c JOIN memberships m ON m.company=c.id WHERE m.subject=? AND m.revoked_at IS NULL ORDER BY c.created_at,c.id`).bind(actor.subject,actor.subject).all();return result.results;}
  async member(actor:Identity,id:string){
    await this.verified(actor);identifier(id);
    const row=await this.db.prepare(`SELECT c.*,m.role AS membership_role FROM companies c JOIN memberships m ON m.company=c.id WHERE c.id=? AND m.subject=? AND m.revoked_at IS NULL`).bind(id,actor.subject).first<CompanyRow & {membership_role:Role}>();
    if(!row)throw new JobsError(404,'company_not_found');return {...row,role:row.owner===actor.subject?'OWNER':row.membership_role};
  }
  async get(actor:Identity,id:string){
    const row=await this.member(actor,id);let members:unknown[]=[],invitations:unknown[]=[],events:unknown[]=[];
    if(row.role!=='RECRUITER'){
      members=(await this.db.prepare(`SELECT subject,CASE WHEN subject=? THEN 'OWNER' ELSE role END AS role,revoked_at FROM memberships WHERE company=? ORDER BY subject`).bind(row.owner,id).all()).results;
      invitations=(await this.db.prepare('SELECT id,role,expires_at,used_at,revoked_at FROM company_invitations WHERE company=? ORDER BY expires_at DESC LIMIT 100').bind(id).all()).results;
      events=(await this.db.prepare('SELECT actor,action,payload,at FROM company_events WHERE company=? ORDER BY at DESC,id DESC LIMIT 50').bind(id).all()).results;
    }
    const current = await this.member(actor,id);
    if (current.revision !== row.revision || current.role !== row.role) throw new JobsError(409,'company_conflict');
    return {id:row.id,data:JSON.parse(row.data) as CompanyData,revision:row.revision,restricted:!!row.restricted,role:row.role,members,invitations,events,verification:'Account email verified; company not independently verified'};
  }
  async create(actor:Identity,value:unknown){await this.verified(actor);const body=companyObject(value,['data']);const data=companyData(body.data);const id=crypto.randomUUID();await this.db.prepare('INSERT INTO companies(id,owner,data,created_at) VALUES(?,?,?,?)').bind(id,actor.subject,JSON.stringify(data),this.clock()).run();return this.get(actor,id);}
  async update(actor:Identity,id:string,value:unknown){const b=companyObject(value,['revision','data']);await this.member(actor,id);await this.command(actor,id,'PROFILE',revision(b.revision),{data:companyData(b.data)});return this.get(actor,id);}
  async invite(actor:Identity,id:string,value:unknown){
    const b=companyObject(value,['revision','email','role']);await this.member(actor,id);
    const recipientHash=await digest(email(b.email));if(recipientHash===actor.recipientHash)throw new JobsError(409,'already_member');
    const invitationId=crypto.randomUUID();const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    await this.command(actor,id,'INVITE',revision(b.revision),{id:invitationId,recipientHash,tokenHash:await digest(token),role:role(b.role)});
    // Synthetic handoff only. Never email, log, or store the bearer token in plaintext.
    return {id:invitationId,token,expiresAt:this.clock()+7*86400000,delivery:'synthetic-only'};
  }
  async accept(actor:Identity,invitationId:string,value:unknown){
    await this.verified(actor);identifier(invitationId);const b=companyObject(value,['token']);const token=text(b.token,64,true);if(!/^[a-f0-9]{64}$/.test(token))throw new JobsError(400,'invalid_invitation');
    const invite=await this.db.prepare(`SELECT i.company,c.revision FROM company_invitations i JOIN companies c ON c.id=i.company WHERE i.id=? AND i.recipient_hash=? AND i.token_hash=? AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?`).bind(invitationId,actor.recipientHash,await digest(token),this.clock()).first<{company:string;revision:number}>();
    if(!invite)throw new JobsError(404,'invalid_invitation');
    await this.command(actor,invite.company,'ACCEPT',invite.revision,{id:invitationId,recipientHash:actor.recipientHash,tokenHash:await digest(token)});return this.get(actor,invite.company);
  }
  async changeMember(actor:Identity,id:string,subject:string,value:unknown,remove=false){
    identifier(subject);const b=companyObject(value,remove?['revision']:['revision','role']);await this.member(actor,id);
    await this.command(actor,id,remove?'REVOKE':'ROLE',revision(b.revision),{subject,...(remove?{}:{role:role(b.role)})});return this.get(actor,id);
  }
  async cancel(actor:Identity,id:string,invitationId:string,value:unknown){const b=companyObject(value,['revision']);await this.member(actor,id);await this.command(actor,id,'CANCEL',revision(b.revision),{id:identifier(invitationId)});return this.get(actor,id);}
  async restrict(actor:Identity,id:string,value:unknown){
    const b=companyObject(value,['revision','restricted','reason']);if(typeof b.restricted!=='boolean'||!['FRAUD','ABUSE','REVIEW'].includes(String(b.reason)))throw new JobsError(400,'invalid_restriction');
    await this.command(actor,id,'RESTRICT',revision(b.revision),{restricted:Number(b.restricted),reason:b.reason});return {restricted:b.restricted};
  }
  async report(actor:Identity,id:string,value:unknown){
    await this.verified(actor);identifier(id);const b=companyObject(value,['reason','detail']);if(!['IMPERSONATION','FRAUD','ABUSE','OTHER'].includes(String(b.reason)))throw new JobsError(400,'invalid_report');const detail=text(b.detail,500);
    const result=await this.db.prepare(`INSERT INTO company_reports(id,company,reporter,reason,detail,at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM companies WHERE id=?) AND EXISTS(SELECT 1 FROM jobs_users WHERE subject=? AND eligible=1 AND restricted=0 AND closed_at IS NULL) AND EXISTS(SELECT 1 FROM restore_gate WHERE ready=1) ON CONFLICT(company,reporter,report_day) DO NOTHING RETURNING id`).bind(crypto.randomUUID(),id,actor.subject,b.reason,detail,this.clock(),id,actor.subject).first();
    return {received:!!result};
  }
  async entitlements(actor:Identity,id:string){
    const row=await this.member(actor,id);if(row.restricted)throw new JobsError(403,'company_restricted');const now=this.clock();
    const daily=await this.db.prepare("SELECT count(*) AS n FROM posting_actions WHERE company=? AND quota_day=? AND operation IN ('CREATE','RENEW','REOPEN')").bind(id,istDate(now)).first<{n:number}>();
    const active=await this.db.prepare("SELECT count(*) AS n FROM listings WHERE company=? AND state='ACTIVE' AND expires_at>?").bind(id,now).first<{n:number}>();
    return {plan:'FREE',dailyLimit:10,activeLimit:30,validityDays:30,quotaTimezone:'Asia/Kolkata',dailyUsed:daily?.n||0,activeUsed:active?.n||0,enforcement:'PostingQuota (EP-04)',postingInterfaceEnabled:false};
  }
}
