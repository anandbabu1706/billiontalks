import { jobsPage } from './profile-ui';
export function administrationPage(canReadCases = true, canManageRoles = false, canReviewAppeals = false, canReviewSignals = false, canReviewPrivacy=false, canReadAudit=false, canSetPolicy=false, canManageIncidents=false):Response{
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>BillionJobs administration</title><style>
  :root{font-family:system-ui,sans-serif;color:#17213b;background:#f5f7fb}body{margin:0}main{max-width:1100px;margin:auto;padding:1.5rem}h1{font-size:clamp(1.6rem,4vw,2.5rem)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1rem}.card{background:white;border:1px solid #d9e0ee;border-radius:.7rem;padding:1rem;min-height:6rem}.card strong{display:block;font-size:1.8rem;margin-top:.5rem}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;border-bottom:1px solid #d9e0ee;padding:.7rem}label{display:block;margin:1rem 0}button,select{font:inherit;padding:.5rem}button:focus-visible,select:focus-visible{outline:3px solid #174ecb} .scroll{overflow:auto}</style></head><body><main><h1>BillionJobs administration</h1><nav aria-label="Directories"><a href="/jobs/admin/analytics">Operational analytics</a> <a href="/jobs/admin/users">User accounts</a> ? <a href="/jobs/admin/companies">Companies and recruiters</a></nav>${canManageIncidents ? '<a href="/jobs/admin/incidents">Incidents</a> <a href="/jobs/admin/operations">Recovery queue</a> ' : ''}${canSetPolicy ? '<a href="/jobs/admin/policies">Policy settings</a> ' : ''}${canReadAudit ? '<a href="/jobs/admin/audit">Audit history</a> ' : ''}${canReviewPrivacy ? '<a href="/jobs/admin/privacy">Privacy requests</a> ' : ''}${canReviewSignals ? '<a href="/jobs/admin/signals">Fraud signals</a> ' : ''}${canReviewAppeals ? '<a href="/jobs/admin/appeals">Review appeals</a>' : ''}${canManageRoles ? '<nav><a href="/jobs/admin/roles">Manage administrative roles</a> <a href="/jobs/admin/ownership-recovery">Ownership recovery cases</a></nav>' : ''}<p>Operational counts from recorded Jobs data. Access requires a privileged session.</p><p id="error" role="alert"></p><section aria-labelledby="metrics-title"><h2 id="metrics-title">Overview</h2><div class="grid" id="metrics"></div></section><section aria-labelledby="cases-title" ${canReadCases ? '' : 'hidden'}><h2 id="cases-title">Moderation cases</h2><label for="status">Status</label><select id="status"><option value="">All</option><option>OPEN</option><option>ASSIGNED</option><option>WAITING</option><option>RESOLVED</option><option>CLOSED</option></select><label><input type="checkbox" id="overdue"> Overdue only</label><div class="scroll"><table><thead><tr><th scope="col">Case</th><th scope="col">Kind</th><th scope="col">Severity</th><th scope="col">Status</th></tr></thead><tbody id="cases"></tbody></table></div><button id="previous" type="button" disabled>Previous page</button> <button id="next" type="button">Next page</button></section></main><script>
  const error=document.getElementById('error'),metrics=document.getElementById('metrics'),cases=document.getElementById('cases'),status=document.getElementById('status');let offset=0,sequence=0;
  async function get(path){const r=await fetch(path,{credentials:'same-origin'});if(!r.ok)throw Error('Administration data unavailable.');return r.json()}
  async function load(){const current=++sequence;try{const [dashboard,queue]=await Promise.all([get('/api/jobs/v1/admin/dashboard'),${canReadCases} ? get('/api/jobs/v1/admin/cases?status='+encodeURIComponent(status.value)+'&offset='+offset+'&overdue='+Number(document.getElementById('overdue').checked)) : Promise.resolve({rows:[],limit:25})]);if(current!==sequence)return;metrics.replaceChildren();for(const [key,value] of Object.entries(dashboard.counts||{})){const card=document.createElement('div');card.className='card';const label=document.createElement('span');label.textContent=key.replaceAll('_',' ');const count=document.createElement('strong');count.textContent=String(value);card.append(label,count);metrics.append(card)}cases.replaceChildren();for(const item of queue.rows){const tr=document.createElement('tr');for(const key of ['id','kind','severity','status']){const td=document.createElement('td');if(key==='id'){const link=document.createElement('a');link.href='/jobs/admin/cases/'+encodeURIComponent(item.id);link.textContent=item.id;td.append(link)}else td.textContent=String(item[key])+(key==='status'&&item.overdue?' (overdue)':'');tr.append(td)}cases.append(tr)}document.getElementById('previous').disabled=offset===0;document.getElementById('next').disabled=queue.rows.length<queue.limit;error.textContent=''}catch{if(current!==sequence)return;metrics.replaceChildren();cases.replaceChildren();error.textContent='Administration data unavailable.'}}
  document.getElementById('overdue').onchange=()=>{offset=0;load()};document.getElementById('previous').addEventListener('click',()=>{offset=Math.max(0,offset-25);load()});status.addEventListener('change',()=>{offset=0;load()});document.getElementById('next').addEventListener('click',()=>{offset+=25;load()});load();</script></body></html>`;
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

export function directoryPage(kind:'users'|'companies', canReview=false, canManageMembers=false):Response {
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
          if(${canManageMembers&&users} && field==='subject'){const link=document.createElement('a');link.href='/jobs/admin/users/'+encodeURIComponent(row.subject);link.textContent=row.subject;cell.append(link);continue}
          if(${canManageMembers&&!users} && field==='name'){const link=document.createElement('a');link.href='/jobs/admin/companies/'+encodeURIComponent(row.id)+'/members';link.textContent=value+' members';cell.append(link);continue}
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
    ${admin?'<label>Decision<select name="state"></select></label><label>Approval expiry (optional, local time)<input type="datetime-local" name="expires"></label>':''}<button>${admin?'Record decision':'Submit evidence'}</button>
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
      event.preventDefault();const command={revision,reference:form.elements.reference.value};if(${admin}){command.state=form.elements.state.value;if(command.state==='VERIFIED'&&form.elements.expires.value)command.expiresAt=new Date(form.elements.expires.value).getTime();}
      fields.disabled=true;try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify(command)});
      feedback.textContent=response.ok?'Verification updated.':'Update failed. Check the current status before retrying.';await load()}catch(error){feedback.textContent=error.message}
    };load().catch(error=>feedback.textContent=error.message);
    `);
}

export function companyMembersPage(company:string):Response{
  return jobsPage(`<h1>Company membership review</h1><a href="/jobs/admin/companies">Company directory</a>
    <p role="status" id="feedback"></p><ul id="members"></ul>
    <button id="prev" disabled>Previous page</button><button id="next" disabled>Next page</button>`,`
    const endpoint='/api/jobs/v1/admin/companies/${encodeURIComponent(company)}/members';
    const list=document.querySelector('#members'),feedback=document.querySelector('#feedback');
    const prev=document.querySelector('#prev'),next=document.querySelector('#next');
    let offset=0;
    function lock(){prev.disabled=true;next.disabled=true;list.replaceChildren()}
    async function load(message=''){
      lock();const response=await fetch(endpoint+'?offset='+offset);
      if(!response.ok)throw Error('Membership review unavailable.');
      const data=await response.json();
      for(const row of data.rows){
        const item=document.createElement('li'),owner=row.subject===data.owner;
        item.textContent=row.subject+' · '+(owner?'Owner':row.role)+(row.revoked_at!==null?' (revoked)':'');
        if(!owner&&row.revoked_at===null){
          const button=document.createElement('button');button.textContent='Revoke access for '+row.subject;
          button.onclick=async()=>{
            if(!window.confirm('Revoke company access for '+row.subject+'?'))return;
            lock();
            try{const result=await fetch(endpoint+'/'+encodeURIComponent(row.subject),{method:'DELETE',headers:{'X-Jobs-Request':'1','Content-Type':'application/json'},body:JSON.stringify({revision:data.revision})});
              await load(result.ok?'Company access revoked.':'Change rejected. Review the current membership and your session.')}
            catch(error){feedback.textContent=error.message}
          };item.append(button);
        }list.append(item);
      }
      prev.disabled=offset===0;next.disabled=data.rows.length<data.limit;
      feedback.textContent=message||(!data.rows.length?'No memberships on this page.':'');
    }
    const reload=()=>load().catch(error=>feedback.textContent=error.message);
    prev.onclick=()=>{offset=Math.max(0,offset-25);reload()};next.onclick=()=>{offset+=25;reload()};reload();`);
}

export function accountReviewPage(subject:string):Response{
  return jobsPage(`<h1>Jobs account review</h1><a href="/jobs/admin/users">User directory</a>
    <p id="account"></p><p role="status" id="feedback"></p>
    <form><fieldset disabled><legend>Record a case decision</legend>
    <label>Related case<select name="caseId" required></select></label>
    <label>Action<select name="kind"><option value="WARNING">Warning</option><option value="POSTING">Restrict posting</option>
    <option value="JOBS_TEMP">Temporary suspension</option><option value="JOBS_PERMANENT">Permanent suspension</option><option value="EMERGENCY">Emergency containment</option></select></label>
    <label>Reason code<input required name="reasonCode" maxlength="80"></label>
    <label>Expiry (local time)<input name="expiry" type="datetime-local"></label><button>Record decision</button></fieldset></form>
    <section hidden id="closure"><h2>Close Jobs account</h2><label>Resolved case<select id="resolved"></select></label><button id="close-account">Close Jobs account</button></section><h2>Decision history</h2><ul id="actions"></ul>`,`
    const endpoint='/api/jobs/v1/admin/users/${encodeURIComponent(subject)}',form=document.querySelector('form');
    const status=document.querySelector('#feedback'),list=document.querySelector('#actions'),field=form.querySelector('fieldset');
    let busy=false;
    async function send(url,body){
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify(body)});
      if(!r.ok)throw Error((await r.json()).error||'Update failed.');
    }
    async function run(fn){if(busy)return;busy=true;try{await fn();await load();status.textContent='Decision recorded.'}catch(e){status.textContent=e.message}finally{busy=false}}
    async function load(){
      field.disabled=true;list.replaceChildren();
      const r=await fetch(endpoint);if(!r.ok)throw Error('Account review unavailable.');const data=await r.json();
      document.querySelector('#account').textContent='Account '+data.user.subject+(data.user.closed_at?' (closed)':'');
      const resolved=data.cases.filter(c=>['RESOLVED','CLOSED'].includes(c.status));
      document.querySelector('#closure').hidden=!data.canClose||Boolean(data.user.closed_at)||!resolved.length;
      document.querySelector('#resolved').replaceChildren(...resolved.map(c=>new Option(c.category+' ? '+c.id,c.id)));
      form.elements.caseId.replaceChildren(...data.cases.map(c=>new Option(c.category+' · '+c.status+' · '+c.id,c.id)));
      field.disabled=!data.cases.length||Boolean(data.user.closed_at);
      for(const action of data.actions){
        const li=document.createElement('li');const active=!action.revoked_at&&(!action.expires_at||action.expires_at>Date.now());
        li.textContent=action.kind+' · '+action.reason_code+' · '+(active?'Active':action.revoked_at?'Revoked':'Expired');
        if(active){const button=document.createElement('button');button.textContent='Revoke this action';button.onclick=()=>{
          const reason=window.prompt('Reason for revoking this action');if(reason?.trim())run(()=>send('/api/jobs/v1/admin/actions/'+encodeURIComponent(action.id)+'/revoke',{revision:action.revision,reason}));
        };li.append(button)}list.append(li);
      }
    }
    document.querySelector('#close-account').onclick=()=>{if(window.confirm('Close this Jobs account and revoke Jobs recruitment access?'))run(()=>send(endpoint+'/closure',{caseId:document.querySelector('#resolved').value}))};
    form.onsubmit=e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form));const command={caseId:data.caseId,kind:data.kind,reasonCode:data.reasonCode};
      if(data.expiry)command.expiresAt=new Date(data.expiry).getTime();if(window.confirm('Record '+data.kind+' for this Jobs account?'))run(()=>send(endpoint+'/actions',command));};
    load().catch(e=>status.textContent=e.message);`);
}

export function moderationCasePage(id:string):Response{
  return jobsPage(`<h1>Moderation case</h1><a href="/jobs/admin">Case queue</a><p role="status" id="feedback"></p>
    <dl id="case"></dl><section id="listing-section" hidden><h2>Listing restrictions</h2>
    <form id="listing"><label>Decision<select name="kind"><option value="FEATURE">Restrict new applications</option><option value="REMOVE_DISCOVERY">Remove from discovery</option></select></label>
    <label>Reason code<input required maxlength="80" name="reasonCode"></label><button>Record listing decision</button></form><ul id="restrictions"></ul></section><h2>History</h2><ol id="events"></ol>
    <section hidden id="review"><button id="assist">Request review guidance</button><form id="evidence"><fieldset><legend>Add evidence</legend>
    <label>Evidence reference<input required maxlength="200" name="reference"></label>
    <label>Investigation note<textarea required maxlength="2000" name="note"></textarea></label><button>Add evidence</button></fieldset></form>
    <form id="decision"><fieldset><legend>Case decision</legend>
    <label>Category<input required maxlength="80" name="category"></label>
    <label>Severity<select name="severity"><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label>
    <label>Reviewer account ID<input name="assignee" maxlength="80"></label>
    <label>Status<select name="status"><option>ASSIGNED</option><option>WAITING</option><option>RESOLVED</option><option>CLOSED</option></select></label>
    <label>Investigation note<textarea required maxlength="2000" name="note"></textarea></label><button>Save decision</button></fieldset></form></section>`,`
    const endpoint='/api/jobs/v1/admin/cases/${encodeURIComponent(id)}',lookup=id=>document.getElementById(id);
    let revision;
    async function load(){
      const response=await fetch(endpoint);if(!response.ok)throw Error('Unable to load the case.');
      const {record,history,investigate,enforce,actions}=await response.json();
      lookup('listing-section').hidden=record.kind!=='JOB'||!enforce;lookup('restrictions').replaceChildren();
      for(const a of actions){const li=document.createElement('li');li.textContent=a.kind+' ? '+a.reason_code;
        if(a.revoked_at||a.expires_at&&a.expires_at<=Date.now())li.append(' (inactive)');
        else{const b=document.createElement('button');b.textContent='Lift restriction';b.onclick=async()=>{const reason=window.prompt('Reason for lifting this restriction');if(!reason)return;
          try{const r=await fetch('/api/jobs/v1/admin/actions/'+a.id+'/revoke',{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify({revision:a.revision,reason})});if(!r.ok)throw Error((await r.json()).error);await load()}catch(err){lookup('feedback').textContent=err.message}};li.append(b)}lookup('restrictions').append(li)}
      revision=record.revision;lookup('case').replaceChildren();lookup('events').replaceChildren();
      for(const key of ['id','kind','target_ref','category','severity','status','assignee','reporter']){
        if(!record[key])continue;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=record[key];lookup('case').append(dt,dd);
      }
      for(const event of history){const li=document.createElement('li');li.textContent=[new Date(event.at).toLocaleString(),event.action,event.public_status,event.internal_note,event.evidence_ref].filter(Boolean).join(' · ');lookup('events').append(li)}
      lookup('review').hidden=!investigate||['CLOSED','RESOLVED'].includes(record.status);
      for(const key of ['category','severity','assignee'])lookup('decision').elements[key].value=record[key]||'';
    }
    lookup('assist').onclick=async()=>{try{const r=await fetch(endpoint+'/assistance',{method:'POST',headers:{'X-Jobs-Request':'1'}});if(!r.ok)throw Error('Guidance unavailable.');
      const result=await r.json();lookup('feedback').textContent=result.instruction+' Reference '+result.auditRef}catch(err){lookup('feedback').textContent=err.message}};
    for(const op of ['evidence','decision','listing']){
      const form=lookup(op);form.onsubmit=async e=>{
        e.preventDefault();const body=Object.fromEntries(new FormData(form));if(op==='decision'){body.revision=revision;if(!body.assignee)delete body.assignee}
        const field=form.querySelector('fieldset')||form.querySelector('button');field.disabled=true;
        try{const response=await fetch(endpoint+'/'+op,{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify(body)});
          if(!response.ok)throw Error((await response.json()).error);form.reset();await load();lookup('feedback').textContent='Case updated.';
        }catch(error){lookup('feedback').textContent=error.message}finally{field.disabled=false}
      };
    }load().catch(error=>lookup('feedback').textContent=error.message);`);
}

export function appealsPage(admin:boolean):Response{
  return jobsPage(`<h1>${admin?'Appeal reviews':'My appeals'}</h1>
    <p role="status" id="feedback"></p>
    ${admin?'':'<form id="submit"><fieldset><legend>Appeal an enforcement decision</legend><label>Decision<select required name="action"></select></label><label>Reason<textarea required maxlength="2000" name="reason"></textarea></label><button>Submit appeal</button></fieldset></form>'}
    <h2>Appeals</h2><ul id="appeals"></ul><button id="prev">Previous page</button><button id="next">Next page</button>
    <section hidden id="detail"><h2>Appeal history</h2><p id="reason"></p><ol id="history"></ol>
    <form id="update"><fieldset><legend>${admin?'Record a review':'Provide additional information'}</legend>
    <label>Next status<select name="status" required></select></label>
    <label>Message for the appellant<textarea name="message" required maxlength="1000"></textarea></label><button>Save update</button></fieldset></form></section>`,`
    const admin=${admin},endpoint='/api/jobs/v1/${admin?'admin/':''}appeals',el=id=>document.getElementById(id);
    let offset=0,selected=null;
    async function api(path,data){const r=await fetch(path,data?{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify(data)}:{});
      const result=await r.json();if(!r.ok)throw Error(result.error||'Request failed');return result}
    function error(err){el('feedback').textContent=err.message}
    async function list(){
      el('detail').hidden=true;selected=null;
      const data=await api(endpoint+'?offset='+offset);
      el('appeals').replaceChildren();for(const row of data.rows){const li=document.createElement('li'),button=document.createElement('button');button.textContent=row.status+' · '+row.id;
        button.onclick=()=>openAppeal(row.id).catch(error);li.append(button);el('appeals').append(li)}
      if(!admin){el('submit').elements.action.replaceChildren(...data.decisions.map(d=>new Option(d.kind+' · '+d.reason_code+' · '+d.id,d.id)));
        el('submit').querySelector('fieldset').disabled=!data.decisions.length}
      el('prev').disabled=!offset;el('next').disabled=Math.max(data.rows.length,data.decisions.length)<data.limit;
    }
    async function openAppeal(id){const data=await api(endpoint+'/'+encodeURIComponent(id));selected=data.record;
      el('detail').hidden=false;el('reason').textContent=selected.reason;el('history').replaceChildren();
      for(const event of data.history){const li=document.createElement('li');li.textContent=event.status+' · '+new Date(event.recorded_at).toLocaleString()+' · '+(event.message||'');el('history').append(li)}
      const options=admin?({SUBMITTED:['ACKNOWLEDGED'],ACKNOWLEDGED:['REVIEWING','MORE_INFO','UPHELD','OVERTURNED'],REVIEWING:['MORE_INFO','UPHELD','OVERTURNED'],MORE_INFO:['UPHELD','OVERTURNED']}[selected.status]||[]):selected.status==='MORE_INFO'?['ACKNOWLEDGED']:[];
      el('update').hidden=!options.length;el('update').elements.status.replaceChildren(...options.map(s=>new Option(s,s)));
    }
    if(!admin)el('submit').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;
      try{const result=await api('/api/jobs/v1/enforcement/'+encodeURIComponent(form.elements.action.value)+'/appeals',{reason:form.elements.reason.value});
        form.reset();await list();await openAppeal(result.id);el('feedback').textContent='Appeal submitted.'}catch(err){error(err)}};
    el('update').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,id=selected.id;
      try{await api(endpoint+'/'+encodeURIComponent(id),{status:form.elements.status.value,message:form.elements.message.value,revision:selected.revision});
        form.reset();await list();await openAppeal(id);el('feedback').textContent='Appeal updated.'}catch(err){error(err)}};
    el('prev').onclick=()=>{offset=Math.max(0,offset-25);list().catch(error)};el('next').onclick=()=>{offset+=25;list().catch(error)};list().catch(error);`);
}

export function reportsPage():Response{
  return jobsPage(`<h1>Report a concern</h1><form><fieldset><legend>New complaint</legend>
    <label>Report type<select name="kind">${['JOB','COMPANY','RECRUITER','CANDIDATE','INTERVIEW','HARASSMENT','SCAM','PRIVACY'].map(k=>'<option>'+k+'</option>').join('')}</select></label>
    <label>Subject or record ID<input name="targetRef" required maxlength="161"></label><label>Category<input required maxlength="80" name="category"></label>
    <label>Details for the investigator<textarea name="detail" required maxlength="2000"></textarea></label><button>Submit complaint</button></fieldset></form>
    <p id="feedback" role="status"></p><h2>My complaints</h2><ul id="reports"></ul><button id="prev">Previous page</button><button id="next">Next page</button>`,`
    const endpoint='/api/jobs/v1/reports',el=id=>document.getElementById(id);let offset=0;
    async function load(){const r=await fetch(endpoint+'?offset='+offset);if(!r.ok)throw Error('Unable to load your complaints.');
      const data=await r.json();el('reports').replaceChildren();for(const row of data.rows){const li=document.createElement('li');
        li.textContent=row.kind+' · '+row.category+' · '+row.status+' · '+row.id;el('reports').append(li)}
      el('prev').disabled=!offset;el('next').disabled=data.rows.length<data.limit;
    }
    const show=err=>el('feedback').textContent=err.message;
    document.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,body=Object.fromEntries(new FormData(form));
      form.querySelector('button').disabled=true;try{const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify(body)});
      const result=await r.json();if(!r.ok)throw Error(result.error);form.reset();offset=0;await load();el('feedback').textContent='Complaint submitted. Reference '+result.id;
      }catch(err){show(err)}finally{form.querySelector('button').disabled=false}};
    el('prev').onclick=()=>{offset=Math.max(0,offset-25);load().catch(show)};el('next').onclick=()=>{offset+=25;load().catch(show)};load().catch(show);`);
}

export function signalsPage():Response{
  return jobsPage(`<h1>Fraud signal review</h1><a href="/jobs/admin">Case queue</a>
    <form><label>Company ID<input required name="company" maxlength="80"></label><button>Check company indicators</button></form>
    <p role="status" id="feedback"></p><ul id="signals"></ul><button id="prev">Previous page</button><button id="next">Next page</button>`,`
    const el=id=>document.getElementById(id),endpoint='/api/jobs/v1/admin/signals';
    const reasons={POSTING_FREQUENCY:'Posting activity reached the configured daily threshold.',REPEATED_COMPLAINTS:'At least three resolved reports reference this company.',
      RECRUITER_ACTIVITY_VOLUME:'At least 50 recruiter commands were recorded in 24 hours.',INTERVIEW_WORKFLOW_VOLUME:'At least 30 interview commands were recorded in 24 hours.',
      POTENTIAL_RECRUITMENT_FEE:'Listing text matched recruitment fee or deposit language.',MISLEADING_CLAIM:'Listing text matched a placement guarantee or verification claim.',
      REPEATED_DUPLICATE:'At least three listings share a normalized title and location.'};
    let offset=0;
    async function api(url,body){const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify(body)}:{});const result=await r.json();if(!r.ok)throw Error(result.error);return result}
    const error=e=>el('feedback').textContent=e.message;
    async function load(){const data=await api(endpoint+'?offset='+offset);el('signals').replaceChildren();
      for(const row of data.rows){const li=document.createElement('li');li.textContent=row.severity+' · '+row.target_ref+' · '+(reasons[row.rule]||row.rule);
        for(const refer of [false,true]){const b=document.createElement('button');b.textContent=refer?'Refer to moderation':'Dismiss false positive';b.onclick=async()=>{
          try{const result=await api(endpoint+'/'+row.id,{refer});await load();el('feedback').textContent=result.caseId?'Opened case '+result.caseId:'Signal dismissed.'}
          catch(e){error(e)}};li.append(b)}el('signals').append(li)}
      el('prev').disabled=!offset;el('next').disabled=data.rows.length<data.limit;
    }
    document.querySelector('form').onsubmit=async e=>{e.preventDefault();try{const result=await api('/api/jobs/v1/admin/companies/'+encodeURIComponent(e.currentTarget.elements.company.value)+'/scan',{});
      offset=0;await load();el('feedback').textContent=result.created+' new signals.'}catch(e){error(e)}};
    el('prev').onclick=()=>{offset=Math.max(0,offset-25);load().catch(error)};el('next').onclick=()=>{offset+=25;load().catch(error)};load().catch(error);`);
}

export function ownershipPage():Response{
  return jobsPage(`<h1>Company ownership</h1><a href="/jobs/ownership-recovery">Ownership recovery cases</a> <a href="/jobs/companies">Companies</a><p id="feedback" role="status"></p>
    <label>Owned company<select id="company"></select></label><form id="request"><fieldset><legend>Transfer ownership</legend>
    <label>Recipient Jobs account ID<input required name="subject" maxlength="80"></label><label>Recipient verified email<input type="email" required name="email"></label>
    <button>Request transfer</button></fieldset></form><p id="handoff" hidden><label>Single-use acceptance code<input id="token" readonly></label></p>
    <form id="retire"><fieldset><legend>Retire company</legend><label>Reason code<input required maxlength="80" name="reason"></label><button>Retire company</button></fieldset></form>
    <h2>Transfer requests</h2><ul id="requests"></ul><button id="prev">Previous page</button><button id="next">Next page</button>`,`
    const endpoint='/api/jobs/v1/ownership',el=id=>document.getElementById(id);let companies=[],offset=0,busy=false;
    async function api(url,data){const r=await fetch(url,data?{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify(data)}:{});
      const result=await r.json();if(!r.ok)throw Error(result.error||'Request failed');return result}
    async function run(fn){if(busy)return;busy=true;try{await fn();await load();el('feedback').textContent='Ownership request updated.'}catch(e){el('feedback').textContent=e.message}finally{busy=false}}
    async function load(){const data=await api(endpoint+'?offset='+offset);companies=data.companies;el('company').replaceChildren(...companies.map(c=>new Option(c.name||c.id,c.id)));
      for(const op of ['request','retire'])el(op).querySelector('fieldset').disabled=!companies.length;
      el('requests').replaceChildren();for(const t of data.requests){const li=document.createElement('li');const status=t.accepted_at?'Accepted':t.cancelled_at?'Ended':t.expires_at<=Date.now()?'Expired':'Pending';
        li.textContent=t.company+' · '+t.from_subject+' → '+t.to_subject+' · '+status;
        if(status==='Pending')for(const op of t.direction==='SENT'?['cancel']:['accept','decline']){const button=document.createElement('button');button.textContent=op;
          button.onclick=()=>{const token=op==='accept'?window.prompt('Single-use acceptance code'):null;
            if(op==='accept'?!token:!window.confirm(op+' this transfer?'))return;
            run(()=>api(endpoint+'/'+t.id+'/'+op,token?{token}:{}))};li.append(button)}el('requests').append(li)}
      el('prev').disabled=!offset;el('next').disabled=Math.max(companies.length,data.requests.length)<data.limit;
    }
    for(const op of ['request','retire'])el(op).onsubmit=e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));
      const c=companies.find(c=>c.id===el('company').value);if(!c)return;
      if(op==='retire'&&!window.confirm('Retire this company, close active listings and revoke company memberships?'))return;
      run(async()=>{const result=await api(endpoint+'/'+c.id+'/'+op,{...body,revision:c.revision});el('handoff').hidden=!result.token;el('token').value=result.token||''})};
    el('prev').onclick=()=>{offset=Math.max(0,offset-25);load().catch(e=>el('feedback').textContent=e.message)};
    el('next').onclick=()=>{offset+=25;load().catch(e=>el('feedback').textContent=e.message)};
    load().catch(e=>el('feedback').textContent=e.message);`);
}

export function privacyWorkspacePage(admin:boolean):Response{
  const adminForms=`<form id="notice"><fieldset><legend>Publish privacy notice</legend><label>Version<input required name="version" placeholder="BJ-..." maxlength="43"></label>
    <label>Notice text<textarea required name="summary" maxlength="1000"></textarea></label><button>Publish notice</button></fieldset></form>
    <form id="holds"><fieldset><legend>Place a Jobs legal hold</legend><label>Scope<select name="scope"><option>JOBS</option><option>APPLICATION</option><option>CLOSURE</option><option>MODERATION</option></select></label><label>Jobs account ID<input name="subject" required maxlength="80"></label>
    <label>Reason code<input required name="reason" maxlength="80"></label><label>Review date and time<input type="datetime-local" required name="reviewAt"></label>
    <button>Create Jobs hold</button></fieldset></form><h2>Legal holds</h2><ul id="hold-list"></ul><form id="purge"><button>Process due Jobs deletions</button></form>`;
  const ownForms=`<form id="consent"><fieldset><legend>Consent preferences</legend><label>Purpose<select name="purpose"><option value="OPTIONAL_ANALYTICS">Optional analytics</option><option value="PUBLIC_INDEXING">Public indexing</option></select></label>
    <button value="grant">Grant consent</button><button value="withdraw">Withdraw consent</button></fieldset></form>
    <h2>Consent history</h2><ul id="history"></ul><form id="requests"><fieldset><legend>Request Jobs data</legend><label>Request type<select name="kind"><option>EXPORT</option><option>DELETE</option></select></label>
    <button>Submit request</button></fieldset></form>`;
  return jobsPage(`<h1>${admin?'Privacy administration':'Jobs privacy'}</h1><h2>Current privacy notice</h2><p id="published"></p><p role="status" id="feedback"></p>
    ${admin?adminForms:ownForms}<h2>Privacy requests</h2><ul id="request-list"></ul><button id="prev">Previous page</button><button id="next">Next page</button>`,`
    const endpoint='/api/jobs/v1/${admin?'admin/':''}privacy',admin=${admin},el=id=>document.getElementById(id);
    let offset=0,busy=false,noticeVersion=null;
    async function api(path,data){const r=await fetch(endpoint+path,data?{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify(data)}:{});
      if(!r.ok)throw Error((await r.json()).error||'Privacy request failed.');return r}
    async function run(fn){if(busy)return;busy=true;try{await fn();await load();el('feedback').textContent='Privacy request recorded.'}catch(e){el('feedback').textContent=e.message}finally{busy=false}}
    function append(id,text){const li=document.createElement('li');li.textContent=text;el(id).append(li);return li}
    function button(li,text,fn){const b=document.createElement('button');b.textContent=text;b.onclick=()=>run(fn);li.append(b)}
    async function load(){
      const data=await (await api('?offset='+offset)).json();noticeVersion=data.notice?.version||null;el('published').textContent=data.notice?data.notice.version+' · '+data.notice.summary:'No notice published.';
      el('request-list').replaceChildren();
      for(const r of data.requests){const li=append('request-list',(admin?r.subject+' · ':'')+r.kind+' · '+r.status+' · '+r.id);
        if(admin&&r.status==='SUBMITTED')for(const approved of [true,false])button(li,approved?'Approve':'Deny',async()=>{
          const reason=window.prompt('Decision reason code');if(!reason)return;await api('/requests/'+r.id,{approved,reason})});
        if(!admin&&r.kind==='EXPORT'&&r.status==='REVIEWING')button(li,'Download Jobs export',async()=>{
          const blob=await (await api('/requests/'+r.id,{})).blob();const a=document.createElement('a'),url=URL.createObjectURL(blob);
          a.href=url;a.download='jobs-export.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)});
      }
      if(admin){el('hold-list').replaceChildren();for(const h of data.holds){const li=append('hold-list',h.subject+' · '+h.scope+' · '+h.reason_code+' · review '+new Date(h.review_at).toLocaleString()+(h.released_at?' · Released':''));
        if(!h.released_at)button(li,'Review hold',async()=>{const date=window.prompt('Next review date (YYYY-MM-DD)');if(!date)return;
          const reviewAt=Date.parse(date+'T00:00:00Z');if(!Number.isFinite(reviewAt))throw Error('Enter a valid date.');await api('/holds/'+h.id,{reviewAt,previousReviewAt:h.review_at})});
        if(!h.released_at)button(li,'Release hold',async()=>{if(window.confirm('Release this legal hold?'))await api('/holds/'+h.id,{})})}}
      else{el('history').replaceChildren();for(const c of data.consent)append('history',c.purpose+' · '+(c.granted?'Granted':'Withdrawn')+' · '+c.notice_version+' · '+new Date(c.at).toLocaleString());
        el('consent').querySelector('fieldset').disabled=!data.notice}
      el('prev').disabled=!offset;el('next').disabled=Math.max(data.requests.length,data.holds.length,data.consent.length)<data.limit;
    }
    for(const form of document.forms)form.onsubmit=e=>{e.preventDefault();const body=Object.fromEntries(new FormData(form));
      if(form.id==='consent'){body.granted=e.submitter.value==='grant';body.version=noticeVersion}
      if(form.id==='holds'){body.reviewAt=new Date(body.reviewAt).getTime()}
      if(body.kind==='DELETE'&&!window.confirm('Submit a Jobs deletion request for review?'))return;
      run(async()=>{await api('/'+form.id,body);form.reset();offset=0})};
    const reload=()=>load().catch(e=>el('feedback').textContent=e.message);
    el('prev').onclick=()=>{offset=Math.max(0,offset-25);reload()};el('next').onclick=()=>{offset+=25;reload()};reload();`);
}

export function auditWorkspacePage():Response{
  return jobsPage(`<h1>Jobs audit history</h1><a href="/jobs/admin">Administration dashboard</a><form>
    <fieldset><legend>Filter events</legend><label>Actor ID<input name="actor" maxlength="80"></label>
    <label>Action<input name="action" maxlength="161"></label><label>Target reference<input name="target_ref" maxlength="161"></label>
    <label>Purpose<input name="purpose" maxlength="80"></label><label>From (local time)<input name="from" type="datetime-local"></label>
    <label>Until (local time)<input name="until" type="datetime-local"></label><button>Search</button></fieldset></form>
    <p role="status" id="feedback"></p><ol id="history"></ol><button id="prev">Previous page</button><button id="next">Next page</button>`,`
    const form=document.querySelector('form'),el=id=>document.getElementById(id);let offset=0,sequence=0,filters=new URLSearchParams();
    async function load(){const n=++sequence;if(!filters.has('until'))filters.set('until',String(Date.now()+1));const q=new URLSearchParams(filters);q.set('offset',offset);
      const r=await fetch('/api/jobs/v1/admin/audit?'+q);if(!r.ok)throw Error('Audit history unavailable.');
      const data=await r.json();if(n!==sequence)return;el('history').replaceChildren();for(const row of data.rows){const li=document.createElement('li');
        li.textContent=[new Date(row.at).toLocaleString(),row.actor,row.purpose,row.action,row.target_type,row.target_ref,row.outcome].join(' · ');el('history').append(li)}
      el('feedback').textContent=data.rows.length?'Showing records '+(offset+1)+'–'+(offset+data.rows.length):'No matching events.';
      el('prev').disabled=!offset;el('next').disabled=data.rows.length<data.limit;
    }
    const refresh=()=>load().catch(e=>el('feedback').textContent=e.message);
    form.onsubmit=e=>{e.preventDefault();filters=new URLSearchParams();for(const [k,v] of new FormData(form)){if(v)filters.set(k,['from','until'].includes(k)?new Date(v).getTime():v)}offset=0;refresh()};
    el('prev').onclick=()=>{offset=Math.max(0,offset-25);refresh()};el('next').onclick=()=>{offset+=25;refresh()};refresh();`);
}

export function policyWorkspacePage():Response{
  return jobsPage(`<h1>Jobs policy settings</h1><a href="/jobs/admin">Administration dashboard</a>
    <form><fieldset><legend>Schedule a revision</legend><label>Setting<select name="key"></select></label>
    <p id="current"></p><label>New value<input name="value" required type="number" step="1"></label>
    <label>Effective time (local, blank for now)<input type="datetime-local" name="effective"></label><button>Save revision</button></fieldset></form>
    <p id="feedback" role="status"></p><h2>Revision history</h2><ol id="history"></ol><button id="prev">Previous page</button><button id="next">Next page</button>`,`
    const endpoint='/api/jobs/v1/admin/policies',form=document.querySelector('form'),el=id=>document.getElementById(id);let offset=0,data;
    function select(){const key=form.elements.key.value,row=data.current.find(r=>r.key===key),range=data.bounds[key];
      const input=form.elements.value;input.min=range[0];input.max=range[1];input.value=row?row.value:'';
      el('current').textContent=(row?'Latest revision '+row.revision+', value '+row.value+'. ':'Default policy. ')+'Allowed range '+range.join('–');}
    async function load(){const response=await fetch(endpoint+'?offset='+offset);if(!response.ok)throw Error('Unable to read settings.');
      const selected=form.elements.key.value;data=await response.json();form.elements.key.replaceChildren(...Object.keys(data.bounds).map(k=>new Option(k.replaceAll('_',' '),k)));
      if(selected)form.elements.key.value=selected;select();el('history').replaceChildren();
      for(const r of data.history){const item=document.createElement('li');item.textContent=r.key+' · '+r.value+' · revision '+r.revision+' · '+new Date(r.effective_at).toLocaleString()+' · '+r.actor;el('history').append(item)}
      el('prev').disabled=!offset;el('next').disabled=data.history.length<data.limit}
    form.elements.key.onchange=select;const error=e=>el('feedback').textContent=e.message;
    form.onsubmit=async e=>{e.preventDefault();const key=form.elements.key.value,row=data.current.find(r=>r.key===key);const command={key,value:Number(form.elements.value.value),revision:row?.revision||0};
      if(form.elements.effective.value)command.effectiveAt=new Date(form.elements.effective.value).getTime();try{
      const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify(command)});if(!r.ok)throw Error((await r.json()).error);await load();el('feedback').textContent='Revision saved.'}catch(err){error(err)}};
    el('prev').onclick=()=>{offset=Math.max(0,offset-25);load().catch(error)};el('next').onclick=()=>{offset+=25;load().catch(error)};load().catch(error);`);
}

export function incidentWorkspacePage():Response{
  const severity='<label>Severity<select name="severity"><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label>';
  return jobsPage(`<h1>Security incidents</h1><a href="/jobs/admin">Administration dashboard</a>
    <form id="new"><fieldset><legend>Open incident</legend>${severity}<label>Summary<input name="summary" required maxlength="500"></label><button>Open incident</button></fieldset></form>
    <p id="feedback" role="status"></p><ul id="queue"></ul><button id="prev">Previous page</button><button id="next">Next page</button>
    <section id="detail" hidden><h2 id="title"></h2><p id="clock"></p><ol id="timeline"></ol>
    <form id="assign"><fieldset><legend>Update ownership and severity</legend>${severity}<label>Incident owner ID<input name="owner" required maxlength="80"></label><button>Save assignment</button></fieldset></form>
    <form id="transition"><fieldset><legend>Change incident status</legend><label>Next status<select name="status"></select></label>
    <label>Timeline note<textarea required name="note" maxlength="1000"></textarea></label><button>Record transition</button></fieldset></form>
    <h2>Corrective actions</h2><ul id="actions"></ul><form id="corrective"><label>Owner ID<input required name="owner" maxlength="80"></label>
    <label>Description<input name="description" required maxlength="500"></label><label>Due time<input type="datetime-local" required name="due"></label><button>Add corrective action</button></form></section>`,`
    const endpoint='/api/jobs/v1/admin/incidents',el=id=>document.getElementById(id);let offset=0,selected=null;
    async function api(path,body){const r=await fetch(endpoint+path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify(body)}:{});
      const result=await r.json();if(!r.ok)throw Error(result.error);return result}
    const error=e=>el('feedback').textContent=e.message;
    async function list(){const data=await api('?offset='+offset);el('queue').replaceChildren();for(const row of data.rows){const li=document.createElement('li'),b=document.createElement('button');
      b.textContent=row.severity+' · '+row.status+' · '+row.summary;b.onclick=()=>openIncident(row.id).catch(error);li.append(b);el('queue').append(li)}
      el('prev').disabled=!offset;el('next').disabled=data.rows.length<data.limit}
    async function openIncident(id){const data=await api('/'+id);selected=data.incident;el('detail').hidden=false;el('title').textContent=selected.summary;
      el('clock').textContent=selected.status+' · Escalation review due '+new Date(selected.review_due_at).toLocaleString()+(selected.reporting_due_at?' ? Internal reporting review due '+new Date(selected.reporting_due_at).toLocaleString():'');el('timeline').replaceChildren();
      for(const event of data.timeline){const li=document.createElement('li');li.textContent=[new Date(event.at).toLocaleString(),event.actor,event.action,event.note].filter(Boolean).join(' · ');el('timeline').append(li)}
      const next={OPEN:'CONTAINED',CONTAINED:'RECOVERING',RECOVERING:'RESOLVED'}[selected.status];el('transition').hidden=!next;el('assign').hidden=!next;
      el('transition').elements.status.replaceChildren(...(next?[new Option(next,next)]:[]));el('assign').elements.owner.value=selected.owner;el('assign').elements.severity.value=selected.severity;
      el('actions').replaceChildren();for(const a of data.corrective){const li=document.createElement('li');li.textContent=a.owner+' · '+a.description+' · '+new Date(a.due_at).toLocaleString();
        if(!a.completed_at){const b=document.createElement('button');b.textContent='Mark completed';b.onclick=async()=>{try{await api('/'+id+'/corrective/'+a.id,{});await openIncident(id)}catch(e){error(e)}};li.append(b)}else li.append(' · Completed');el('actions').append(li)}}
    for(const form of document.forms)form.onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(form));
      const id=selected?.id;if(form.id!=='new'&&!id)return;
      if(['transition','assign'].includes(form.id))b.revision=selected.revision;if(b.due){b.dueAt=new Date(b.due).getTime();delete b.due}
      try{const result=await api(form.id==='new'?'':'/'+id+'/'+form.id,b);form.reset();await list();await openIncident(form.id==='new'?result.id:id);el('feedback').textContent='Incident updated.'}catch(err){error(err)}};
    el('prev').onclick=()=>{offset=Math.max(0,offset-25);list().catch(error)};el('next').onclick=()=>{offset+=25;list().catch(error)};list().catch(error);`);
}

export function operationsPage():Response{
  return jobsPage(`<h1>Interview recovery queue</h1><a href="/jobs/admin">Administration dashboard</a>
    <div><button data-op="reconcile">Reconcile meetings</button><button data-op="queue-reminders">Queue due reminders</button><button data-op="dispatch-reminders">Dispatch reminders</button></div>
    <p role="status" id="feedback"></p><ul id="queue"></ul><button id="prev">Previous page</button><button id="next">Next page</button>`,`
    const endpoint='/api/jobs/v1/admin/operations',el=id=>document.getElementById(id);let offset=0,busy=false;
    async function command(op,body={}){if(busy)return;busy=true;try{const r=await fetch(endpoint+'/'+op,{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify(body)});
      const data=await r.json();if(!r.ok)throw Error(data.error);el('feedback').textContent=Object.entries(data).map(([key,value])=>key+' '+value).join(' · ');await load()}catch(e){el('feedback').textContent=e.message}finally{busy=false}}
    async function load(){const r=await fetch(endpoint+'?offset='+offset);if(!r.ok)throw Error('Unable to load operations.');const data=await r.json();
      el('queue').replaceChildren();for(const row of data.rows){const li=document.createElement('li');li.textContent=[row.operation,row.interview,row.status,row.attempts+'/'+row.max_attempts+' attempts',row.attempts>=row.max_attempts?'Retries exhausted':'',row.last_error].filter(Boolean).join(' · ');
        if(row.status==='FAILED'){const b=document.createElement('button');b.textContent='Retry';b.onclick=()=>command('retry/'+row.id,{reminder:row.operation==='REMINDER'});li.append(b)}el('queue').append(li)}
      if(!data.rows.length)el('queue').textContent='No pending or failed operations on this page.';
      el('prev').disabled=!offset;el('next').disabled=data.rows.length<data.limit}
    for(const b of document.querySelectorAll('[data-op]'))b.onclick=()=>command(b.dataset.op);
    const reload=()=>load().catch(e=>el('feedback').textContent=e.message);
    el('prev').onclick=()=>{offset=Math.max(0,offset-25);reload()};el('next').onclick=()=>{offset+=25;reload()};reload();`);
}

export function analyticsPage():Response{
  return jobsPage(`<h1>Jobs operational analytics</h1><a href="/jobs/admin">Administration dashboard</a>
    <form><label>Reporting period in days<input name="days" type="number" min="1" max="90" required value="30"></label><button>Apply period</button></form>
    <p id="period"></p><p id="feedback" role="status"></p><ul id="metrics"></ul><h2 id="heading" hidden>Breakdown</h2><ul id="groups"></ul>`,`
    const el=id=>document.getElementById(id),form=document.querySelector('form');let days=30;
    async function load(group=''){const r=await fetch('/api/jobs/v1/admin/analytics?'+new URLSearchParams({days:String(days),group}));if(!r.ok)throw Error('Analytics unavailable.');
      const data=await r.json();el('period').textContent=new Date(data.period.start).toLocaleString()+' – '+new Date(data.period.end).toLocaleString();el('feedback').textContent=data.suppression;
      el('metrics').replaceChildren();for(const [key,value] of Object.entries(data.counts)){const li=document.createElement('li');li.textContent=data.denominators[key]+' · '+(value===null?'Below 5':value);
        if(value!==null&&!['resolved','overturned'].includes(key)){const b=document.createElement('button');b.textContent='Break down '+key.replaceAll('_',' ');b.onclick=()=>load(key).catch(error);li.append(b)}el('metrics').append(li)}
      el('heading').hidden=!group;el('groups').replaceChildren();for(const row of data.breakdown){const li=document.createElement('li');li.textContent=row.category+' · '+row.count;el('groups').append(li)}}
    const error=e=>el('feedback').textContent=e.message;form.onsubmit=e=>{e.preventDefault();days=Number(form.elements.days.value);load().catch(error)};load().catch(error);`);
}

export function ownershipRecoveryPage(admin:boolean):Response{
  return jobsPage(`<h1>Ownership recovery cases</h1><p>Ownership changes require an accepted transfer. Reviewers can request evidence or record a case outcome.</p>
    ${admin?'':'<form><label>Company ID<input required name="company" maxlength="80"></label><label>Case type<select name="kind"><option value="DISPUTED">Disputed ownership</option><option value="UNAVAILABLE_OWNER">Unavailable owner</option></select></label><label>Evidence reference<input required name="reference" maxlength="200"></label><button>Open case</button></form>'}
    <p id="feedback" role="status"></p><ul id="cases"></ul><button id="prev">Previous page</button><button id="next">Next page</button>`,`
    const admin=${admin},endpoint='/api/jobs/v1/${admin?'admin/':''}ownership-recovery',el=id=>document.getElementById(id);let offset=0;
    async function api(path,body){const r=await fetch(endpoint+path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Jobs-Request':'1'},body:JSON.stringify(body)}:{});
      const data=await r.json();if(!r.ok)throw Error(data.error);return data}
    const error=e=>el('feedback').textContent=e.message;
    async function load(){const data=await api('?offset='+offset);el('cases').replaceChildren();
      for(const c of data.rows){const li=document.createElement('li');li.textContent=[c.company,c.kind,c.status,c.evidence_ref,c.decision].filter(Boolean).join(' · ');
        const options=admin?(c.status==='OPEN'?['REVIEWING']:c.status==='REVIEWING'?['MORE_INFO','CLOSED']:[]):c.status==='MORE_INFO'?['REVIEWING']:[];
        for(const status of options){const b=document.createElement('button');b.textContent=admin?{REVIEWING:'Take case',MORE_INFO:'Request evidence',CLOSED:'Close with decision'}[status]:'Provide evidence';
          b.onclick=async()=>{const note=window.prompt(admin?'Review note for requester':'Updated evidence reference');if(!note)return;try{await api('/'+c.id,{status,note,revision:c.revision});await load()}catch(err){error(err)}};li.append(b)}el('cases').append(li)}
      el('prev').disabled=!offset;el('next').disabled=data.rows.length<data.limit}
    if(!admin)document.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;try{await api('',Object.fromEntries(new FormData(f)));f.reset();await load()}catch(err){error(err)}};
    el('prev').onclick=()=>{offset=Math.max(0,offset-25);load().catch(error)};el('next').onclick=()=>{offset+=25;load().catch(error)};load().catch(error);`);
}
