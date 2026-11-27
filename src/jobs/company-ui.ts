import { jobsPage } from './profile-ui';

export function companyPage() {
  return jobsPage(`<h1>Companies</h1><p>Registration is free. Account email verification does not verify a company.</p>
<p id="message" role="status"></p>
<label for="company">Company workspace</label><select id="company"><option value="">Register a company</option></select>
<form id="company-form"><fieldset disabled><legend>Company profile</legend>
<label>Company name<input name="name" required maxlength="160"></label>
<label>Industry<input name="industry" maxlength="120"></label>
<label>Description<textarea name="description" maxlength="2000"></textarea></label>
<label>Website<input name="website" type="url" maxlength="300"></label>
<label>Location<input name="location" maxlength="160"></label>
<label>Organization size<select name="size"><option value="">Select size</option>${['1-10','11-50','51-200','201-1000','1001+'].map(size=>'<option>'+size+'</option>').join('')}</select></label>
<label>Business email<input name="businessEmail" type="email" maxlength="254"></label>
<button>Save company</button></fieldset></form>
<section id="workspace" hidden><h2>Recruitment workspace</h2><p><a id="manage-jobs">Manage job listings</a> · <a id="recruiter-workspace">Recruiter dashboard</a></p><p id="quota"></p>
<div id="management" hidden><h3>Members</h3><ul id="members"></ul><h3>Invitations</h3><ul id="invitations"></ul>
<form id="invite"><label>Recipient email<input name="email" type="email" required></label><label>Role<select name="role"><option value="RECRUITER">Recruiter</option><option value="COMPANY_ADMIN">Administrator</option></select></label><button>Create synthetic invitation</button></form>
<label id="handoff" hidden>Synthetic invitation code<input readonly id="code"></label></div></section>
<form id="accept"><fieldset><legend>Accept an invitation</legend><label>Invitation code<input name="code" required maxlength="101" autocomplete="off"></label><button>Accept invitation</button></fieldset></form>
<form id="report"><fieldset><legend>Report a company</legend><label>Company ID<input name="company" required maxlength="80"></label><label>Reason<select name="reason"><option>IMPERSONATION</option><option>FRAUD</option><option>ABUSE</option><option>OTHER</option></select></label><label>Details<input name="detail" maxlength="500"></label><button>Submit report</button></fieldset></form>`, script);
}

const script = `(() => {
  const get = id => document.getElementById(id);
  const selector = get('company'), form = get('company-form');
  const fields = ['name','industry','description','website','location','size','businessEmail'];
  let company = null, busy = false;
  async function api(path, method='GET', data) {
    const response = await fetch('/api/jobs/v1/'+path, {method, headers:method==='GET'?{}:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:data===undefined?undefined:JSON.stringify(data)});
    const value = await response.json();
    if(!response.ok) throw Error(({company_conflict:'The company changed. Reselect it before trying again.',jobs_ineligible:'Join BillionJobs from your profile first.',company_forbidden:'Your current role cannot perform this action.',company_invalid_invitation:'This invitation is no longer valid.',invalid_invitation:'Check the invitation code and signed-in account.'})[value.error] || 'The request could not be completed.');
    return value;
  }
  async function run(fn) {
    if(busy) return;
    busy=true; selector.disabled=true;
    try { await fn(); } catch(error) { get('message').textContent=error.message; }
    finally { busy=false; selector.disabled=false; }
  }
  function button(label, action) {
    const b=document.createElement('button'); b.type='button'; b.textContent=label;
    b.addEventListener('click',()=>run(action)); return b;
  }
  async function load(id='') {
    company=null; get('workspace').hidden=true; get('handoff').hidden=true; get('code').value='';
    selector.replaceChildren(new Option('Register a company',''));
    for(const row of await api('companies')) selector.add(new Option(row.name,row.id));
    selector.value=id;
    company=id?await api('companies/'+id):null;
    for(const key of fields) form.elements[key].value=company?company.data[key]:'';
    form.querySelector('fieldset').disabled=!!company&&(company.role==='RECRUITER'||company.restricted);
    if(!company)return;
    get('workspace').hidden=false; get('manage-jobs').href='/jobs/companies/'+encodeURIComponent(id)+'/jobs'; get('recruiter-workspace').href='/jobs/recruitment/companies/'+encodeURIComponent(id);
    const base='companies/'+id, current=company;
    get('quota').textContent=current.restricted?'Company restricted. Recruitment access is suspended.':'Free plan: 10 postings per IST day, 30 active listings, 30-day listing validity.';
    get('management').hidden=current.role==='RECRUITER'||current.restricted;
    get('invite').elements.role.options[1].disabled=current.role!=='OWNER';
    get('members').replaceChildren(); get('invitations').replaceChildren();
    for(const member of current.members) {
      const li=document.createElement('li');
      li.textContent=member.subject+' — '+member.role+(member.revoked_at===null?'':' (revoked)');
      if(member.revoked_at===null&&member.role!=='OWNER'&&(current.role==='OWNER'||member.role==='RECRUITER')){
        const path=base+'/members/'+encodeURIComponent(member.subject);
        li.append(button('Revoke access',async()=>{await api(path,'DELETE',{revision:current.revision}); await load(id);get('message').textContent='Access revoked.';}));
        if(current.role==='OWNER')li.append(button(member.role==='RECRUITER'?'Make administrator':'Make recruiter',async()=>{await api(path,'PUT',{revision:current.revision,role:member.role==='RECRUITER'?'COMPANY_ADMIN':'RECRUITER'});await load(id);get('message').textContent='Role updated.';}));
      }
      get('members').append(li);
    }
    for(const invite of current.invitations){
      const li=document.createElement('li');
      li.textContent=invite.role+' — '+(invite.used_at!==null?'Accepted':invite.revoked_at!==null?'Cancelled':invite.expires_at<=Date.now()?'Expired':'Pending');
      if(invite.used_at===null&&invite.revoked_at===null&&invite.expires_at>Date.now()&&(current.role==='OWNER'||invite.role==='RECRUITER'))li.append(button('Cancel invitation',async()=>{await api(base+'/invitations/'+invite.id,'DELETE',{revision:current.revision});await load(id);get('message').textContent='Invitation cancelled.';}));
      get('invitations').append(li);
    }
  }
  selector.addEventListener('change',()=>run(()=>load(selector.value)));
  function submit(id, fn){get(id).addEventListener('submit',event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));run(()=>fn(data));});}
  submit('company-form',async data=>{
    const saved=await api(company?'companies/'+company.id:'companies',company?'PUT':'POST',company?{revision:company.revision,data}:{data});
    await load(saved.id);get('message').textContent='Company saved.';
  });
  submit('invite',async data=>{
    const id=company.id;
    const invite=await api('companies/'+id+'/invitations','POST',{...data,revision:company.revision});
    await load(id);get('code').value=invite.id+'.'+invite.token;get('handoff').hidden=false;
    get('message').textContent='Invitation created for synthetic handoff.';
  });
  submit('accept',async data=>{
    const [id,token]=data.code.trim().split('.');
    if(!id||!token)throw Error('Enter the complete invitation code.');
    const joined=await api('company-invitations/'+encodeURIComponent(id)+'/accept','POST',{token});
    get('accept').reset();await load(joined.id);get('message').textContent='Invitation accepted.';
  });
  submit('report',async ({company,...data})=>{await api('companies/'+encodeURIComponent(company)+'/reports','POST',data);get('report').reset();get('message').textContent='Report submitted for review.';});
  run(()=>load());
})();`;
