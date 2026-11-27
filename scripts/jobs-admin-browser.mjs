// Standalone local acceptance check. Supply the installed Chromium executable.
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
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
let browser;
try{
  for(const subject of ['browser-owner','browser-auditor']){
    await seedIdentity(runtime.accounts,subject);
    await runtime.jobs.prepare('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,0)').bind(subject).run();
  }
  await runtime.bootstrapOwner('browser-owner');
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
      response=await handleJobs(input,true,runtime.jobs,async()=>({subject:'browser-owner',privilegedMfaAt:Date.now(),reauthenticatedAt:Date.now()}));
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
      else if(message.method==='Fetch.requestPaused')respond(message).catch(error=>{console.error(error);browser.kill()});
    }
  });
  const {targetId}=await cdp('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
  const cmd=(method,params)=>cdp(method,params,sessionId);
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
}finally{
  if(browser&&browser.exitCode===null){const closed=new Promise(resolve=>browser.once('exit',resolve));browser.kill();await closed}
  await runtime.mf.dispose();
  if(dirname(resolve(profile))!==resolve(tmpdir())||!basename(profile).startsWith('jobs-admin-browser-'))throw Error('Unexpected temporary profile path');
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});
}
