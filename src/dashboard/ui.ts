export function dashboardPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard · BillionTalks</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #071529; color: #edf5ff; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 80% 0%, #17365b 0, transparent 38rem), #071529; }
    a, button { font: inherit; }
    a { color: inherit; text-decoration: none; }
    .shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 56px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
    .brand { font-weight: 850; letter-spacing: .02em; font-size: 21px; }
    .brand span { color: #56a8ff; }
    nav { display: flex; align-items: center; gap: 10px; }
    nav a, .ghost { color: #b9cbe2; padding: 9px 12px; border-radius: 10px; }
    nav a:hover, nav a:focus-visible, .ghost:hover, .ghost:focus-visible { color: #fff; background: #183457; }
    .hero { display: grid; grid-template-columns: 1.35fr .65fr; gap: 24px; align-items: end; padding: 72px 0 42px; }
    h1 { margin: 0; max-width: 720px; font-size: clamp(36px, 6vw, 68px); line-height: .98; letter-spacing: -.045em; }
    .eyebrow { color: #70b7ff; font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
    .lede { color: #a8bad2; font-size: 17px; line-height: 1.6; max-width: 620px; }
    .identity { justify-self: end; width: min(100%, 300px); padding: 20px; border: 1px solid #234267; border-radius: 18px; background: rgba(17, 39, 70, .7); }
    .identity strong { display: block; font-size: 18px; margin-bottom: 5px; }
    .identity span { color: #a8bad2; overflow-wrap: anywhere; }
    .actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    .card { padding: 24px; border: 1px solid #234267; border-radius: 18px; background: linear-gradient(150deg, rgba(18, 47, 82, .95), rgba(10, 28, 52, .92)); box-shadow: 0 18px 45px rgba(0, 0, 0, .14); }
    .card h2 { margin: 0 0 8px; font-size: 22px; }
    .card p { margin: 0 0 18px; color: #a8bad2; line-height: 1.5; }
    label { display: block; color: #c9d8e9; font-size: 13px; font-weight: 700; margin: 14px 0 7px; }
    input, select { width: 100%; border: 1px solid #355577; border-radius: 10px; background: #091c35; color: #edf5ff; padding: 12px 13px; }
    input:focus, select:focus { outline: 2px solid #56a8ff; outline-offset: 2px; }
    button, .primary { border: 0; border-radius: 10px; padding: 12px 16px; color: #071529; background: #56a8ff; font-weight: 800; cursor: pointer; }
    button:hover, button:focus-visible, .primary:hover, .primary:focus-visible { background: #82c3ff; }
    .card button { margin-top: 17px; }
    .history { margin-top: 30px; }
    .history-head { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
    .history h2 { margin: 0; font-size: 27px; }
    .history-note { color: #8fa8c3; font-size: 13px; }
    .history-list { display: grid; gap: 10px; }
    .meeting { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 17px 19px; border: 1px solid #203e61; border-radius: 14px; background: rgba(12, 31, 56, .75); }
    .meeting strong { display: block; margin-bottom: 5px; }
    .meeting small { color: #91a8c2; }
    .meeting a { color: #82c3ff; font-size: 13px; font-weight: 800; white-space: nowrap; }
    .status { color: #76bdff; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; white-space: nowrap; }
    .empty, #error { color: #a8bad2; padding: 18px 0; }
    #error { color: #ffb3b3; min-height: 24px; }
    @media (max-width: 760px) {
      .shell { width: min(100% - 22px, 600px); padding-top: 18px; }
      header, .hero, .history-head { align-items: flex-start; }
      header, .hero { display: flex; flex-direction: column; }
      nav { width: 100%; justify-content: space-between; }
      .hero { padding: 52px 0 28px; }
      .identity { width: 100%; }
      .actions { grid-template-columns: 1fr; }
      .meeting { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <a class="brand" href="/dashboard">Billion<span>Talks</span></a>
      <nav aria-label="Dashboard navigation">
        <a href="/account#profile">Account</a>
        <button class="ghost" id="logoutButton" type="button">Sign out</button>
      </nav>
    </header>
    <section class="hero" aria-labelledby="dashboardTitle">
      <div>
        <div class="eyebrow">Your meeting workspace</div>
        <h1 id="dashboardTitle">Make every conversation count.</h1>
        <p class="lede">Start a private room, join a conversation, and find your recent meetings in one focused workspace.</p>
      </div>
      <div class="identity" aria-live="polite">
        <strong id="identityName">Loading your account...</strong>
        <span id="identityEmail"></span>
      </div>
    </section>
    <div id="error" role="alert"></div>
    <section class="actions" aria-label="Meeting actions">
      <form class="card" id="startMeetingForm">
        <h2>Start a meeting</h2>
        <p>Create a private room and invite guests with its meeting ID.</p>
        <label for="meetingTitle">Meeting title</label>
        <input id="meetingTitle" name="title" required maxlength="120" placeholder="Project kickoff">
        <label for="accessMode">Guest access</label>
        <select id="accessMode" name="accessMode">
          <option value="HOST_APPROVAL">Approve guests</option>
          <option value="OPEN">Anyone with the ID</option>
          <option value="LOCKED">Lock the room</option>
        </select>
        <button class="primary" type="submit">Start meeting</button>
      </form>
      <form class="card" id="joinMeetingForm">
        <h2>Join a meeting</h2>
        <p>Use a meeting ID shared by your host. Guest joining remains available without an account.</p>
        <label for="meetingId">Meeting ID</label>
        <input id="meetingId" name="meetingId" required pattern="btm_[A-Za-z0-9_-]{8,64}" placeholder="btm_...">
        <button class="primary" type="submit">Join meeting</button>
      </form>
    </section>
    <section class="history" aria-labelledby="historyTitle">
      <div class="history-head">
        <div>
          <h2 id="historyTitle">Recent meetings</h2>
          <div class="history-note">Private to your signed-in account</div>
        </div>
      </div>
      <div class="history-list" id="historyList"><div class="empty">Loading your meeting history...</div></div>
    </section>
  </main>
  <script>
    (() => {
      'use strict';
      const error = document.getElementById('error');
      const historyList = document.getElementById('historyList');
      const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
      const showError = (value) => { error.textContent = value || ''; };
      async function api(path, options) {
        const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options && options.headers || {}) } });
        let payload;
        try { payload = await response.json(); } catch { throw new Error('The dashboard could not read the server response.'); }
        if (response.status === 401) { window.location.href = '/account#login'; throw new Error('Authentication required.'); }
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to complete this request.');
        return payload.data;
      }
      function renderHistory(entries) {
        if (!entries.length) { historyList.innerHTML = '<div class="empty">No meetings yet. Start your first room above.</div>'; return; }
        historyList.innerHTML = entries.map((entry) => '<article class="meeting"><div><strong>' + escapeHtml(entry.title) + '</strong><small>' + escapeHtml(new Date(entry.createdAt).toLocaleString()) + ' · ' + escapeHtml(entry.meetingId) + '</small></div><a href="/?meeting=' + encodeURIComponent(entry.meetingId) + '">Open room</a><span class="status">' + escapeHtml(entry.status) + '</span></article>').join('');
      }
      document.getElementById('startMeetingForm').addEventListener('submit', async (event) => {
        event.preventDefault(); showError('');
        const form = event.currentTarget;
        try {
          const data = await api('/api/meetings', { method: 'POST', body: JSON.stringify({ title: form.title.value.trim(), accessMode: form.accessMode.value }) });
          window.location.href = '/?meeting=' + encodeURIComponent(data.id);
        } catch (failure) { showError(failure instanceof Error ? failure.message : 'Unable to start the meeting.'); }
      });
      document.getElementById('joinMeetingForm').addEventListener('submit', (event) => {
        event.preventDefault(); const meetingId = event.currentTarget.meetingId.value.trim();
        if (event.currentTarget.reportValidity()) window.location.href = '/?meeting=' + encodeURIComponent(meetingId);
      });
      document.getElementById('logoutButton').addEventListener('click', async () => {
        try { await api('/api/accounts/logout', { method: 'POST', body: '{}' }); window.location.href = '/account#login'; }
        catch (failure) { showError(failure instanceof Error ? failure.message : 'Unable to sign out.'); }
      });
      (async () => {
        try {
          const account = await api('/api/accounts/me');
          document.getElementById('identityName').textContent = account.account.fullName;
          document.getElementById('identityEmail').textContent = account.account.email;
          renderHistory(await api('/api/meetings/history'));
        } catch (failure) { showError(failure instanceof Error ? failure.message : 'Unable to load your dashboard.'); }
      })();
    })();
  </script>
</body>
</html>`;
}
