import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js/min";
import logoSource from "../assets/brand/billiontalks-logo.png";

function logoDataUrl(source: string | ArrayBuffer): string {
  if (typeof source === "string") return source;
  const bytes = new Uint8Array(source);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

type CountryOption = {
  code: CountryCode;
  name: string;
  dialingCode: string;
  label: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[character] ?? character));
}

function countryOptions(): CountryOption[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    names = null;
  }
  return getCountries()
    .map((code) => ({
      code,
      name: names?.of(code) || code,
      dialingCode: getCountryCallingCode(code),
      label: `${names?.of(code) || code} (${code}) +${getCountryCallingCode(code)}`,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function renderCountryOptions(options: CountryOption[]): string {
  return options
    .map(({ code, name, dialingCode }) =>
      `<option value="${escapeHtml(`${name} (${code}) +${dialingCode}`)}" data-code="${code}" data-dialing-code="${dialingCode}"></option>`,
    )
    .join("");
}

/** Standalone V1 account surface, deliberately independent of V0 media scripts. */
export function accountPage(): string {
  const logoUrl = logoDataUrl(logoSource);
  const options = countryOptions();
  const dialingCodes = Object.fromEntries(options.map(({ code, dialingCode }) => [code, dialingCode]));
  const countryMetadata = options.map(({ code, name, dialingCode, label }) => ({ code, name, dialingCode, label }));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Account · BillionTalks</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, "Segoe UI", sans-serif; background: #f4f7fb; color: #16233b; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 12% 12%, #e9f4ff 0, transparent 34%), radial-gradient(circle at 90% 86%, #eef7ff 0, transparent 32%), #f4f7fb; display: grid; place-items: center; padding: 24px; }
    main { display: grid; grid-template-columns: minmax(360px, .92fr) minmax(0, 1.08fr); width: min(100%, 1120px); min-height: 640px; background: #fff; border: 1px solid #dce5f1; border-radius: 26px; overflow: hidden; box-shadow: 0 24px 70px #213b6414; }
    .brand-panel { position: relative; overflow: hidden; padding: clamp(34px, 5vw, 66px); color: #fff; background: linear-gradient(145deg, #071d49 0%, #0b3d88 56%, #176fd2 100%); }
    .brand-panel::before { content: ""; position: absolute; width: 460px; height: 460px; right: -220px; bottom: -230px; border: 1px solid #ffffff3d; border-radius: 50%; box-shadow: 0 0 0 34px #ffffff12, 0 0 0 76px #ffffff09; }
    .brand-panel::after { content: ""; position: absolute; inset: 0; opacity: .35; background: linear-gradient(120deg, transparent 12%, #55b9ff1c 44%, transparent 70%); }
    .brand-panel h2 { position: relative; z-index: 1; max-width: 390px; margin: clamp(72px, 10vh, 118px) 0 16px; font-size: clamp(31px, 4vw, 48px); line-height: 1.02; letter-spacing: -.045em; }
    .brand-panel p { position: relative; z-index: 1; max-width: 245px; color: #e5f2ff; line-height: 1.6; }
    .account-content { min-width: 0; padding: clamp(24px, 5vw, 54px); }
    a { color: #1266d2; }
    h1 { font-size: 30px; margin: 22px 0 8px; letter-spacing: -.03em; color: #152541; }
    p { color: #667995; line-height: 1.5; }
    label { display: block; color: #31435f; font-weight: 700; font-size: 13px; margin: 14px 0 7px; }
    input, select { width: 100%; min-height: 46px; border: 1px solid #cbd7e6; border-radius: 11px; background: #fff; color: #16233b; padding: 11px 13px; font: inherit; }
    input:focus, select:focus { outline: 3px solid #318aff33; border-color: #318aff; }
    input[aria-invalid="true"], select[aria-invalid="true"] { border-color: #d84d68; }
    input[type=checkbox] { width: auto; min-height: 0; accent-color: #1f78dd; }
    button { background: #1f78dd; color: #fff; border: 0; border-radius: 11px; padding: 12px 18px; font: inherit; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: .6; cursor: wait; }
    button.secondary { color: #245183; background: #eaf2fc; }
    nav { display: flex; flex-wrap: nowrap; gap: 8px; margin: 22px 0; }
    nav button { font-size: 12px; padding: 9px 12px; }
    nav button[aria-current="page"] { color: #fff; background: linear-gradient(135deg, #176fd2, #318ff0); box-shadow: 0 8px 18px #176fd22e; }
    .brand { display: inline-flex; align-items: center; font-weight: 850; letter-spacing: -.03em; font-size: 23px; color: #1266d2; }
    .logo-surface { position: relative; z-index: 1; display: inline-flex; align-items: center; width: min(100%, 250px); padding: 8px 12px; border-radius: 12px; background: #f9fbff; box-shadow: 0 10px 26px #0315362e; }
    .logo-surface img { display: block; width: 100%; height: auto; }
    .brand-panel .logo-surface { width: min(100%, 250px); }
    section[hidden], div[hidden] { display: none !important; }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 14px; }
    .form-grid > label, .form-grid > .toggle, .form-grid > .actions { min-width: 0; }
    .wide { grid-column: 1 / -1; }
    .hint { display: block; margin-top: 6px; color: #71849d; font-size: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
    .toggle { display: flex; align-items: flex-start; gap: 9px; margin-top: 12px; }
    .toggle label { margin: 0; }
    .status { margin-top: 18px; padding: 12px; border-radius: 10px; background: #edf5ff; color: #315176; white-space: pre-line; }
    .status:empty { display: none; }
    .status.error { color: #a52e4b; background: #fff0f3; }
    a.back { display: inline-block; margin-top: 18px; }
    .password { display: flex; gap: 8px; }
    .password input { flex: 1; min-width: 0; }
    .password button { background: #eaf2fc; color: #245183; }
    main[data-page="login"] { box-shadow: 0 30px 90px #1b4e8b24; }
    main[data-page="login"] .account-content { background: linear-gradient(180deg, #ffffff, #fbfdff); }
    main[data-page="login"] section[data-panel="login"] { max-width: 470px; padding-top: 34px; }
    main[data-page="login"] section[data-panel="login"] h1 { font-size: clamp(34px, 4vw, 46px); letter-spacing: -.05em; margin-top: 0; }
    main[data-page="login"] section[data-panel="login"] > p { max-width: 360px; margin-bottom: 30px; font-size: 16px; }
    main[data-page="login"] section[data-panel="login"] form { padding: 26px; border: 1px solid #e0eaf5; border-radius: 20px; background: #fff; box-shadow: 0 18px 42px #2b568b0d; }
    main[data-page="login"] section[data-panel="login"] input { min-height: 50px; border-radius: 13px; background: #fcfdff; }
    main[data-page="login"] section[data-panel="login"] .actions button:first-child { min-height: 50px; flex: 1 1 160px; background: linear-gradient(135deg, #176fd2, #318ff0); box-shadow: 0 10px 20px #176fd22e; }
    main[data-page="login"] section[data-panel="login"] .actions button:first-child:hover, main[data-page="login"] section[data-panel="login"] .actions button:first-child:focus-visible { background: linear-gradient(135deg, #0f5db8, #217cde); }
    main[data-page="login"] .back { margin-top: 28px; font-weight: 700; }
    @media (max-width: 820px) {
      body { padding: 0; }
      main { display: block; min-height: 100vh; border: 0; border-radius: 0; }
      .brand-panel { min-height: 270px; padding: 30px 26px; }
      .brand-panel h2 { margin: 54px 0 8px; font-size: 32px; }
      .brand-panel p { margin: 0; }
      .brand-panel::before { width: 260px; height: 260px; right: -130px; bottom: -150px; }
      .account-content { padding: 26px 20px 34px; }
      nav { max-width: 100%; }
      .form-grid { grid-template-columns: 1fr; }
      .wide { grid-column: auto; }
      .actions button { flex: 1 1 100%; }
    }
    @media (max-width: 420px) {
      .brand-panel { min-height: 230px; }
      .brand-panel h2 { margin-top: 38px; font-size: 29px; }
      nav button { flex: 1 1 0; min-width: 0; padding-inline: 8px; }
      nav button { font-size: 11px; }
    }
  </style>
</head>
<body>
<main>
  <aside class="brand-panel" aria-label="BillionTalks">
    <div class="logo-surface"><img src="${logoUrl}" alt="BillionTalks"></div>
    <h2>Make room for better conversations.</h2>
    <p>Meet, collaborate, and stay connected with a workspace built for meaningful conversations.</p>
  </aside>
  <div class="account-content">
  <div class="logo-surface"><img src="${logoUrl}" alt="BillionTalks"></div>
  <nav aria-label="Account navigation">
    <button data-page="login" class="secondary">Sign in</button>
    <button data-page="register" class="secondary">Create account</button>
    <button data-page="profile" class="secondary">Profile</button>
    <button data-page="preferences" class="secondary">Settings</button>
    <a class="back" href="/notifications">Notifications</a>
  </nav>
  <div id="status" class="status" role="status" aria-live="polite"></div>
  <datalist id="countryOptions">${renderCountryOptions(options)}</datalist>

  <section data-panel="login">
    <h1>Welcome back</h1>
    <p>Sign in to your BillionTalks account.</p>
    <form id="login">
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>Password</label>
      <div class="password"><input name="password" type="password" autocomplete="current-password" required><button type="button" class="secondary" data-show>Show</button></div>
      <div class="actions"><button type="submit">Sign in</button><button type="button" class="secondary" data-page="forgot">Forgot password?</button></div>
    </form>
  </section>

  <section data-panel="register" hidden>
    <h1>Create account</h1>
    <p>Verify your email before signing in.</p>
    <form id="register">
      <div class="form-grid">
        <label class="wide">Full name<input name="fullName" autocomplete="name" maxlength="200" required></label>
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Confirm email<input name="emailConfirm" type="email" autocomplete="email" required></label>
        <label class="wide">Country
          <input name="country" list="countryOptions" autocomplete="country" placeholder="Search country, ISO code, or dialing prefix" required>
        </label>
        <label class="wide">Mobile number
          <input name="mobileNumber" autocomplete="tel-national" inputmode="tel" placeholder="9876543210" required>
          <span class="hint">Enter the national number without the country code. We will convert it to E.164.</span>
        </label>
        <label>Password (8 characters minimum)<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
        <label>Confirm password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></label>
      </div>
      <div class="toggle"><input id="terms" name="acceptedTerms" type="checkbox" required><label for="terms">I agree to the Terms of Service and Privacy Policy.</label></div>
      <div class="toggle"><input id="marketing" name="marketingConsent" type="checkbox"><label for="marketing">Email me product updates (optional).</label></div>
      <div class="actions"><button type="submit">Create account</button></div>
    </form>
  </section>

  <section data-panel="verify" hidden>
    <h1>Verify your email</h1><p>Use the secure verification link sent to your email, or enter the token below.</p>
    <form id="verify"><label>Verification token<input name="token" autocomplete="off" required></label><div class="actions"><button type="submit">Verify email</button></div></form>
    <form id="resend"><label>Email<input name="email" type="email" autocomplete="email" required></label><div class="actions"><button type="submit" class="secondary">Resend verification</button></div></form>
  </section>

  <section data-panel="forgot" hidden>
    <h1>Reset your password</h1><p>If your email is registered, you will receive reset instructions.</p>
    <form id="forgot"><label>Email<input name="email" type="email" autocomplete="email" required></label><div class="actions"><button type="submit">Send reset link</button></div></form>
  </section>

  <section data-panel="reset" hidden>
    <h1>Choose a new password</h1>
    <form id="reset"><label>Reset token<input name="token" required autocomplete="off"></label>
      <label>New password<input name="newPassword" type="password" minlength="8" required autocomplete="new-password"></label>
      <label>Confirm password<input name="confirmPassword" type="password" minlength="8" required autocomplete="new-password"></label>
      <div class="actions"><button type="submit">Change password</button></div>
    </form>
  </section>

  <section data-panel="profile" hidden>
    <h1>Account profile</h1>
    <form id="profile">
      <label>Full name<input name="fullName" maxlength="200" required></label>
      <label>Email (verified; read-only)<input name="email" type="email" readonly></label>
      <label>Country<input name="country" list="countryOptions" autocomplete="country" placeholder="Search country, ISO code, or dialing prefix" required></label>
      <label>Mobile number<input name="mobileNumber" autocomplete="tel-national" inputmode="tel" required><span class="hint">National number; the country selector supplies the dialing prefix.</span></label>
      <div class="toggle"><input id="profileMarketing" type="checkbox" name="marketingConsent"><label for="profileMarketing">Email me product updates</label></div>
      <div class="actions"><button type="submit">Save changes</button><button type="button" id="logout" class="secondary">Sign out</button></div>
    </form>
  </section>
  <section data-panel="preferences" hidden>
    <h1>Account and meeting settings</h1>
    <p>Choose defaults for new meetings and the in-app updates you receive.</p>
    <form id="preferences">
      <label>Time zone<input name="timeZone" maxlength="100" required placeholder="e.g. Europe/London"></label>
      <label>Default meeting duration
        <select name="defaultDurationMinutes"><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">1 hour 30 minutes</option><option value="120">2 hours</option></select>
      </label>
      <label>Default guest access
        <select name="defaultGuestAccess"><option value="HOST_APPROVAL">Host approval</option><option value="OPEN">Open access</option><option value="LOCKED">Locked</option></select>
      </label>
      <div class="toggle"><input id="notifyMeetingEvents" name="notifyMeetingEvents" type="checkbox"><label for="notifyMeetingEvents">In-app updates for meeting schedule changes</label></div>
      <div class="toggle"><input id="notifyInvitationEvents" name="notifyInvitationEvents" type="checkbox"><label for="notifyInvitationEvents">In-app updates when invitees respond</label></div>
      <p class="hint" id="entitlementSummary">Plan access is loading…</p>
      <div class="actions"><button type="submit">Save settings</button></div>
    </form>
    <a class="back" href="/notifications">View notifications</a>
  </section>
  <a class="back" href="/">← Back to meetings</a>
  </div>
</main>
<script>
(function(){
  'use strict';
  const panels = [...document.querySelectorAll('[data-panel]')];
  const navigationButtons = [...document.querySelectorAll('nav [data-page]')];
  const status = document.getElementById('status');
  const countryDialingCodes = ${JSON.stringify(dialingCodes)};
  const countries = ${JSON.stringify(countryMetadata)};
  function message(value, isError = false) {
    status.textContent = value || '';
    status.classList.toggle('error', Boolean(value && isError));
  }
  function view(page) {
    if (!panels.some((panel) => panel.dataset.panel === page)) page = 'login';
    panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== page; });
    const activePage = ['login', 'register', 'profile', 'preferences'].includes(page) ? page : null;
    document.querySelector('main').dataset.page = page;
    navigationButtons.forEach((button) => {
      if (button.dataset.page === activePage) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    history.replaceState(null, '', '#' + page);
    message('');
    if (page === 'profile') void loadProfile();
    if (page === 'preferences') void loadPreferences();
  }
  function toE164(country, nationalNumber) {
    const digits = String(nationalNumber || '').replace(/\\D/gu, '').replace(/^0+/u, '');
    const prefix = countryDialingCodes[country];
    if (!prefix || digits.length < 4 || digits.length > 14 - String(prefix).length) throw Error('Enter a valid national mobile number for the selected country.');
    return '+' + prefix + digits;
  }
  function selectedCountry(value) {
    const normalized = String(value || '').trim().toLowerCase();
    const country = countries.find((entry) => entry.label.toLowerCase() === normalized || entry.code.toLowerCase() === normalized);
    if (!country) throw Error('Select a country from the searchable country list.');
    return country;
  }
  function countryLabel(code) {
    return countries.find((entry) => entry.code === code)?.label || code;
  }
  function toNationalNumber(country, e164) {
    const prefix = '+' + (countryDialingCodes[country] || '');
    return String(e164 || '').startsWith(prefix) ? String(e164).slice(prefix.length) : String(e164 || '').replace(/^\\+/u, '');
  }
  async function api(path, method, body) {
    const response = await fetch('/api/accounts/' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let payload;
    try { payload = await response.json(); } catch { throw Error('Unable to complete this request. Please try again.'); }
    if (!response.ok || !payload.ok) throw Error(payload.error || 'Unable to complete this request. Please try again.');
    return payload.data;
  }
  async function submit(id, path, method, build, onSuccess) {
    document.getElementById(id).addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type=submit]');
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form));
      try {
        button.disabled = true;
        message('');
        const data = await api(path, method, build ? build(values, form) : values);
        await onSuccess(data, values);
      } catch (error) {
        message(error instanceof Error ? error.message : 'Unable to complete this request. Please try again.', true);
      } finally {
        button.disabled = false;
      }
    });
  }
  function matching(values, key, other) {
    if (values[key] !== values[other]) throw Error(key === 'email' ? 'Email addresses do not match.' : 'Passwords do not match.');
    return values;
  }
  submit('login', 'login', 'POST', (values) => ({ email: values.email, password: values.password }), async () => { location.href = '/dashboard'; });
  submit('register', 'register', 'POST', (values, form) => {
    matching(values, 'email', 'emailConfirm');
    const country = selectedCountry(values.country);
    return {
      fullName: values.fullName,
      email: values.email,
      country: country.code,
      mobileNumber: toE164(country.code, values.mobileNumber),
      password: matching(values, 'password', 'confirmPassword').password,
      acceptedTerms: form.elements.acceptedTerms.checked,
      marketingConsent: form.elements.marketingConsent.checked,
    };
  }, async () => { view('verify'); message('Account created. Check your email to verify your address.'); });
  submit('verify', 'verify-email', 'POST', (values) => ({ token: values.token }), async () => { view('login'); message('Email verified. You can now sign in.'); });
  submit('resend', 'resend-verification', 'POST', (values) => ({ email: values.email }), async () => message('If an unverified account matches, a new verification email will be sent.'));
  submit('forgot', 'forgot-password', 'POST', (values) => ({ email: values.email }), async () => message('If an active account matches, reset instructions will be sent.'));
  submit('reset', 'reset-password', 'POST', (values) => ({ token: values.token, newPassword: matching(values, 'newPassword', 'confirmPassword').newPassword }), async () => { view('login'); message('Password changed. Sign in with your new password.'); });
  submit('profile', 'me', 'PATCH', (values, form) => {
    const country = selectedCountry(values.country);
    return { fullName: values.fullName, country: country.code, mobileNumber: toE164(country.code, values.mobileNumber), marketingConsent: form.elements.marketingConsent.checked };
  }, async () => message('Profile updated.'));
  document.getElementById('preferences').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    try {
      const response = await fetch('/api/preferences', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeZone: values.get('timeZone'),
          defaultDurationMinutes: Number(values.get('defaultDurationMinutes')),
          defaultGuestAccess: values.get('defaultGuestAccess'),
          notifyMeetingEvents: form.elements.notifyMeetingEvents.checked,
          notifyInvitationEvents: form.elements.notifyInvitationEvents.checked,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw Error(payload.error || 'Unable to save settings.');
      message('Settings saved.');
    } catch (error) {
      message(error instanceof Error ? error.message : 'Unable to save settings.', true);
    }
  });
  async function loadPreferences() {
    try {
      const response = await fetch('/api/preferences', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (response.status === 401) throw Error('Sign in to access your settings.');
      if (!response.ok || !payload.ok) throw Error(payload.error || 'Unable to load settings.');
      const form = document.getElementById('preferences');
      const settings = payload.data.preferences;
      form.elements.timeZone.value = settings.timeZone;
      form.elements.defaultDurationMinutes.value = String(settings.defaultDurationMinutes);
      form.elements.defaultGuestAccess.value = settings.defaultGuestAccess;
      form.elements.notifyMeetingEvents.checked = settings.notifyMeetingEvents;
      form.elements.notifyInvitationEvents.checked = settings.notifyInvitationEvents;
      document.getElementById('entitlementSummary').textContent =
        'Current access: ' + payload.data.entitlement.planCode + ' (' + payload.data.entitlement.status.toLowerCase() + '). Existing features remain available; plan-based restrictions are not enabled.';
    } catch (error) {
      message(error instanceof Error ? error.message : 'Unable to load settings.', true);
    }
  }
  async function loadProfile() {
    try {
      const data = await api('me', 'GET');
      const form = document.getElementById('profile');
      form.elements.fullName.value = data.account.fullName || '';
      form.elements.email.value = data.account.email || '';
      form.elements.country.value = countryLabel(data.account.countryCode);
      form.elements.mobileNumber.value = toNationalNumber(data.account.countryCode, data.account.mobileNumber);
      form.elements.marketingConsent.checked = Boolean(data.account.marketingConsent);
    } catch {
      view('login');
      message('Sign in to access your profile.', true);
    }
  }
  document.querySelectorAll('[data-page]').forEach((element) => element.addEventListener('click', () => view(element.dataset.page)));
  document.querySelectorAll('[data-show]').forEach((element) => element.addEventListener('click', () => {
    const input = element.parentElement.querySelector('input');
    input.type = input.type === 'password' ? 'text' : 'password';
    element.textContent = input.type === 'password' ? 'Show' : 'Hide';
  }));
  document.getElementById('logout').addEventListener('click', async () => {
    try { await api('logout', 'POST', {}); view('login'); message('You have been signed out.'); } catch (error) { message(error instanceof Error ? error.message : 'Unable to sign out. Please try again.', true); }
  });
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  if (token) {
    const reset = params.get('flow') === 'reset';
    view(reset ? 'reset' : 'verify');
    document.querySelector('#' + (reset ? 'reset' : 'verify') + ' [name=token]').value = token;
    history.replaceState(null, '', location.pathname + '#' + (reset ? 'reset' : 'verify'));
  } else {
    view(location.hash.slice(1) || 'login');
  }
})();
</script>
</body>
</html>`;
}
