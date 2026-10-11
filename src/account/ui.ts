import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js/min";

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
    :root { color-scheme: dark; font-family: Inter, system-ui, "Segoe UI", sans-serif; background: #081327; color: #f8fbff; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(ellipse at 15% 0%, #12356b 0%, #081327 50%); display: grid; place-items: center; padding: 24px; }
    main { width: min(100%, 640px); background: #101f38; border: 1px solid #25416a; border-radius: 22px; padding: clamp(24px, 5vw, 44px); box-shadow: 0 20px 80px #02071380; }
    a { color: #78bcff; }
    h1 { font-size: 28px; margin: 18px 0 8px; }
    p { color: #bac9df; line-height: 1.5; }
    label { display: block; font-weight: 600; font-size: 13px; margin: 14px 0 7px; }
    input, select { width: 100%; min-height: 46px; border: 1px solid #3a5478; border-radius: 11px; background: #09182d; color: white; padding: 11px 13px; font: inherit; }
    input:focus, select:focus { outline: 3px solid #318aff55; border-color: #78bcff; }
    input[aria-invalid="true"], select[aria-invalid="true"] { border-color: #ff7f93; }
    input[type=checkbox] { width: auto; min-height: 0; accent-color: #318aff; }
    button { background: #398bff; color: #fff; border: 0; border-radius: 11px; padding: 12px 18px; font: inherit; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: .6; cursor: wait; }
    button.secondary { background: #223c64; }
    nav { display: flex; flex-wrap: wrap; gap: 9px; margin: 22px 0; }
    nav button { font-size: 12px; padding: 9px 12px; }
    nav button[aria-current="page"] { background: #398bff; }
    .brand { font-weight: 800; letter-spacing: .02em; font-size: 20px; }
    .brand span { color: #56a8ff; }
    section[hidden], div[hidden] { display: none !important; }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 14px; }
    .form-grid > label, .form-grid > .toggle, .form-grid > .actions { min-width: 0; }
    .wide { grid-column: 1 / -1; }
    .hint { display: block; margin-top: 6px; color: #9ab0cc; font-size: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
    .toggle { display: flex; align-items: flex-start; gap: 9px; margin-top: 12px; }
    .toggle label { margin: 0; }
    .status { margin-top: 18px; padding: 12px; border-radius: 10px; background: #182b48; white-space: pre-line; }
    .status:empty { display: none; }
    .status.error { color: #ffd7dd; background: #4b1f32; }
    a.back { display: inline-block; margin-top: 18px; }
    .password { display: flex; gap: 8px; }
    .password input { flex: 1; min-width: 0; }
    .password button { background: #27456e; }
    @media (max-width: 560px) {
      body { padding: 12px; }
      main { padding: 22px 18px; border-radius: 16px; }
      .form-grid { grid-template-columns: 1fr; }
      .wide { grid-column: auto; }
      .actions button { flex: 1 1 100%; }
    }
  </style>
</head>
<body>
<main>
  <div class="brand">Billion<span>Talks</span></div>
  <nav aria-label="Account navigation">
    <button data-page="login" class="secondary">Sign in</button>
    <button data-page="register" class="secondary">Create account</button>
    <button data-page="profile" class="secondary">Profile</button>
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
  <a class="back" href="/">← Back to meetings</a>
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
    const activePage = ['login', 'register', 'profile'].includes(page) ? page : null;
    navigationButtons.forEach((button) => {
      if (button.dataset.page === activePage) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    history.replaceState(null, '', '#' + page);
    message('');
    if (page === 'profile') void loadProfile();
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
  submit('login', 'login', 'POST', (values) => ({ email: values.email, password: values.password }), async () => { view('profile'); message('Signed in successfully.'); });
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
