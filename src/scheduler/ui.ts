import logoSource from "../assets/brand/billiontalks-logo.png";

function logoDataUrl(source: string | ArrayBuffer): string {
  if (typeof source === "string") return source;
  const bytes = new Uint8Array(source);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

export function schedulerPreviewPage(): string {
  const logoUrl = logoDataUrl(logoSource);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Schedule Meeting · BillionTalks</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f4f7fc;
      color: #17233c;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; min-height: 100vh; background: linear-gradient(135deg, #f7faff 0%, #edf3fb 100%); }
    a, button, input, select, textarea { font: inherit; }
    a { color: inherit; text-decoration: none; }
    button { cursor: pointer; }
    button:disabled { cursor: not-allowed; }
    .app-shell { display: grid; grid-template-columns: 224px minmax(0, 1fr); min-height: 100vh; }
    .sidebar {
      position: sticky;
      top: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
      padding: 25px 15px 20px;
      overflow: hidden;
      background: linear-gradient(155deg, #071d49 0%, #0b3d88 58%, #176fd2 100%);
      border-right: 1px solid #153f79;
      box-shadow: 12px 0 34px rgba(7, 29, 73, .14);
    }
    .sidebar::before {
      content: "";
      position: absolute;
      width: 270px;
      height: 270px;
      right: -178px;
      bottom: -102px;
      border: 1px solid rgba(255, 255, 255, .18);
      border-radius: 50%;
      box-shadow: 0 0 0 30px rgba(255, 255, 255, .045), 0 0 0 66px rgba(255, 255, 255, .025);
    }
    .sidebar::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(120deg, transparent 15%, rgba(85, 185, 255, .08) 48%, transparent 72%);
    }
    .sidebar > * { position: relative; z-index: 1; }
    .logo-link {
      display: inline-flex;
      align-items: center;
      width: 172px;
      max-width: 100%;
      margin: 0 6px 35px;
      padding: 8px 10px;
      border: 1px solid rgba(255, 255, 255, .22);
      border-radius: 12px;
      background: #f9fbff;
      box-shadow: 0 12px 28px rgba(3, 21, 54, .3);
    }
    .logo-link img { display: block; width: 100%; height: auto; }
    .nav-label { margin: 0 12px 10px; color: #9fc6f2; font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    .side-nav { display: grid; gap: 7px; }
    .nav-item, .sign-out {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      min-height: 43px;
      padding: 10px 13px;
      border: 0;
      border-radius: 11px;
      background: transparent;
      color: #dbeafe;
      font-size: 13px;
      font-weight: 700;
      text-align: left;
    }
    .nav-item svg, .sign-out svg { width: 18px; height: 18px; flex: 0 0 auto; }
    .nav-item.active {
      color: #fff;
      background: linear-gradient(135deg, #176fd2, #318ff0);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .16), 0 9px 20px rgba(3, 21, 54, .27);
    }
    .nav-item:not(.disabled):hover, .nav-item:not(.disabled):focus-visible, .sign-out:hover, .sign-out:focus-visible {
      color: #fff;
      background: rgba(255, 255, 255, .11);
      outline: none;
    }
    .nav-item.disabled { cursor: default; color: #b8d1ee; }
    .soon-badge {
      margin-left: auto;
      padding: 3px 6px;
      border-radius: 999px;
      color: #d8eaff;
      background: rgba(255, 255, 255, .12);
      font-size: 8px;
      font-weight: 800;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .sidebar-footer { margin-top: auto; padding-top: 22px; border-top: 1px solid rgba(255, 255, 255, .16); }
    .main-column { min-width: 0; }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 22px;
      min-height: 79px;
      padding: 14px clamp(22px, 3.2vw, 48px);
      background: rgba(255, 255, 255, .9);
      border-bottom: 1px solid #dfe7f1;
      box-shadow: 0 5px 20px rgba(31, 61, 105, .035);
      backdrop-filter: blur(16px);
    }
    .mobile-brand { display: none; }
    .breadcrumbs { display: flex; align-items: center; gap: 9px; color: #8492a7; font-size: 12px; font-weight: 700; }
    .breadcrumbs a { color: #2879eb; }
    .breadcrumbs svg { width: 14px; height: 14px; }
    .preview-account { display: flex; align-items: center; gap: 11px; }
    .avatar {
      display: grid;
      place-items: center;
      width: 41px;
      height: 41px;
      border-radius: 12px;
      background: linear-gradient(135deg, #357ff0, #72a9ff);
      color: #fff;
      font-size: 13px;
      font-weight: 850;
      box-shadow: 0 8px 18px rgba(49, 119, 232, .22);
    }
    .account-copy strong, .account-copy span { display: block; }
    .account-copy strong { color: #25334b; font-size: 13px; }
    .account-copy span { margin-top: 3px; color: #8a98ab; font-size: 10px; }
    .workspace { width: min(100%, 1290px); margin: 0 auto; padding: 33px clamp(22px, 3.2vw, 48px) 48px; }
    .page-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 22px; }
    .eyebrow { margin: 0 0 8px; color: #2879eb; font-size: 10px; font-weight: 850; letter-spacing: .13em; text-transform: uppercase; }
    h1 { margin: 0; color: #17233c; font-size: clamp(28px, 3vw, 38px); line-height: 1.15; letter-spacing: -.035em; }
    .page-heading p { max-width: 650px; margin: 10px 0 0; color: #77869b; font-size: 14px; line-height: 1.65; }
    .preview-badge {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid #ddd5fb;
      border-radius: 999px;
      background: #f6f2ff;
      color: #7154c5;
      font-size: 10px;
      font-weight: 850;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .preview-badge::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #8b6de1; box-shadow: 0 0 0 4px rgba(139, 109, 225, .12); }
    .notice {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 22px;
      padding: 13px 15px;
      border: 1px solid #d8e5f8;
      border-radius: 13px;
      background: #f4f8ff;
      color: #526985;
      font-size: 12px;
      line-height: 1.5;
    }
    .notice svg { width: 18px; height: 18px; flex: 0 0 auto; color: #2d7be8; }
    .layout { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(290px, .72fr); gap: 24px; align-items: start; }
    .card {
      min-width: 0;
      border: 1px solid #dfe7f2;
      border-radius: 18px;
      background: #fff;
      box-shadow: 0 14px 32px rgba(43, 69, 108, .075), 0 2px 6px rgba(30, 58, 98, .035);
    }
    .form-card { overflow: hidden; }
    .card-heading {
      display: flex;
      align-items: center;
      gap: 13px;
      padding: 21px 23px;
      border-bottom: 1px solid #e7edf5;
      background: linear-gradient(180deg, #fff, #fbfcff);
    }
    .heading-icon {
      display: grid;
      place-items: center;
      width: 41px;
      height: 41px;
      flex: 0 0 auto;
      border-radius: 12px;
      color: #fff;
      background: linear-gradient(135deg, #7352d1, #936fea);
      box-shadow: 0 9px 20px rgba(115, 82, 209, .2);
    }
    .heading-icon svg { width: 20px; height: 20px; }
    .card-heading h2, .summary h2 { margin: 0; color: #26354e; font-size: 16px; }
    .card-heading p { margin: 5px 0 0; color: #8795a8; font-size: 11px; }
    .form-body { padding: 24px; }
    .form-section + .form-section { margin-top: 24px; padding-top: 24px; border-top: 1px solid #edf1f6; }
    .section-title { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 17px; }
    .section-title strong { color: #34445d; font-size: 12px; }
    .section-title span { color: #9aa6b7; font-size: 10px; }
    .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 17px; }
    .field { display: grid; gap: 7px; min-width: 0; }
    .field.full { grid-column: 1 / -1; }
    .field label { color: #45556d; font-size: 11px; font-weight: 780; }
    .required { color: #7557cd; }
    input, select, textarea {
      width: 100%;
      border: 1px solid #dce4ef;
      border-radius: 10px;
      background: #fbfcff;
      color: #23324a;
      outline: none;
      transition: border-color .15s, box-shadow .15s, background .15s;
    }
    input, select { height: 44px; padding: 0 12px; }
    textarea { min-height: 92px; padding: 11px 12px; resize: vertical; }
    input::placeholder, textarea::placeholder { color: #abb5c3; }
    input:focus, select:focus, textarea:focus { border-color: #83adf1; background: #fff; box-shadow: 0 0 0 3px rgba(49, 128, 240, .1); }
    .field-help { color: #98a5b6; font-size: 10px; line-height: 1.45; }
    .access-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .access-option {
      min-width: 0;
      padding: 13px;
      border: 1px solid #dfe6f0;
      border-radius: 11px;
      background: #fbfcff;
    }
    .access-option.selected { border-color: #88aff0; background: #f2f7ff; box-shadow: inset 0 0 0 1px rgba(49, 128, 240, .08); }
    .access-option strong { display: block; color: #35455d; font-size: 11px; }
    .access-option span { display: block; margin-top: 4px; color: #8a98aa; font-size: 9px; line-height: 1.4; }
    .form-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 18px 24px;
      border-top: 1px solid #e7edf5;
      background: #fbfcff;
    }
    .form-footer small { max-width: 420px; color: #8d99aa; font-size: 10px; line-height: 1.45; }
    .button-row { display: flex; gap: 10px; }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      padding: 0 16px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 800;
    }
    .button.secondary { border: 1px solid #dce4ee; background: #fff; color: #5d6c81; }
    .button.primary { border: 0; background: linear-gradient(135deg, #176fd2, #318ff0); color: #fff; box-shadow: 0 8px 18px rgba(23, 111, 210, .2); opacity: .58; }
    .side-stack { display: grid; gap: 18px; }
    .summary { overflow: hidden; }
    .summary-top {
      padding: 21px;
      color: #fff;
      background: linear-gradient(145deg, #101f47 0%, #174884 58%, #2678dc 100%);
    }
    .summary-top span { display: block; margin-bottom: 8px; color: #bcd8fb; font-size: 9px; font-weight: 850; letter-spacing: .11em; text-transform: uppercase; }
    .summary-top h2 { color: #fff; font-size: 18px; }
    .summary-top p { margin: 7px 0 0; color: #d9e9fb; font-size: 11px; line-height: 1.5; }
    .summary-body { padding: 18px 20px 20px; }
    .summary-row { display: flex; gap: 11px; padding: 12px 0; border-bottom: 1px solid #edf1f6; }
    .summary-row:last-of-type { border-bottom: 0; }
    .summary-row svg { width: 17px; height: 17px; flex: 0 0 auto; color: #377fdc; }
    .summary-row span, .summary-row strong { display: block; }
    .summary-row span { color: #96a2b2; font-size: 9px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
    .summary-row strong { margin-top: 4px; color: #3b4b63; font-size: 11px; line-height: 1.45; }
    .meeting-link {
      margin-top: 15px;
      padding: 13px;
      border: 1px dashed #cfd9e8;
      border-radius: 11px;
      background: #f8faff;
    }
    .meeting-link span { display: block; color: #65758b; font-size: 10px; font-weight: 800; }
    .meeting-link code { display: block; margin-top: 7px; color: #9aa6b7; font-family: inherit; font-size: 10px; }
    .copy-button { width: 100%; min-height: 36px; margin-top: 10px; border: 1px solid #dce4ef; border-radius: 9px; background: #fff; color: #9aa6b7; font-size: 10px; font-weight: 800; }
    .scope-card { padding: 19px 20px; }
    .scope-card h3 { margin: 0; color: #34445d; font-size: 13px; }
    .scope-card ul { display: grid; gap: 10px; margin: 14px 0 0; padding: 0; list-style: none; }
    .scope-card li { display: flex; align-items: flex-start; gap: 9px; color: #75849a; font-size: 10px; line-height: 1.45; }
    .scope-card li::before { content: "✓"; display: grid; place-items: center; width: 17px; height: 17px; flex: 0 0 auto; border-radius: 50%; background: #e9f2ff; color: #2776dd; font-size: 9px; font-weight: 900; }
    @media (max-width: 980px) {
      .layout { grid-template-columns: minmax(0, 1fr) minmax(265px, .62fr); }
      .field-grid { grid-template-columns: 1fr; }
      .field.full { grid-column: auto; }
      .access-options { grid-template-columns: 1fr; }
    }
    @media (max-width: 820px) {
      .app-shell { display: block; }
      .sidebar { display: none; }
      .topbar { min-height: 70px; padding: 12px 18px; }
      .mobile-brand { display: inline-flex; width: 145px; padding: 6px 8px; border: 1px solid #e1e7f0; border-radius: 10px; background: #fff; }
      .mobile-brand img { display: block; width: 100%; height: auto; }
      .breadcrumbs { display: none; }
      .workspace { padding: 25px 18px 38px; }
      .layout { grid-template-columns: 1fr; }
      .side-stack { grid-template-columns: minmax(0, 1.1fr) minmax(0, .9fr); align-items: start; }
    }
    @media (max-width: 580px) {
      .account-copy { display: none; }
      .avatar { width: 38px; height: 38px; }
      .page-heading { display: block; }
      .preview-badge { margin-top: 15px; }
      .form-body { padding: 20px 17px; }
      .card-heading { padding: 18px 17px; }
      .field-grid { gap: 15px; }
      .side-stack { grid-template-columns: 1fr; }
      .form-footer { display: block; padding: 17px; }
      .form-footer small { display: block; margin-bottom: 13px; }
      .button-row { display: grid; grid-template-columns: 1fr 1fr; }
      .button { padding: 0 11px; }
    }
  </style>
</head>
<body>
  <main class="app-shell">
    <aside class="sidebar" aria-label="Primary navigation">
      <a class="logo-link" href="/dashboard" aria-label="BillionTalks dashboard"><img src="${logoUrl}" alt="BillionTalks"></a>
      <p class="nav-label">Workspace</p>
      <nav class="side-nav">
        <a class="nav-item" href="/dashboard"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>Dashboard</a>
        <span class="nav-item active" aria-current="page"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3z"/></svg>Meetings</span>
        <span class="nav-item disabled" aria-disabled="true"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>Calendar<span class="soon-badge">Soon</span></span>
        <span class="nav-item disabled" aria-disabled="true"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.8M18 15a4 4 0 0 1 2.5 4"/></svg>Contacts<span class="soon-badge">Soon</span></span>
        <span class="nav-item disabled" aria-disabled="true"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="12" r="3"/><path d="M8 4v3M16 4v3"/></svg>Recordings<span class="soon-badge">Soon</span></span>
        <a class="nav-item" href="/account#profile"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>Settings</a>
      </nav>
      <div class="sidebar-footer">
        <a class="sign-out" href="/dashboard"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6M9 12h12M5 4h4M5 20h4"/></svg>Back to dashboard</a>
      </div>
    </aside>
    <div class="main-column">
      <header class="topbar">
        <a class="mobile-brand" href="/dashboard" aria-label="BillionTalks dashboard"><img src="${logoUrl}" alt="BillionTalks"></a>
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <a href="/dashboard">Dashboard</a>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
          <span>Schedule meeting</span>
        </nav>
        <div class="preview-account">
          <span class="avatar" aria-hidden="true">BT</span>
          <span class="account-copy"><strong>Signed-in workspace</strong><span>Account identity in implementation</span></span>
        </div>
      </header>
      <div class="workspace">
        <section class="page-heading" aria-labelledby="schedulerTitle">
          <div>
            <p class="eyebrow">BT-V1-003 · Meeting Scheduler</p>
            <h1 id="schedulerTitle">Schedule a meeting</h1>
            <p>Choose the meeting time, access policy and agenda. BillionTalks will reserve a private meeting link after the schedule is saved.</p>
          </div>
          <span class="preview-badge">Visual preview</span>
        </section>
        <div class="notice" role="note">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>
          This owner-review preview does not save meetings, send invitations or create calendar events.
        </div>
        <div class="layout">
          <form class="card form-card" id="schedulerPreviewForm">
            <div class="card-heading">
              <span class="heading-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M12 14v4M10 16h4"/></svg></span>
              <div><h2>Meeting details</h2><p>Required fields are marked with an asterisk.</p></div>
            </div>
            <div class="form-body">
              <section class="form-section">
                <div class="section-title"><strong>About this meeting</strong><span>Private to the host account</span></div>
                <div class="field-grid">
                  <div class="field full">
                    <label for="title">Meeting title <span class="required">*</span></label>
                    <input id="title" name="title" maxlength="120" placeholder="e.g. Weekly product review">
                  </div>
                  <div class="field full">
                    <label for="agenda">Description or agenda</label>
                    <textarea id="agenda" name="agenda" maxlength="1000" placeholder="Add context, goals or preparation notes for participants"></textarea>
                    <span class="field-help">Visible to people who receive the meeting link.</span>
                  </div>
                </div>
              </section>
              <section class="form-section">
                <div class="section-title"><strong>Date and time</strong><span>Stored safely across time zones</span></div>
                <div class="field-grid">
                  <div class="field">
                    <label for="date">Date <span class="required">*</span></label>
                    <input id="date" name="date" type="date">
                  </div>
                  <div class="field">
                    <label for="time">Start time <span class="required">*</span></label>
                    <input id="time" name="time" type="time">
                  </div>
                  <div class="field">
                    <label for="duration">Duration</label>
                    <select id="duration" name="duration">
                      <option value="30">30 minutes</option>
                      <option value="45">45 minutes</option>
                      <option value="60" selected>1 hour</option>
                      <option value="90">1 hour 30 minutes</option>
                      <option value="120">2 hours</option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="timezone">Time zone <span class="required">*</span></label>
                    <select id="timezone" name="timezone">
                      <option id="deviceTimezone" value="device">Use device time zone</option>
                    </select>
                    <span class="field-help">The original IANA time zone will be retained when the meeting is edited.</span>
                  </div>
                </div>
              </section>
              <section class="form-section">
                <div class="section-title"><strong>Guest access</strong><span>Can be changed before the meeting starts</span></div>
                <div class="access-options" aria-label="Guest access preview">
                  <div class="access-option selected"><strong>Host approval</strong><span>Guests wait until the host admits them.</span></div>
                  <div class="access-option"><strong>Open access</strong><span>Anyone with the link can enter.</span></div>
                  <div class="access-option"><strong>Locked</strong><span>No guest admission until unlocked.</span></div>
                </div>
              </section>
            </div>
            <footer class="form-footer">
              <small>Scheduling remains disabled until the owner approves this layout and the authenticated persistence scope.</small>
              <div class="button-row">
                <a class="button secondary" href="/dashboard">Cancel</a>
                <button class="button primary" type="submit" disabled>Schedule meeting</button>
              </div>
            </footer>
          </form>
          <aside class="side-stack" aria-label="Meeting schedule preview">
            <section class="card summary">
              <div class="summary-top">
                <span>Meeting preview</span>
                <h2 id="summaryTitle">Untitled meeting</h2>
                <p>Your schedule summary updates as details are entered.</p>
              </div>
              <div class="summary-body">
                <div class="summary-row">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>
                  <div><span>Date</span><strong id="summaryDate">Choose a date</strong></div>
                </div>
                <div class="summary-row">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                  <div><span>Time</span><strong id="summaryTime">Choose a start time · 1 hour</strong></div>
                </div>
                <div class="summary-row">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>
                  <div><span>Time zone</span><strong id="summaryTimezone">Device time zone</strong></div>
                </div>
                <div class="summary-row">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 11V8a5 5 0 0 1 10 0v3"/><rect x="4" y="11" width="16" height="10" rx="2"/></svg>
                  <div><span>Guest access</span><strong>Host approval</strong></div>
                </div>
                <div class="meeting-link">
                  <span>Private meeting link</span>
                  <code>Generated after scheduling</code>
                  <button class="copy-button" type="button" disabled>Copy link unavailable</button>
                </div>
              </div>
            </section>
            <section class="card scope-card">
              <h3>Included in BT-V1-003</h3>
              <ul>
                <li>Account-owned scheduled meetings</li>
                <li>Edit or cancel before the meeting ends</li>
                <li>Private BillionTalks meeting link</li>
                <li>Next and upcoming dashboard sections</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  </main>
  <script>
    (() => {
      'use strict';
      const form = document.getElementById('schedulerPreviewForm');
      const title = document.getElementById('title');
      const date = document.getElementById('date');
      const time = document.getElementById('time');
      const duration = document.getElementById('duration');
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Device time zone';
      document.getElementById('deviceTimezone').textContent = timezone;
      document.getElementById('summaryTimezone').textContent = timezone;
      const refresh = () => {
        document.getElementById('summaryTitle').textContent = title.value.trim() || 'Untitled meeting';
        document.getElementById('summaryDate').textContent = date.value
          ? new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(date.value + 'T12:00:00'))
          : 'Choose a date';
        const durationLabel = duration.options[duration.selectedIndex].textContent;
        document.getElementById('summaryTime').textContent = (time.value || 'Choose a start time') + ' · ' + durationLabel;
      };
      form.addEventListener('input', refresh);
      form.addEventListener('submit', (event) => event.preventDefault());
      refresh();
    })();
  </script>
</body>
</html>`;
}
