export function dashboardPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard · BillionTalks</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f4f7fb; color: #152541; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #f4f7fb; }
    a, button { font: inherit; }
    a { color: inherit; text-decoration: none; }
    .shell { display: grid; grid-template-columns: 238px minmax(0, 1fr); gap: 0; width: min(1280px, calc(100% - 32px)); min-height: calc(100vh - 40px); margin: 20px auto; background: #fff; border: 1px solid #dce5f1; border-radius: 24px; overflow: hidden; box-shadow: 0 22px 70px #213b6412; }
    .sidebar { padding: 28px 16px; background: #fbfdff; border-right: 1px solid #e3eaf3; }
    .brand { display: block; padding: 0 14px 32px; font-weight: 850; letter-spacing: -.03em; font-size: 23px; color: #1266d2; }
    .brand span { color: #45a7f7; }
    .sidebar-label { padding: 0 14px 10px; color: #8292a9; font-size: 11px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
    .sidebar nav { display: grid; gap: 5px; }
    .sidebar nav a, .sidebar .coming-soon { display: block; padding: 11px 14px; border-radius: 10px; color: #61738e; font-size: 14px; font-weight: 700; }
    .sidebar nav a:hover, .sidebar nav a:focus-visible, .sidebar nav a.active { color: #1266d2; background: #eaf3ff; }
    .sidebar .coming-soon { cursor: default; opacity: .55; }
    .dashboard-main { min-width: 0; padding: 24px clamp(20px, 4vw, 46px) 48px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding-bottom: 18px; border-bottom: 1px solid #edf1f6; }
    header nav { display: flex; align-items: center; gap: 10px; }
    header nav a, .ghost { color: #49627f; padding: 9px 12px; border-radius: 10px; }
    header nav a:hover, header nav a:focus-visible, .ghost:hover, .ghost:focus-visible { color: #1266d2; background: #edf5ff; }
    .sidebar-toggle { display: none; border: 0; background: transparent; color: #355577; font-size: 22px; cursor: pointer; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .hero { display: grid; grid-template-columns: 1.35fr .65fr; gap: 24px; align-items: end; padding: 52px 0 34px; }
    h1 { margin: 0; max-width: 720px; font-size: clamp(34px, 5vw, 58px); line-height: 1; letter-spacing: -.045em; color: #152541; }
    .eyebrow { color: #1974d2; font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
    .lede { color: #667995; font-size: 17px; line-height: 1.6; max-width: 620px; }
    .identity { justify-self: end; width: min(100%, 300px); padding: 20px; border: 1px solid #dce7f4; border-radius: 18px; background: linear-gradient(145deg, #f5faff, #edf6ff); }
    .identity strong { display: block; font-size: 18px; margin-bottom: 5px; }
    .identity span { color: #667995; overflow-wrap: anywhere; }
    .actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    .card { padding: 24px; border: 1px solid #dce7f4; border-radius: 18px; background: #fff; box-shadow: 0 12px 32px #29456a0b; }
    .card h2 { margin: 0 0 8px; font-size: 22px; color: #1d3150; }
    .card p { margin: 0 0 18px; color: #71829a; line-height: 1.5; }
    .start-card button { background: #287fe0; }
    .join-card button { background: #1a9a6c; }
    .join-card button:hover, .join-card button:focus-visible { background: #147c55; }
    .quick-link { display: inline-block; margin-top: 17px; }
    .quick-card .quick-link { background: #7657cf; }
    .quick-card .quick-link:hover, .quick-card .quick-link:focus-visible { background: #6041b5; }
    label { display: block; color: #31435f; font-size: 13px; font-weight: 700; margin: 14px 0 7px; }
    input, select { width: 100%; border: 1px solid #cbd7e6; border-radius: 10px; background: #fff; color: #16233b; padding: 12px 13px; }
    input:focus, select:focus { outline: 2px solid #318aff55; outline-offset: 2px; border-color: #318aff; }
    button, .primary { border: 0; border-radius: 10px; padding: 12px 16px; color: #fff; background: #287fe0; font-weight: 800; cursor: pointer; }
    button:hover, button:focus-visible, .primary:hover, .primary:focus-visible { background: #1769c5; }
    .card button { margin-top: 17px; }
    .history { margin-top: 30px; }
    .history-head { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
    .history h2 { margin: 0; font-size: 27px; color: #1d3150; }
    .history-note { color: #8292a9; font-size: 13px; }
    .history-list { display: grid; gap: 10px; }
    .meeting { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 17px 19px; border: 1px solid #e0e8f2; border-radius: 14px; background: #fff; }
    .meeting strong { display: block; margin-bottom: 5px; }
    .meeting small { color: #8292a9; }
    .meeting a { color: #1974d2; font-size: 13px; font-weight: 800; white-space: nowrap; }
    .status { color: #167b58; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; white-space: nowrap; }
    .empty, #error { color: #71829a; padding: 18px 0; }
    #error { color: #a52e4b; min-height: 24px; }
    @media (max-width: 760px) {
      .shell { display: block; width: min(100% - 22px, 640px); min-height: 100vh; margin: 0 auto; border: 0; border-radius: 0; }
      .sidebar { display: none; border-right: 0; border-bottom: 1px solid #e3eaf3; }
      .sidebar.open { display: block; }
      .sidebar-toggle { display: inline-block; }
      .dashboard-main { padding-top: 16px; }
      header, .hero, .history-head { align-items: flex-start; }
      header { align-items: center; }
      .hero { display: flex; flex-direction: column; }
      header nav { width: auto; justify-content: space-between; }
      .hero { padding: 52px 0 28px; }
      .identity { width: 100%; }
      .actions { grid-template-columns: 1fr; }
      .meeting { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand">Billion<span>Talks</span></div>
      <div class="sidebar-label">Workspace</div>
      <nav aria-label="Workspace navigation">
        <a class="active" href="/dashboard" aria-current="page">Dashboard</a>
        <a href="#historyTitle">Meetings</a>
        <a href="/account#profile">Account</a>
      </nav>
      <div class="sidebar-label" style="margin-top: 28px;">Coming soon</div>
      <div class="coming-soon">Calendar</div>
      <div class="coming-soon">Contacts</div>
      <div class="coming-soon">Recordings</div>
    </aside>
    <div class="dashboard-main">
    <button class="sidebar-toggle" id="sidebarToggle" type="button" aria-controls="sidebar" aria-expanded="false">☰ <span class="sr-only">Open navigation</span></button>
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
      <form class="card start-card" id="startMeetingForm">
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
      <form class="card join-card" id="joinMeetingForm">
        <h2>Join a meeting</h2>
        <p>Use a meeting ID shared by your host. Guest joining remains available without an account.</p>
        <label for="meetingId">Meeting ID</label>
        <input id="meetingId" name="meetingId" required pattern="btm_[A-Za-z0-9_-]{8,64}" placeholder="btm_...">
        <button class="primary" type="submit">Join meeting</button>
      </form>
      <div class="card quick-card">
        <h2>Quick actions</h2>
        <p>Update your identity, country, mobile number, and communication preferences.</p>
        <a class="primary quick-link" href="/account#profile">Open profile</a>
      </div>
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
    </div>
  </main>
  <script>
    (() => {
      'use strict';
      const error = document.getElementById('error');
      const historyList = document.getElementById('historyList');
      const sidebar = document.getElementById('sidebar');
      document.getElementById('sidebarToggle').addEventListener('click', () => {
        const open = sidebar.classList.toggle('open');
        document.getElementById('sidebarToggle').setAttribute('aria-expanded', String(open));
      });
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
