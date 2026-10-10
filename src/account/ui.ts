/** Standalone V1 account surface, deliberately independent of V0 media scripts. */
export function accountPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Account · BillionTalks</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,"Segoe UI",sans-serif;background:#081327;color:#f8fbff}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 15% 0%,#12356b 0%,#081327 50%);display:grid;place-items:center;padding:24px}
main{width:min(100%,540px);background:#101f38;border:1px solid #25416a;border-radius:22px;padding:clamp(24px,5vw,44px);box-shadow:0 20px 80px #02071380}
a{color:#78bcff}h1{font-size:28px;margin:18px 0 8px}p{color:#bac9df;line-height:1.5}label{display:block;font-weight:600;font-size:13px;margin:14px 0 7px}
input,select{width:100%;min-height:46px;border:1px solid #3a5478;border-radius:11px;background:#09182d;color:white;padding:11px 13px;font:inherit}
input[type=checkbox]{width:auto;min-height:0;accent-color:#318aff}button{background:#398bff;color:#fff;border:0;border-radius:11px;padding:12px 18px;font:inherit;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:wait}
button.secondary{background:#223c64}nav{display:flex;flex-wrap:wrap;gap:9px;margin:22px 0}nav button{font-size:12px;padding:9px 12px}.brand{font-weight:800;letter-spacing:.02em;font-size:20px}.brand span{color:#56a8ff}
section[hidden],div[hidden]{display:none!important}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}.toggle{display:flex;align-items:center;gap:9px;margin-top:12px}.toggle label{margin:0}.status{margin-top:18px;padding:12px;border-radius:10px;background:#182b48;white-space:pre-line}.status:empty{display:none}
small{color:#9ab0cc}a.back{display:inline-block;margin-top:18px}.password{display:flex;gap:8px}.password input{flex:1;min-width:0}.password button{background:#27456e}
</style></head><body><main>
<div class="brand">Billion<span>Talks</span></div><nav aria-label="Account navigation">
<button data-page="login">Sign in</button><button data-page="register" class="secondary">Create account</button><button data-page="profile" class="secondary">Profile</button></nav>
<div id="status" class="status" role="status" aria-live="polite"></div>
<section data-panel="login"><h1>Welcome back</h1><p>Sign in to your BillionTalks account.</p>
<form id="login"><label>Email<input name="email" type="email" autocomplete="email" required></label>
<label>Password</label><div class="password"><input name="password" type="password" autocomplete="current-password" required><button type="button" class="secondary" data-show>Show</button></div>
<div class="actions"><button type="submit">Sign in</button><button type="button" class="secondary" data-page="forgot">Forgot password?</button></div></form></section>
<section data-panel="register" hidden><h1>Create account</h1><p>Verify your email before signing in.</p>
<form id="register"><label>Full name<input name="fullName" autocomplete="name" maxlength="200" required></label>
<label>Email<input name="email" type="email" autocomplete="email" required></label>
<label>Country (ISO two-letter code)<input name="country" autocomplete="country" minlength="2" maxlength="2" placeholder="IN" pattern="[A-Za-z]{2}" required></label>
<label>Mobile number (E.164)<input name="mobileNumber" autocomplete="tel" placeholder="+919876543210" pattern="[+][1-9][0-9]{1,14}" required></label>
<label>Password (8 characters minimum)<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
<label>Confirm password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></label>
<div class="toggle"><input id="terms" name="acceptedTerms" type="checkbox" required><label for="terms">I agree to the Terms of Service and Privacy Policy.</label></div>
<div class="toggle"><input id="marketing" name="marketingConsent" type="checkbox"><label for="marketing">Email me product updates (optional).</label></div>
<div class="actions"><button type="submit">Create account</button></div></form></section>
<section data-panel="verify" hidden><h1>Verify your email</h1><p>Use the secure verification link sent to your email, or enter the token below.</p>
<form id="verify"><label>Verification token<input name="token" autocomplete="off" required></label><div class="actions"><button type="submit">Verify email</button></div></form>
<form id="resend"><label>Email<input name="email" type="email" autocomplete="email" required></label><div class="actions"><button type="submit" class="secondary">Resend verification</button></div></form></section>
<section data-panel="forgot" hidden><h1>Reset your password</h1><p>If your email is registered, you will receive reset instructions.</p>
<form id="forgot"><label>Email<input name="email" type="email" autocomplete="email" required></label><div class="actions"><button type="submit">Send reset link</button></div></form></section>
<section data-panel="reset" hidden><h1>Choose a new password</h1>
<form id="reset"><label>Reset token<input name="token" required autocomplete="off"></label>
<label>New password<input name="newPassword" type="password" minlength="8" required autocomplete="new-password"></label>
<label>Confirm password<input name="confirmPassword" type="password" minlength="8" required autocomplete="new-password"></label>
<div class="actions"><button type="submit">Change password</button></div></form></section>
<section data-panel="profile" hidden><h1>Account profile</h1>
<form id="profile"><label>Full name<input name="fullName" maxlength="200" required></label>
<label>Email (verified; read-only)<input name="email" type="email" readonly></label>
<label>Country (ISO two-letter code)<input name="country" minlength="2" maxlength="2" required></label>
<label>Mobile number<input name="mobileNumber" required></label>
<div class="toggle"><input id="profileMarketing" type="checkbox" name="marketingConsent"><label for="profileMarketing">Email me product updates</label></div>
<div class="actions"><button type="submit">Save changes</button><button type="button" id="logout" class="secondary">Sign out</button></div></form></section>
<a class="back" href="/">← Back to meetings</a>
<script>
(function(){
'use strict';
const panels=[...document.querySelectorAll('[data-panel]')], status=document.getElementById('status');
function message(value){status.textContent=value||''}
function view(page){if(!panels.some(p=>p.dataset.panel===page))page='login';panels.forEach(p=>p.hidden=p.dataset.panel!==page);history.replaceState(null,'','#'+page);message('');if(page==='profile')void loadProfile()}
async function api(path,method,body){const response=await fetch('/api/accounts/'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});let payload;try{payload=await response.json()}catch{throw Error('Unable to complete this request.')}if(!response.ok||!payload.ok)throw Error(payload.error||'Unable to complete this request.');return payload.data}
async function submit(id,path,method,build,onSuccess){document.getElementById(id).addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button[type=submit]');if(!form.reportValidity())return;const values=Object.fromEntries(new FormData(form));try{button.disabled=true;message('');const body=build?build(values,form):values;const data=await api(path,method,body);await onSuccess(data,values); }catch(error){message(error instanceof Error?error.message:'Unable to complete this request.')}finally{button.disabled=false}})}
function matching(v,key='password',other='confirmPassword'){if(v[key]!==v[other])throw Error('Passwords do not match.');return v}
submit('login','login','POST',v=>({email:v.email,password:v.password}),async()=>{view('profile');message('Signed in successfully.')});
submit('register','register','POST',(v,form)=>{matching(v);return{fullName:v.fullName,email:v.email,country:v.country.toUpperCase(),mobileNumber:v.mobileNumber,password:v.password,acceptedTerms:form.elements.acceptedTerms.checked,marketingConsent:form.elements.marketingConsent.checked}},async(d,v)=>{view('verify');document.querySelector('#resend [name=email]').value=v.email;message('Account created. Check your email for the verification link.')});
submit('verify','verify-email','POST',v=>({token:v.token}),async()=>{view('login');message('Email verified. Sign in to continue.')});
submit('resend','resend-verification','POST',v=>({email:v.email}),async()=>message('If an unverified account matches, a new message will be sent.'));
submit('forgot','forgot-password','POST',v=>({email:v.email}),async()=>message('If an active account matches, reset instructions will be sent.'));
submit('reset','reset-password','POST',v=>{matching(v,'newPassword');return{token:v.token,newPassword:v.newPassword}},async()=>{view('login');message('Password changed. Sign in with your new password.')});
submit('profile','me','PATCH',(v,form)=>({fullName:v.fullName,country:v.country.toUpperCase(),mobileNumber:v.mobileNumber,marketingConsent:form.elements.marketingConsent.checked}),async()=>message('Profile updated.'));
async function loadProfile(){try{const d=await api('me','GET');const f=document.getElementById('profile');for(const [key,val] of Object.entries({fullName:d.account.fullName,email:d.account.email,country:d.account.countryCode,mobileNumber:d.account.mobileNumber})){f.elements[key].value=val||''}f.elements.marketingConsent.checked=!!d.account.marketingConsent}catch{view('login');message('Sign in to access your profile.')}}
document.getElementById('logout').addEventListener('click',async()=>{try{await api('logout','POST',{});view('login');message('Signed out.')}catch(e){message(e.message)}});
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.page)));
document.querySelectorAll('[data-show]').forEach(b=>b.addEventListener('click',()=>{const i=b.parentElement.querySelector('input');i.type=i.type==='password'?'text':'password';b.textContent=i.type==='password'?'Show':'Hide'}));
const params=new URLSearchParams(location.search),token=params.get('token');
if(token){const isReset=params.get('flow')==='reset';view(isReset?'reset':'verify');document.querySelector('#'+(isReset?'reset':'verify')+' [name=token]').value=token;history.replaceState(null,'',location.pathname+'#'+(isReset?'reset':'verify'))}
else view(location.hash.slice(1)||'login');
})();
</script></main></body></html>`;
}
