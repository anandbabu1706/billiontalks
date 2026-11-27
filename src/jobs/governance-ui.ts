import { jobsPage } from './profile-ui';
export function administrationPage(canReadCases = true, canManageRoles = false):Response{
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>BillionJobs administration</title><style>
  :root{font-family:system-ui,sans-serif;color:#17213b;background:#f5f7fb}body{margin:0}main{max-width:1100px;margin:auto;padding:1.5rem}h1{font-size:clamp(1.6rem,4vw,2.5rem)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1rem}.card{background:white;border:1px solid #d9e0ee;border-radius:.7rem;padding:1rem;min-height:6rem}.card strong{display:block;font-size:1.8rem;margin-top:.5rem}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;border-bottom:1px solid #d9e0ee;padding:.7rem}label{display:block;margin:1rem 0}button,select{font:inherit;padding:.5rem}button:focus-visible,select:focus-visible{outline:3px solid #174ecb} .scroll{overflow:auto}</style></head><body><main><h1>BillionJobs administration</h1><nav aria-label="Directories"><a href="/jobs/admin/users">User accounts</a> ? <a href="/jobs/admin/companies">Companies and recruiters</a></nav>${canManageRoles ? '<nav><a href="/jobs/admin/roles">Manage administrative roles</a></nav>' : ''}<p>Operational counts from recorded Jobs data. Access requires a privileged session.</p><p id="error" role="alert"></p><section aria-labelledby="metrics-title"><h2 id="metrics-title">Overview</h2><div class="grid" id="metrics"></div></section><section aria-labelledby="cases-title" ${canReadCases ? '' : 'hidden'}><h2 id="cases-title">Moderation cases</h2><label for="status">Status</label><select id="status"><option value="">All</option><option>OPEN</option><option>ASSIGNED</option><option>WAITING</option><option>RESOLVED</option><option>CLOSED</option></select><div class="scroll"><table><thead><tr><th scope="col">Case</th><th scope="col">Kind</th><th scope="col">Severity</th><th scope="col">Status</th></tr></thead><tbody id="cases"></tbody></table></div><button id="previous" type="button" disabled>Previous page</button> <button id="next" type="button">Next page</button></section></main><script>
  const error=document.getElementById('error'),metrics=document.getElementById('metrics'),cases=document.getElementById('cases'),status=document.getElementById('status');let offset=0;
  async function get(path){const r=await fetch(path,{credentials:'same-origin'});if(!r.ok)throw Error('Administration data unavailable.');return r.json()}
  async function load(){try{const [dashboard,queue]=await Promise.all([get('/api/jobs/v1/admin/dashboard'),${canReadCases} ? get('/api/jobs/v1/admin/cases?status='+encodeURIComponent(status.value)+'&offset='+offset) : Promise.resolve({rows:[],limit:25})]);metrics.replaceChildren();for(const [key,value] of Object.entries(dashboard.counts||{})){const card=document.createElement('div');card.className='card';const label=document.createElement('span');label.textContent=key.replaceAll('_',' ');const count=document.createElement('strong');count.textContent=String(value);card.append(label,count);metrics.append(card)}cases.replaceChildren();for(const item of queue.rows){const tr=document.createElement('tr');for(const key of ['id','kind','severity','status']){const td=document.createElement('td');td.textContent=String(item[key]);tr.append(td)}cases.append(tr)}document.getElementById('previous').disabled=offset===0;document.getElementById('next').disabled=queue.rows.length<queue.limit;error.textContent=''}catch{error.textContent='Administration data unavailable.'}}
  document.getElementById('previous').addEventListener('click',()=>{offset=Math.max(0,offset-25);load()});status.addEventListener('change',()=>{offset=0;load()});document.getElementById('next').addEventListener('click',()=>{offset+=25;load()});load();</script></body></html>`;
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'"}});
}

export function roleManagementPage(): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>Jobs administrative roles</title>
    <style>body{font:1rem/1.5 system-ui;max-width:58rem;margin:auto;padding:1rem}label{display:block;margin-top:1rem}button,input,select{font:inherit;padding:.45rem}button{margin:.4rem .4rem .4rem 0}li{overflow-wrap:anywhere}</style></head>
    <body><main><nav><a href="/jobs/admin">Administration dashboard</a></nav><h1>Jobs administrative roles</h1>
    <h2>Active grants</h2><ul id="grants"></ul><button id="previous" disabled>Previous page</button><button id="next" disabled>Next page</button>
    <h2>Change a role</h2><form><label for="subject">Jobs account ID</label><input required id="subject" maxlength="80">
    <label for="role">Role</label><select id="role" required></select><p id="permissions"></p>
    <button value="grant">Grant role</button><button value="revoke">Revoke role</button></form>
    <p role="status" id="message"></p></main><script>
    const el=id=>document.getElementById(id), endpoint='/api/jobs/v1/admin/roles';
    let offset=0,roles={};
    function showPermissions(){el('permissions').textContent=(roles[el('role').value]||[]).join(', ')}
    async function list(){
      const response=await fetch(endpoint+'?offset='+offset);
      if(!response.ok)throw Error('Unable to read administrative grants.');
      const data=await response.json(); roles=data.roles;
      el('role').replaceChildren(...Object.keys(roles).map(role=>new Option(role,role))); showPermissions();
      el('grants').replaceChildren(...data.rows.map(row=>{const item=document.createElement('li');item.textContent=row.subject+' — '+row.role;return item}));
      el('previous').disabled=offset===0; el('next').disabled=data.rows.length<data.limit;
    }
    const failure=err=>{el('message').textContent=err.message};
    el('previous').onclick=()=>{offset=Math.max(0,offset-25);list().catch(failure)};
    el('next').onclick=()=>{offset+=25;list().catch(failure)};el('role').onchange=showPermissions;
    document.querySelector('form').onsubmit=async event=>{
      event.preventDefault();
      try{
        const subject=el('subject').value.trim(),role=el('role').value,action=event.submitter.value;
        const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify({subject,role,action})});
        const result=await response.json();if(!response.ok)throw Error(result.error||'Role update failed.');
        el('message').textContent='Role update recorded for '+subject+'.';await list();
      }catch(err){failure(err)}
    };list().catch(failure);</script></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'"}});
}

export function directoryPage(kind:'users'|'companies', canReview=false):Response {
  const users=kind==='users';
  const title=users?'Jobs user accounts':'Jobs companies';
  const columns=users?{subject:'Account ID',eligible:'Eligible',restricted:'Restricted',closed_at:'Closed',active_actions:'Active actions'}:
    {id:'Company ID',name:'Name',owner:'Owner',restricted:'Restricted',employer_verification:'Verification'};
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title><style>body{font:1rem/1.5 system-ui;max-width:65rem;margin:auto;padding:1rem}button,input{font:inherit;padding:.4rem}
    .table{overflow:auto}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.6rem;border-bottom:1px solid #ccc}</style></head>
    <body><main><a href="/jobs/admin">Administration dashboard</a><h1>${title}</h1><form><label for="query">${users?'Account ID':'Company name'}</label>
    <input id="query" maxlength="80"><button>Search</button></form><p role="status" id="feedback"></p>
    <div class="table" tabindex="0" role="region" aria-label="Search results"><table><thead><tr>${Object.values(columns).map(label=>'<th scope="col">'+label+'</th>').join('')}</tr></thead><tbody></tbody></table></div>
    <button id="back" disabled>Previous page</button> <button id="forward" disabled>Next page</button></main><script>
    const columns=${JSON.stringify(Object.keys(columns))}, back=document.querySelector('#back'),forward=document.querySelector('#forward');
    let offset=0,term='',sequence=0;
    async function load(){
      const current=++sequence,feedback=document.querySelector('#feedback'),table=document.querySelector('tbody');
      table.replaceChildren();back.disabled=true;forward.disabled=true;feedback.textContent='Loading…';
      try{
        const response=await fetch('/api/jobs/v1/admin/${kind}?'+new URLSearchParams({q:term,offset:String(offset)}));
        if(!response.ok)throw Error();const data=await response.json();if(current!==sequence)return;
        for(const row of data.rows){const tr=table.insertRow();for(const field of columns){
          const value=row[field],cell=tr.insertCell();
          if(${canReview&&!users} && field==='employer_verification'){const link=document.createElement('a');link.href='/jobs/admin/companies/'+encodeURIComponent(row.id)+'/verification';link.textContent='Review '+value;cell.append(link);continue}
          cell.textContent=['eligible','restricted'].includes(field)?(value?'Yes':'No'):field==='closed_at'?(value?new Date(value).toLocaleDateString():'Open'):String(value??'');
        }}
        feedback.textContent=data.rows.length?'Showing '+(offset+1)+'–'+(offset+data.rows.length):'No results.';
        forward.disabled=data.rows.length<data.limit;
      }catch{if(current===sequence)feedback.textContent='Unable to load the directory.'}
      if(current===sequence)back.disabled=offset===0;
    }
    document.querySelector('form').onsubmit=e=>{e.preventDefault();term=document.querySelector('#query').value.trim();offset=0;load()};
    back.onclick=()=>{offset=Math.max(0,offset-25);load()};forward.onclick=()=>{offset+=25;load()};load();
    </script></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'"}});
}

export function employerVerificationPage(company:string,admin:boolean):Response{
  return jobsPage(`<h1>Employer verification</h1>
    <a href="${admin?'/jobs/admin/companies':'/jobs/companies'}">Back to companies</a>
    <p id="current"></p><p id="feedback" role="status"></p>
    <form><fieldset disabled><legend>${admin?'Review evidence':'Submit evidence'}</legend>
    <label>Evidence reference<input maxlength="200" name="reference" required ${admin?'readonly':''}></label>
    ${admin?'<label>Decision<select name="state"></select></label>':''}<button>${admin?'Record decision':'Submit evidence'}</button>
    </fieldset></form>`,`
    const endpoint='/api/jobs/v1/${admin?'admin/':''}companies/${encodeURIComponent(company)}/verification';
    const form=document.querySelector('form'),fields=form.querySelector('fieldset'),feedback=document.querySelector('#feedback');
    const decisions={EVIDENCE_PENDING:[['IN_REVIEW','Start review']],IN_REVIEW:[['VERIFIED','Approve'],['REJECTED','Reject']],VERIFIED:[['EXPIRED','Mark expired'],['UNVERIFIED','Revoke verification']]};
    let revision;
    async function load(){
      fields.disabled=true;const response=await fetch(endpoint);if(!response.ok)throw Error('Unable to load employer evidence.');
      const row=await response.json();revision=row.revision;document.querySelector('#current').textContent='Verification status: '+row.state;
      form.elements.reference.value=row.reference||'';
      if(${admin}){const choices=decisions[row.state]||[];form.elements.state.replaceChildren(...choices.map(([value,label])=>new Option(label,value)));fields.disabled=!choices.length}
      else fields.disabled=!['UNVERIFIED','REJECTED','EXPIRED'].includes(row.state);
    }
    form.onsubmit=async event=>{
      event.preventDefault();const command={revision,reference:form.elements.reference.value};if(${admin})command.state=form.elements.state.value;
      fields.disabled=true;try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify(command)});
      feedback.textContent=response.ok?'Verification updated.':'Update failed. Check the current status before retrying.';await load()}catch(error){feedback.textContent=error.message}
    };load().catch(error=>feedback.textContent=error.message);
    `);
}
