import logoSource from "../assets/brand/billiontalks-logo.png";

function logoDataUrl(source: string | ArrayBuffer): string {
  if (typeof source === "string") return source;
  let binary = "";
  for (const byte of new Uint8Array(source)) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

export function notificationsPage(): string {
  const logoUrl = logoDataUrl(logoSource);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Notifications · BillionTalks</title><link rel="icon" type="image/png" sizes="32x32" href="/assets/website/favicon-32.png">
<style>
:root{color-scheme:light;font-family:Inter,system-ui,"Segoe UI",sans-serif;background:#f4f7fc;color:#17233c}*{box-sizing:border-box}
body{margin:0;min-width:320px;min-height:100vh;background:linear-gradient(135deg,#f7faff,#edf3fb)}a{color:inherit;text-decoration:none}
header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px clamp(18px,5vw,64px);background:#fff;border-bottom:1px solid #dce5f1}
header img{width:190px;height:auto}.nav{display:flex;flex-wrap:wrap;gap:18px;color:#315176;font-weight:650;font-size:14px}.nav a[aria-current="page"]{color:#176fd2;font-weight:800}
main{width:min(100% - 32px,860px);margin:48px auto}.heading{display:flex;align-items:end;justify-content:space-between;gap:16px}
h1{margin:0;font-size:clamp(28px,4vw,38px);letter-spacing:-.035em}p{color:#718198}
button{border:0;border-radius:10px;padding:11px 15px;background:#1f78dd;color:white;font:inherit;font-weight:700;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}.status{min-height:24px;color:#a52e4b}.list{display:grid;gap:12px}
article{padding:18px 20px;border:1px solid #dce5f1;border-radius:15px;background:#fff;box-shadow:0 8px 25px #16345b0a}
article.unread{border-left:4px solid #2879eb}.item{display:flex;align-items:start;justify-content:space-between;gap:18px}
article h2{margin:0;font-size:16px}article p{margin:7px 0;color:#596b83;line-height:1.5}time{font-size:12px;color:#8694a7}
.actions{display:flex;gap:12px;align-items:center;margin-top:10px}.actions button{padding:7px 10px;font-size:12px;background:#eaf2fc;color:#245183}
.empty{padding:30px;text-align:center;color:#74849a;background:#fff;border:1px dashed #cbd7e6;border-radius:14px}
@media(max-width:540px){header{align-items:flex-start;flex-direction:column}.nav{gap:12px}.heading{align-items:flex-start;flex-direction:column}main{margin-top:30px}}
@media(min-width:541px){header{padding:12px clamp(18px,4vw,48px)}main{margin:28px auto 36px}.heading p{margin:8px 0 14px}.list{gap:10px}article{padding:14px 18px}article p{margin:5px 0}.actions{margin-top:8px}.empty{padding:22px}}
</style></head><body>
<header><a href="/dashboard" aria-label="BillionTalks dashboard"><img src="${logoUrl}" alt="BillionTalks"></a>
<nav class="nav" aria-label="Workspace"><a href="/dashboard">Dashboard</a><a href="/schedule">Meetings</a><a href="/calendar">Calendar</a><a href="/contacts">Contacts &amp; Invitations</a><a href="/notifications" aria-current="page">Notifications</a><a href="/account#preferences">Settings</a></nav></header>
<main><div class="heading"><div><h1>Notifications</h1><p>Updates about your scheduled meetings and invitation responses.</p></div><button id="readAll" type="button">Mark all read</button></div>
<div id="status" class="status" role="status" aria-live="polite"></div><section id="notifications" class="list" aria-label="Your notifications"><div class="empty">Loading notifications…</div></section></main>
<script>
(()=>{'use strict';const list=document.getElementById('notifications'),status=document.getElementById('status'),readAll=document.getElementById('readAll');
async function api(path,options){const response=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options&&options.headers||{})}});let payload;try{payload=await response.json()}catch{throw Error('The notifications response could not be read.')}if(response.status===401){location.href='/account#login';throw Error('Sign in to view notifications.')}if(!response.ok||!payload.ok)throw Error(payload.error||'Unable to load notifications.');return payload.data}
function render(data){list.replaceChildren();if(!data.notifications.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='You have no notifications yet.';list.append(empty)}for(const item of data.notifications){const card=document.createElement('article');card.classList.toggle('unread',!item.isRead);const row=document.createElement('div');row.className='item';const content=document.createElement('div');const title=document.createElement('h2');title.textContent=item.title;const body=document.createElement('p');body.textContent=item.body;const time=document.createElement('time');time.dateTime=item.createdAt;time.textContent=new Date(item.createdAt).toLocaleString();content.append(title,body,time);row.append(content);if(item.meetingId&&/^btm_[A-Za-z0-9_-]{8,64}$/.test(item.meetingId)){const link=document.createElement('a');link.href='/?meeting='+encodeURIComponent(item.meetingId);link.textContent='Open meeting';row.append(link)}card.append(row);if(!item.isRead){const actions=document.createElement('div');actions.className='actions';const button=document.createElement('button');button.type='button';button.textContent='Mark read';button.addEventListener('click',async()=>{button.disabled=true;try{await api('/api/notifications/'+encodeURIComponent(item.id),{method:'PATCH',body:JSON.stringify({isRead:true})});await load()}catch(error){status.textContent=error.message;button.disabled=false}});actions.append(button);card.append(actions)}list.append(card)}readAll.disabled=data.unreadCount===0}
async function load(){status.textContent='';try{render(await api('/api/notifications'))}catch(error){status.textContent=error instanceof Error?error.message:'Unable to load notifications.'}}
readAll.addEventListener('click',async()=>{readAll.disabled=true;try{await api('/api/notifications/read-all',{method:'POST',body:'{}'});await load()}catch(error){status.textContent=error instanceof Error?error.message:'Unable to update notifications.';readAll.disabled=false}});void load()})();
</script></body></html>`;
}
