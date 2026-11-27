import { JobsError } from './contracts';
import type { ListingData } from './marketplace';

export type MatchConfig={skills:number;experience:number;qualifications:number;preferences:number};
export const defaultMatchConfig:MatchConfig=Object.freeze({skills:40,experience:25,qualifications:20,preferences:15});
type Entry={title?:unknown;organization?:unknown;start?:unknown;end?:unknown;description?:unknown};
type Profile=Record<string,unknown>;

export function validateMatchConfig(value:unknown):MatchConfig {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new JobsError(400,'invalid_match_config');
  const row=value as Record<string,unknown>, keys=['skills','experience','qualifications','preferences'];
  if (Object.keys(row).sort().join()!==keys.sort().join() || keys.some(key=>!Number.isSafeInteger(row[key]) || (row[key] as number)<0 || (row[key] as number)>100)) throw new JobsError(400,'invalid_match_config');
  const result=row as MatchConfig;
  if (Object.values(result).reduce((sum,item)=>sum+item,0)!==100) throw new JobsError(400,'invalid_match_config');
  return result;
}
function months(entries:Entry[]):number {
  let total=0;
  for(const entry of entries.slice(0,20)) {
    const start=typeof entry.start==='string'&&/^\d{4}-\d{2}$/.test(entry.start)?entry.start:null;
    const end=typeof entry.end==='string'&&/^\d{4}-\d{2}$/.test(entry.end)?entry.end:new Date().toISOString().slice(0,7);
    if(start&&end>=start){const [sy,sm]=start.split('-').map(Number),[ey,em]=end.split('-').map(Number);total+=Math.max(0,(ey-sy)*12+em-sm);}
  }
  return total;
}
export function explainMatch(job:ListingData,profile:Profile,config:MatchConfig=defaultMatchConfig) {
  const skills=Array.isArray(profile.skills)?profile.skills.filter((v):v is string=>typeof v==='string').map(v=>v.toLowerCase()):null;
  const required=job.requiredSkills.map(v=>v.toLowerCase());
  const matchedSkills=skills?job.requiredSkills.filter((_,index)=>skills.includes(required[index])):[];
  const missingSkills=skills?job.requiredSkills.filter((_,index)=>!skills.includes(required[index])):[];
  const experience=Array.isArray(profile.experience)?months(profile.experience as Entry[])/12:null;
  const qualifications=[...(Array.isArray(profile.education)?profile.education:[]),...(Array.isArray(profile.certifications)?profile.certifications:[])];
  const preferences=profile.preferences&&typeof profile.preferences==='object'?profile.preferences as Record<string,unknown>:null;
  const preferenceMatches:string[]=[];
  if(preferences){if(typeof preferences.locations==='string'&&preferences.locations.toLowerCase().includes(job.location.toLowerCase()))preferenceMatches.push('location');if(typeof preferences.workMode==='string'&&preferences.workMode===job.arrangement)preferenceMatches.push('work arrangement');if(typeof preferences.roles==='string'&&preferences.roles.toLowerCase().includes(job.title.toLowerCase()))preferenceMatches.push('role');}
  const criteria=[
    {name:'skills',weight:config.skills,status:skills===null||skills.length===0?'UNKNOWN':matchedSkills.length===required.length?'MATCH':matchedSkills.length?'PARTIAL':'NO_MATCH',explanation:skills===null||skills.length===0?'Skills were not disclosed.':`${matchedSkills.length} of ${required.length} required skills matched.`,matched:matchedSkills,unmatched:missingSkills},
    {name:'experience',weight:config.experience,status:experience===null?'UNKNOWN':experience>=job.experienceMin&&experience<=job.experienceMax?'MATCH':experience>=job.experienceMin?'PARTIAL':'NO_MATCH',explanation:experience===null?'Experience was not disclosed.':`${experience.toFixed(1)} disclosed years compared with ${job.experienceMin}–${job.experienceMax} requested years.`},
    {name:'qualifications',weight:config.qualifications,status:qualifications.length===0?'UNKNOWN':'PARTIAL',explanation:qualifications.length===0?'Education and certifications were not disclosed.':'Disclosed education/certifications are available for human review; free-text equivalence is not assumed.'},
    {name:'preferences',weight:config.preferences,status:preferences===null?'UNKNOWN':preferenceMatches.length?'PARTIAL':'NO_MATCH',explanation:preferences===null?'Career preferences were not disclosed.':preferenceMatches.length?`Matched ${preferenceMatches.join(', ')} preference.`:'No explicit preference match was found.',matched:preferenceMatches}
  ];
  const known=criteria.filter(c=>c.status!=='UNKNOWN');
  const points=known.reduce((sum,c)=>sum+c.weight*(c.status==='MATCH'?1:c.status==='PARTIAL'?0.5:0),0);
  const denominator=known.reduce((sum,c)=>sum+c.weight,0);
  return {label:'Rules-based matching — human review required',score:denominator?Math.round(points/denominator*100):null,config,criteria,unknown:criteria.filter(c=>c.status==='UNKNOWN').map(c=>c.name),automaticDecision:false};
}

export type IntelligencePurpose='MATCH_EXPLANATION'|'NATURAL_LANGUAGE_SEARCH'|'JOB_DESCRIPTION_ASSISTANCE'|'RECRUITER_ASSISTANCE'|'INTERVIEW_PREPARATION'|'INTERVIEW_QUESTION_ASSISTANCE'|'INTERVIEWER_ASSISTANCE'|'MULTILINGUAL_INTERVIEW_ASSISTANCE'|'INTERVIEW_SUMMARY_ASSISTANCE'|'SKILL_GAP_EXPLANATION'|'FEEDBACK_ASSISTANCE'|'SCAM_REVIEW'|'SUSPICIOUS_ACTIVITY_REVIEW'|'COMPLAINT_CATEGORIZATION'|'MULTILINGUAL_MODERATION'|'SECURITY_ALERT_REVIEW'|'INVESTIGATION_SUMMARY'|'MODERATION_ASSISTANCE';
export type IntelligenceProvider={name:string;model:string;version:string;run(input:{purpose:IntelligencePurpose;data:Record<string,unknown>}):Promise<{text:string;attributes?:Record<string,string|number|boolean>}>};
export type IntelligenceRequest={purpose:IntelligencePurpose;authorized:boolean;consent:boolean;consentRequired:boolean;data:Record<string,unknown>;timeoutMs:number};
const PURPOSES:IntelligencePurpose[]=['MATCH_EXPLANATION','NATURAL_LANGUAGE_SEARCH','JOB_DESCRIPTION_ASSISTANCE','RECRUITER_ASSISTANCE','INTERVIEW_PREPARATION','INTERVIEW_QUESTION_ASSISTANCE','INTERVIEWER_ASSISTANCE','MULTILINGUAL_INTERVIEW_ASSISTANCE','INTERVIEW_SUMMARY_ASSISTANCE','SKILL_GAP_EXPLANATION','FEEDBACK_ASSISTANCE','SCAM_REVIEW','SUSPICIOUS_ACTIVITY_REVIEW','COMPLAINT_CATEGORIZATION','MULTILINGUAL_MODERATION','SECURITY_ALERT_REVIEW','INVESTIGATION_SUMMARY','MODERATION_ASSISTANCE'];
const FORBIDDEN=/(aadhaar|date.?of.?birth|dob|religion|caste|gender|marital|disability|health|email|phone|address)/i;
export async function executeRecruitmentExtension(request:IntelligenceRequest,provider?:IntelligenceProvider) {
  if(!PURPOSES.includes(request.purpose)||request.authorized!==true||(request.consentRequired&&request.consent!==true)||!Number.isSafeInteger(request.timeoutMs)||request.timeoutMs<50||request.timeoutMs>2000||!request.data||typeof request.data!=='object'||Array.isArray(request.data))throw new JobsError(403,'intelligence_not_authorized');
  if(Object.keys(request.data).some(key=>FORBIDDEN.test(key)))throw new JobsError(400,'intelligence_field_forbidden');
  const encoded=JSON.stringify(request.data);if(encoded.length>16384)throw new JobsError(413,'intelligence_input_too_large');
  const requestId=crypto.randomUUID(),limits={inputCharacters:16384,outputCharacters:4000,timeoutMs:request.timeoutMs};
  const fallback={used:false,reason:provider?'provider_timeout_or_invalid':'provider_not_configured',text:'Use the deterministic rules-based workflow.',humanApprovalRequired:true};
  if(!provider)return {purpose:request.purpose,audit:{requestId,consentRecorded:request.consent,provider:null},limits,fallback};
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const result=await Promise.race([provider.run({purpose:request.purpose,data:JSON.parse(encoded)}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),request.timeoutMs);})]);
    const audit={requestId,consentRecorded:request.consent,provider:{name:provider.name,model:provider.model,version:provider.version}};
    if(!result||typeof result.text!=='string'||!result.text.trim()||result.text.length>4000||result.attributes&&Object.values(result.attributes).some(value=>!['string','number','boolean'].includes(typeof value)))return {purpose:request.purpose,audit,limits,fallback};
    return {purpose:request.purpose,audit,limits,output:{text:result.text.trim(),attributes:result.attributes||{},provenance:{provider:provider.name,model:provider.model,version:provider.version},humanApprovalRequired:true,automaticAction:false},fallback:null};
  }catch{return {purpose:request.purpose,audit:{requestId,consentRecorded:request.consent,provider:{name:provider.name,model:provider.model,version:provider.version}},limits,fallback};}finally{if(timer!==undefined)clearTimeout(timer);}
}

export type GovernancePurpose=Extract<IntelligencePurpose,'SCAM_REVIEW'|'SUSPICIOUS_ACTIVITY_REVIEW'|'COMPLAINT_CATEGORIZATION'|'MULTILINGUAL_MODERATION'|'SECURITY_ALERT_REVIEW'|'INVESTIGATION_SUMMARY'|'MODERATION_ASSISTANCE'>;
const GOVERNANCE_FIELDS=new Set(['ruleIds','category','severity','publicListingExcerpt','redactedCaseSummary','language','signalCount']);
/** BJ-AI-014/015/019 contract. No provider is wired into Jobs routes. */
export async function executeGovernanceExtension(input:{purpose:GovernancePurpose;authorized:boolean;caseRef:string;data:Record<string,unknown>},provider?:IntelligenceProvider){
  if(!input.authorized||!/^[\w-]{1,80}$/.test(input.caseRef)||!input.data||Object.keys(input.data).some(key=>!GOVERNANCE_FIELDS.has(key)))throw new JobsError(403,'governance_intelligence_forbidden');
  const result=await executeRecruitmentExtension({purpose:input.purpose,authorized:true,consent:false,consentRequired:false,data:input.data,timeoutMs:1000},provider);
  return {...result,product:'BILLIONJOBS',caseRef:input.caseRef,automaticDecision:false,humanReviewRequired:true};
}
