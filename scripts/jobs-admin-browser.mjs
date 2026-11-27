// Standalone local acceptance check. Supply the installed Chromium executable.
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createJobsRuntime,seedIdentity} from './jobs-runtime.mjs';

const executable=process.argv[2];
if(!executable)throw Error('Pass the path to an installed Chromium browser');
const source=await build({entryPoints:['src/jobs/api.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {handleJobs}=await import('data:text/javascript;base64,'+Buffer.from(source.outputFiles[0].contents).toString('base64'));
const runtime=await createJobsRuntime({enabled:true});
const profile=await mkdtemp(join(tmpdir(),'jobs-admin-browser-'));
let browser,shuttingDown=false;
try{
  for(const subject of ['browser-owner','browser-auditor','browser-reviewer']){
    await seedIdentity(runtime.accounts,subject);
    await runtime.jobs.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(subject).run();
  }
  await runtime.bootstrapOwner('browser-owner');
  await runtime.jobs.prepare("INSERT INTO admin_grants VALUES('browser-reviewer','BILLIONJOBS','MODERATOR','fixture',?,NULL)").bind(Date.now()).run();
  let currentSubject='browser-owner',dialogResponse='SYNTHETIC_REVIEW';
  const company=crypto.randomUUID();
  await runtime.jobs.prepare("INSERT INTO companies(id,owner,data,created_at) VALUES(?,'browser-owner','{}',?)").bind(company,Date.now()).run();
  await runtime.jobs.prepare("INSERT INTO memberships VALUES(?,'browser-auditor','RECRUITER',NULL)").bind(company).run();
  await runtime.jobs.prepare("INSERT INTO moderation_cases(id,kind,target_ref,reporter,category,severity,status,created_at,updated_at) VALUES('browser-case','CANDIDATE','browser-auditor','browser-owner','ABUSE','MEDIUM','OPEN',?,?)").bind(Date.now(),Date.now()).run();
  browser=spawn(executable,['--headless=new','--disable-gpu','--disable-background-networking','--disable-sync','--no-first-run','--remote-debugging-pipe','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','ignore','pipe','pipe']});
  const pending=new Map();let next=0,buffer='';
  const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++next;pending.set(id,{resolve,reject});
    browser.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');
  });
  browser.once('exit',()=>{for(const task of pending.values())task.reject(Error('Browser closed'));pending.clear()});
  const local='https://jobs.example.invalid';
  async function respond(message){
    const {request,requestId}=message.params;
    let response=new Response('',{status:404});
    if(new URL(request.url).origin===local){
      const input=new Request(request.url,{method:request.method,headers:request.headers,body:request.postData});
      response=await handleJobs(input,true,runtime.jobs,async()=>({subject:currentSubject,recipientHash:createHash('sha256').update(currentSubject+'@example.invalid').digest('hex'),privilegedMfaAt:Date.now(),reauthenticatedAt:Date.now()}));
    }
    await cdp('Fetch.fulfillRequest',{requestId,responseCode:response.status,responseHeaders:Array.from(response.headers,([name,value])=>({name,value})),body:Buffer.from(await response.arrayBuffer()).toString('base64')},message.sessionId);
  }
  browser.stdio[4].setEncoding('utf8');
  browser.stdio[4].on('data',chunk=>{
    buffer+=chunk;let end;
    while((end=buffer.indexOf('\0'))>=0){
      const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
      const task=pending.get(message.id);
      if(task){pending.delete(message.id);if(message.error)task.reject(Error(message.error.message));else task.resolve(message.result)}
      else if(message.method==='Page.javascriptDialogOpening')cdp('Page.handleJavaScriptDialog',{accept:true,promptText:dialogResponse},message.sessionId).catch(error=>{if(!shuttingDown){console.error(error);process.exitCode=1;browser.kill()}});
      else if(message.method==='Fetch.requestPaused')respond(message).catch(error=>{if(!shuttingDown){console.error(error);process.exitCode=1;browser.kill()}});
    }
  });
  const {targetId}=await cdp('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
  const cmd=(method,params)=>cdp(method,params,sessionId);
  await cmd('Page.enable',{});
  await cmd('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const evaluate=async expression=>(await cmd('Runtime.evaluate',{expression,returnByValue:true})).result.value;
  const waitFor=async expression=>{
    for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}
    throw Error('Browser assertion timed out: '+expression);
  };
  for(const width of [375,1280]){
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
    await cmd('Page.navigate',{url:local+'/jobs/admin/roles'});
    await waitFor("document.querySelector('#role')?.options.length===7");
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await evaluate('document.activeElement.blur()');
    await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',windowsVirtualKeyCode:9});
    await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',windowsVirtualKeyCode:9});
    await waitFor("document.activeElement.tagName==='A'");
    await evaluate("document.querySelector('#subject').value='browser-auditor';document.querySelector('#role').value='AUDITOR';document.querySelector('[value=grant]').click()");
    await waitFor("document.querySelector('#grants').textContent.includes('browser-auditor')");
    await evaluate("document.querySelector('#role').value='AUDITOR';document.querySelector('[value=revoke]').click()");
    await waitFor("!document.querySelector('#grants').textContent.includes('browser-auditor')");
    console.log('Passed role grant/revocation, first keyboard navigation and horizontal fit at '+width+'px');
  }
  await cmd('Page.navigate',{url:local+'/jobs/admin/companies/'+company+'/members'});
  await waitFor("document.querySelector('#members button')?.textContent.includes('browser-auditor')");
  await evaluate("document.querySelector('#members button').click()");
  await waitFor("document.querySelector('#members').textContent.includes('(revoked)')");
  await cmd('Page.navigate',{url:local+'/jobs/companies/'+company+'/verification'});
  await waitFor("document.querySelector('#current')?.textContent.includes('UNVERIFIED')");
  await evaluate("document.querySelector('[name=reference]').value='synthetic:company';document.querySelector('form button').click()");
  await waitFor("document.querySelector('#current').textContent.includes('EVIDENCE_PENDING')");
  await cmd('Page.navigate',{url:local+'/jobs/admin/companies/'+company+'/verification'});
  for(const state of ['IN_REVIEW','VERIFIED','EXPIRED']){
    await waitFor("Array.from(document.querySelector('[name=state]')?.options||[]).some(o=>o.value==='"+state+"')");
    await evaluate("document.querySelector('[name=state]').value='"+state+"';document.querySelector('form button').click()");
    await waitFor("document.querySelector('#current').textContent==='Verification status: "+state+"'");
  }
  await cmd('Page.navigate',{url:local+'/jobs/admin/privacy'});
  await waitFor("document.querySelector('#notice button')");
  await evaluate("document.querySelector('#notice [name=version]').value='BJ-local';document.querySelector('#notice textarea').value='Local synthetic notice';document.querySelector('#notice button').click()");
  await waitFor("document.querySelector('#published').textContent.includes('BJ-local')");
  currentSubject='browser-auditor';
  await cmd('Page.navigate',{url:local+'/jobs/privacy'});
  await waitFor("document.querySelector('#published')?.textContent.includes('BJ-local')");
  await evaluate("document.querySelector('#consent button[value=grant]').click()");
  await waitFor("document.querySelector('#history').textContent.includes('Granted')");
  await evaluate("document.querySelector('#consent button[value=withdraw]').click()");
  await waitFor("document.querySelector('#history').textContent.includes('Withdrawn')");
  await evaluate("document.querySelector('#requests button').click()");
  await waitFor("document.querySelector('#request-list').textContent.includes('SUBMITTED')");
  currentSubject='browser-owner';
  await cmd('Page.navigate',{url:local+'/jobs/admin/privacy'});
  await waitFor("document.querySelector('#request-list button')?.textContent==='Approve'");
  await evaluate("document.querySelector('#request-list button').click()");
  await waitFor("document.querySelector('#request-list').textContent.includes('REVIEWING')");
  currentSubject='browser-auditor';
  await cmd('Page.navigate',{url:local+'/jobs/privacy'});
  await waitFor("document.querySelector('#request-list button')?.textContent==='Download Jobs export'");
  await cmd('Browser.setDownloadBehavior',{behavior:'deny'});
  await evaluate("document.querySelector('#request-list button').click()");
  await waitFor("document.querySelector('#request-list').textContent.includes('COMPLETED')");
  currentSubject='browser-owner';
  await cmd('Page.navigate',{url:local+'/jobs/admin'});
  await waitFor("document.querySelector('a[href$=\"/cases/browser-case\"]')");
  await evaluate("document.querySelector('a[href$=\"/cases/browser-case\"]').click()");
  await waitFor("document.querySelector('#review')?.hidden===false");
  await evaluate("const f=document.querySelector('#evidence');f.elements.reference.value='synthetic:record';f.elements.note.value='Synthetic reviewer note';f.querySelector('button').click()");
  await waitFor("document.querySelector('#events').textContent.includes('synthetic:record')");
  await evaluate("const d=document.querySelector('#decision');d.elements.status.value='RESOLVED';d.elements.note.value='Synthetic decision';d.querySelector('button').click()");
  await waitFor("document.querySelector('#events').textContent.includes('RESOLVED')");
  await cmd('Page.navigate',{url:local+'/jobs/admin/users/browser-auditor'});
  await waitFor("document.querySelector('[name=caseId]')?.value==='browser-case'");
  await evaluate("document.querySelector('[name=reasonCode]').value='SYNTHETIC';document.querySelector('form button').click()");
  await waitFor("document.querySelector('#actions')?.textContent.includes('WARNING')");
  currentSubject='browser-auditor';
  await cmd('Page.navigate',{url:local+'/jobs/appeals'});
  await waitFor("document.querySelector('#submit [name=action]')?.options.length===1");
  await evaluate("document.querySelector('#submit textarea').value='Please review';document.querySelector('#submit button').click()");
  await waitFor("document.querySelector('#history')?.textContent.includes('SUBMITTED')");
  const openReview=async(subject,admin)=>{
    currentSubject=subject;
    await cmd('Page.navigate',{url:local+(admin?'/jobs/admin/appeals':'/jobs/appeals')});
    await waitFor("document.querySelector('#appeals button')");
    await evaluate("document.querySelector('#appeals button').click()");
    await waitFor("document.querySelector('#detail')?.hidden===false");
  };
  const updateAppeal=async(status,message)=>{
    await evaluate("document.querySelector('#update [name=status]').value="+JSON.stringify(status)+";document.querySelector('#update textarea').value="+JSON.stringify(message)+";document.querySelector('#update button').click()");
    await waitFor("document.querySelector('#history').textContent.includes("+JSON.stringify(message)+")");
  };
  await openReview('browser-reviewer',true);
  await updateAppeal('ACKNOWLEDGED','Independent reviewer assigned');
  await updateAppeal('MORE_INFO','Please clarify the dates');
  await openReview('browser-auditor',false);
  await updateAppeal('ACKNOWLEDGED','Appellant clarification');
  await openReview('browser-reviewer',true);
  await updateAppeal('REVIEWING','Review started');
  await updateAppeal('UPHELD','Appeal decision');
  currentSubject='browser-owner';
  await cmd('Page.navigate',{url:local+'/jobs/admin/users/browser-auditor'});
  await waitFor("document.querySelector('#actions button')");
  await evaluate("document.querySelector('#actions button').click()");
  await waitFor("document.querySelector('#actions').textContent.includes('Revoked')");
  await evaluate("document.querySelector('#close-account').click()");
  await waitFor("document.querySelector('#account').textContent.includes('(closed)')");
  await cmd('Page.navigate',{url:local+'/jobs/admin/incidents'});
  await waitFor("document.querySelector('#new button')");
  await evaluate("document.querySelector('#new [name=summary]').value='Synthetic dispatch interruption';document.querySelector('#new button').click()");
  await waitFor("document.querySelector('#title')?.textContent==='Synthetic dispatch interruption'");
  await evaluate("document.querySelector('#assign [name=severity]').value='HIGH';document.querySelector('#assign button').click()");
  await waitFor("document.querySelector('#timeline').textContent.includes('ASSIGN')");
  for(const next of ['CONTAINED','RECOVERING','RESOLVED']){
    await waitFor("document.querySelector('#transition [name=status]')?.value==='"+next+"'");
    await evaluate("document.querySelector('#transition textarea').value='Local response recorded';document.querySelector('#transition button').click()");
    await waitFor("document.querySelector('#timeline').textContent.includes('"+next+"')");
  }
  await cmd('Page.navigate',{url:local+'/jobs/admin/policies'});
  await waitFor("document.querySelector('[name=key]')?.options.length>0");
  await evaluate("const k=document.querySelector('[name=key]');k.value='complaint_response_target_days';k.dispatchEvent(new Event('change'));document.querySelector('[name=value]').value='3';document.querySelector('form button').click()");
  await waitFor("document.querySelector('#history').textContent.includes('complaint_response_target_days')");
  await cmd('Page.navigate',{url:local+'/jobs/admin/operations'});
  await waitFor("document.querySelector('[data-op=dispatch-reminders]')");
  await evaluate("document.querySelector('[data-op=dispatch-reminders]').click()");
  await waitFor("document.querySelector('#feedback').textContent.includes('delivered 0')");
  for(const width of [375,1280]){
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
    for(const route of ['/jobs/admin','/jobs/admin/companies','/jobs/admin/users','/jobs/admin/analytics','/jobs/admin/audit','/jobs/admin/incidents','/jobs/admin/policies','/jobs/admin/operations','/jobs/admin/signals','/jobs/admin/privacy','/jobs/admin/ownership-recovery','/jobs/ownership','/jobs/reports','/jobs/appeals']){
      await cmd('Page.navigate',{url:local+route});
      await waitFor("location.pathname==="+JSON.stringify(route)+"&&document.readyState==='complete'&&document.querySelector('h1')");
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Page overflow: '+route);
      await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',windowsVirtualKeyCode:9});
      await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',windowsVirtualKeyCode:9});
      assert.equal(await evaluate("['A','BUTTON','INPUT','SELECT'].includes(document.activeElement.tagName)"),true,'Missing focus: '+route);
    }
  }
  await cmd('Page.navigate',{url:local+'/jobs/reports'});
  await waitFor("document.querySelector('[name=targetRef]')");
  await evaluate("const f=document.querySelector('form');f.elements.kind.value='COMPANY';f.elements.targetRef.value="+JSON.stringify(company)+";f.elements.category.value='LOCAL_REVIEW';f.elements.detail.value='Synthetic confidential report';f.querySelector('button').click()");
  await waitFor("document.querySelector('#reports').textContent.includes('LOCAL_REVIEW')");
  assert.equal(await evaluate("document.querySelector('#reports').textContent.includes('confidential')"),false);
  await cmd('Page.navigate',{url:local+'/jobs/ownership'});
  await waitFor("document.querySelector('#company')?.options.length===1");
  await evaluate("const f=document.querySelector('#request');f.elements.subject.value='browser-reviewer';f.elements.email.value='browser-reviewer@example.invalid';f.querySelector('button').click()");
  await waitFor("document.querySelector('#token')?.value.length===64");
  dialogResponse=await evaluate("document.querySelector('#token').value");
  currentSubject='browser-reviewer';
  await cmd('Page.navigate',{url:local+'/jobs/ownership'});
  await waitFor("document.querySelector('#requests button')?.textContent==='accept'");
  await evaluate("document.querySelector('#requests button').click()");
  await waitFor("document.querySelector('#requests').textContent.includes('Accepted') && document.querySelector('#company').options.length===1");
  dialogResponse='SYNTHETIC_REVIEW';
  await evaluate("document.querySelector('#retire [name=reason]').value='SYNTHETIC';document.querySelector('#retire button').click()");
  await waitFor("document.querySelector('#company').options.length===0 && document.querySelector('#feedback').textContent.includes('updated')");
  console.log('Passed complaint submission, recipient-bound ownership acceptance and retirement.');
  console.log('Passed separate-identity appeal review, consent and export, incident transitions, policy editing, recovery dispatch and fourteen responsive navigation checks at two widths.');
  console.log('Passed company membership revocation, verification through expiry and case-linked account warning, revocation and closure');

}finally{
  shuttingDown=true;
  if(browser&&browser.exitCode===null){const closed=new Promise(resolve=>browser.once('exit',resolve));browser.kill();await closed}
  await runtime.mf.dispose();
  if(dirname(resolve(profile))!==resolve(tmpdir())||!basename(profile).startsWith('jobs-admin-browser-'))throw Error('Unexpected temporary profile path');
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});
}
