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
    .sidebar-toggle { display: none; }
    .sidebar-toggle:focus-visible { outline: 3px solid #318aff66; outline-offset: 2px; }
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
    .scheduler-error { display: none; margin: 0 0 18px; padding: 13px 15px; border: 1px solid #f1c8c8; border-radius: 12px; background: #fff6f6; color: #a33a3a; font-size: 12px; line-height: 1.5; }
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
    .timezone-picker { position: relative; }
    .timezone-picker input { padding-right: 38px; }
    .timezone-suggestions {
      position: absolute;
      z-index: 20;
      top: calc(100% + 5px);
      right: 0;
      left: 0;
      max-height: min(320px, 48vh);
      overflow-y: auto;
      padding: 5px;
      border: 1px solid #dce4ef;
      border-radius: 11px;
      background: #fff;
      box-shadow: 0 14px 34px rgba(23, 43, 77, .18);
    }
    .timezone-suggestions[hidden] { display: none; }
    .timezone-suggestion {
      display: block;
      width: 100%;
      min-height: 42px;
      padding: 10px 11px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: #344967;
      font-size: 12px;
      line-height: 1.4;
      text-align: left;
      cursor: pointer;
    }
    .timezone-suggestion:hover, .timezone-suggestion[aria-selected="true"] { background: #eef5ff; color: #1559ad; }
    .timezone-empty { padding: 11px; color: #77869b; font-size: 12px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    textarea { min-height: 92px; padding: 11px 12px; resize: vertical; }
    input::placeholder, textarea::placeholder { color: #abb5c3; }
    input:focus, select:focus, textarea:focus { border-color: #83adf1; background: #fff; box-shadow: 0 0 0 3px rgba(49, 128, 240, .1); }
    .field-help { color: #98a5b6; font-size: 10px; line-height: 1.45; }
    .access-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .access-option {
      position: relative;
      display: block;
      min-width: 0;
      padding: 13px;
      border: 1px solid #dfe6f0;
      border-radius: 11px;
      background: #fbfcff;
      cursor: pointer;
    }
    .access-option input { position: absolute; width: 1px; height: 1px; opacity: 0; }
    .access-option:focus-within { outline: 3px solid rgba(49, 128, 240, .18); }
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
    .button.primary { border: 0; background: linear-gradient(135deg, #176fd2, #318ff0); color: #fff; box-shadow: 0 8px 18px rgba(23, 111, 210, .2); }
    .button:disabled { opacity: .6; cursor: wait; }
    .schedule-list-card { margin-top: 24px; overflow: hidden; }
    .schedule-list-card .card-heading { justify-content: space-between; }
    .schedule-list { display: grid; gap: 10px; padding: 18px 22px 22px; }
    .schedule-entry { border: 1px solid #e3eaf3; border-radius: 12px; background: #fbfcff; }
    .schedule-entry summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; color: #34445d; cursor: pointer; list-style: none; }
    .schedule-entry summary::-webkit-details-marker { display: none; }
    .schedule-entry summary strong, .schedule-entry summary small { display: block; }
    .schedule-entry summary strong { font-size: 12px; }
    .schedule-entry summary small { margin-top: 4px; color: #8391a5; font-size: 10px; }
    .schedule-status { flex: 0 0 auto; padding: 5px 8px; border-radius: 999px; background: #eaf2ff; color: #3776cb; font-size: 9px; font-weight: 850; text-transform: uppercase; }
    .schedule-details { padding: 0 16px 15px; color: #65758b; font-size: 11px; line-height: 1.55; }
    .schedule-details p { margin: 6px 0 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .schedule-entry-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .schedule-entry-actions button, .schedule-entry-actions a { min-height: 32px; padding: 0 11px; border: 1px solid #dce4ef; border-radius: 8px; background: #fff; color: #52647d; font-size: 10px; font-weight: 800; cursor: pointer; }
    .schedule-entry-actions .start-action { border-color: #176fd2; background: #176fd2; color: #fff; }
    .schedule-link { display: block; margin: 7px 0 12px; overflow-wrap: anywhere; color: #2879eb; }
    .empty-schedules { padding: 12px 2px; color: #8492a7; font-size: 12px; line-height: 1.55; }
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
      .sidebar { position: fixed; top: 0; left: 0; z-index: 30; display: flex; width: 224px; visibility: hidden; transform: translateX(-105%); transition: transform .2s ease, visibility 0s linear .2s; box-shadow: 16px 0 40px rgba(22, 44, 79, .16); }
      .sidebar.open { visibility: visible; transform: translateX(0); transition: transform .2s ease; }
      .topbar { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; min-height: 70px; padding: 12px 18px; }
      .sidebar-toggle { display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; color: #52637b; }
      .sidebar-toggle svg { width: 19px; height: 19px; }
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
    <aside class="sidebar" id="schedulerSidebar" aria-label="Primary navigation">
      <a class="logo-link" href="/dashboard" aria-label="BillionTalks dashboard"><img src="${logoUrl}" alt="BillionTalks"></a>
      <p class="nav-label">Workspace</p>
      <nav class="side-nav">
        <a class="nav-item" href="/dashboard"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>Dashboard</a>
        <a class="nav-item active" href="/schedule" aria-current="page"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3z"/></svg>Meetings</a>
        <a class="nav-item" href="/calendar"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>Calendar</a>
        <a class="nav-item" href="/contacts"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.8M18 15a4 4 0 0 1 2.5 4"/></svg>Contacts &amp; Invitations</a>
        <span class="nav-item disabled" aria-disabled="true" aria-describedby="recordingsAvailability"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="12" r="3"/><path d="M8 4v3M16 4v3"/></svg>Recordings<span class="soon-badge">In meetings</span></span>
        <span class="sr-only" id="recordingsAvailability">Recording controls and consent are available in meeting rooms. Playback is not available.</span>
        <a class="nav-item" href="/notifications"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>Notifications</a>
        <a class="nav-item" href="/account#preferences"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>Settings</a>
      </nav>
      <div class="sidebar-footer">
        <a class="sign-out" href="/dashboard"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6M9 12h12M5 4h4M5 20h4"/></svg>Back to dashboard</a>
      </div>
    </aside>
    <div class="main-column">
      <header class="topbar">
        <button class="sidebar-toggle" id="sidebarToggle" type="button" aria-controls="schedulerSidebar" aria-expanded="false" aria-label="Open navigation">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
        <a class="mobile-brand" href="/dashboard" aria-label="BillionTalks dashboard"><img src="${logoUrl}" alt="BillionTalks"></a>
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <a href="/dashboard">Dashboard</a>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
          <span>Schedule meeting</span>
        </nav>
        <div class="preview-account">
          <span class="avatar" aria-hidden="true">BT</span>
          <span class="account-copy"><strong id="schedulerAccountName">Your workspace</strong><span id="schedulerAccountEmail">Private meeting scheduling</span></span>
        </div>
      </header>
      <div class="workspace">
        <section class="page-heading" aria-labelledby="schedulerTitle">
          <div>
            <p class="eyebrow">BT-V1-003 · Meeting Scheduler</p>
            <h1 id="schedulerTitle">Schedule a meeting</h1>
            <p>Choose the meeting time, access policy and agenda. BillionTalks will reserve a private meeting link after the schedule is saved.</p>
          </div>
          <span class="preview-badge">Private workspace</span>
        </section>
        <div class="notice" role="note">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>
          Scheduling saves an account-owned meeting and share link without opening a live room. Start the room when you are ready.
        </div>
        <div class="scheduler-error" id="schedulerError" role="alert" aria-live="polite"></div>
        <div class="layout">
          <form class="card form-card" id="schedulerForm">
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
                    <input id="title" name="title" maxlength="120" required placeholder="e.g. Weekly product review">
                  </div>
                  <div class="field full">
                    <label for="agenda">Description or agenda</label>
                    <textarea id="agenda" name="agenda" maxlength="1000" placeholder="Add context, goals or preparation notes for participants"></textarea>
                    <span class="field-help">Saved with your account-owned meeting details.</span>
                  </div>
                </div>
              </section>
              <section class="form-section">
                <div class="section-title"><strong>Date and time</strong><span>Stored safely across time zones</span></div>
                <div class="field-grid">
                  <div class="field">
                    <label for="date">Date <span class="required">*</span></label>
                    <input id="date" name="date" type="date" required>
                  </div>
                  <div class="field">
                    <label for="time">Start time <span class="required">*</span></label>
                    <input id="time" name="time" type="time" required>
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
                    <div class="timezone-picker" id="timezonePicker">
                      <input id="timezoneSearch" type="text" autocomplete="off" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-label="Time zone" aria-describedby="timezoneHelp" aria-controls="timezoneOptions" placeholder="Search city, country, abbreviation or UTC offset">
                      <input id="timezone" name="timezone" type="hidden">
                      <div class="timezone-suggestions" id="timezoneOptions" role="listbox" aria-label="Time zone suggestions" hidden></div>
                    </div>
                    <span class="sr-only" id="timezoneAnnouncement" role="status" aria-live="polite"></span>
                    <span class="field-help" id="timezoneHelp">Times are shown for the selected meeting date. The original IANA time zone is retained when editing.</span>
                  </div>
                </div>
              </section>
              <section class="form-section">
                <div class="section-title"><strong>Guest access</strong><span>Can be changed before the meeting starts</span></div>
                <div class="access-options" role="radiogroup" aria-label="Guest access">
                  <label class="access-option selected"><input type="radio" name="guestAccess" value="HOST_APPROVAL" checked><strong>Host approval</strong><span>Guests wait until the host admits them.</span></label>
                  <label class="access-option"><input type="radio" name="guestAccess" value="OPEN"><strong>Open access</strong><span>Anyone with the link can enter.</span></label>
                  <label class="access-option"><input type="radio" name="guestAccess" value="LOCKED"><strong>Locked</strong><span>No guest admission until unlocked.</span></label>
                </div>
              </section>
            </div>
            <footer class="form-footer">
              <small>A scheduled meeting does not open a live room. You can start it later from your scheduled meetings.</small>
              <div class="button-row">
                <button class="button secondary" id="resetFormButton" type="button">Clear</button>
                <button class="button primary" id="submitScheduleButton" type="submit">Schedule meeting</button>
              </div>
            </footer>
          </form>
          <aside class="side-stack" aria-label="Meeting schedule summary">
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
                  <div><span>Guest access</span><strong id="summaryAccess">Host approval</strong></div>
                </div>
                <div class="meeting-link">
                  <span>Private meeting link</span>
                  <code id="summaryLink">Generated after scheduling</code>
                  <button class="copy-button" id="copyLinkButton" type="button" disabled>Copy meeting link</button>
                </div>
              </div>
            </section>
            <section class="card scope-card">
              <h3>Included in BT-V1-003</h3>
              <ul>
                <li>Account-owned scheduled meetings</li>
                <li>Edit or cancel before the meeting ends</li>
                <li>Private BillionTalks meeting link</li>
                <li>Dashboard next and upcoming meetings</li>
              </ul>
            </section>
          </aside>
        </div>
        <section class="card schedule-list-card" aria-labelledby="scheduledMeetingsTitle">
          <div class="card-heading">
            <div class="heading-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M8 14h3M8 17h6"/></svg></div>
            <div><h2 id="scheduledMeetingsTitle">Your scheduled meetings</h2><p>View, update, cancel or start meetings owned by your account.</p></div>
          </div>
          <div class="schedule-list" id="scheduleList"><div class="empty-schedules">Loading your scheduled meetings...</div></div>
        </section>
      </div>
    </div>
  </main>
  <script>
    (() => {
      'use strict';
      const schedulerSidebar = document.getElementById('schedulerSidebar');
      const sidebarToggle = document.getElementById('sidebarToggle');
      function setNavigationOpen(open) {
        schedulerSidebar.classList.toggle('open', open);
        sidebarToggle.setAttribute('aria-expanded', String(open));
        sidebarToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      }
      sidebarToggle.addEventListener('click', () => {
        const open = !schedulerSidebar.classList.contains('open');
        setNavigationOpen(open);
        if (open) schedulerSidebar.querySelector('.side-nav a')?.focus();
      });
      schedulerSidebar.querySelectorAll('.side-nav a').forEach((link) => {
        link.addEventListener('click', () => setNavigationOpen(false));
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && schedulerSidebar.classList.contains('open')) {
          setNavigationOpen(false);
          sidebarToggle.focus();
        }
      });
      document.addEventListener('click', (event) => {
        if (schedulerSidebar.classList.contains('open') &&
          !schedulerSidebar.contains(event.target) && !sidebarToggle.contains(event.target)) {
          setNavigationOpen(false);
        }
      });
      const form = document.getElementById('schedulerForm');
      const title = document.getElementById('title');
      const agenda = document.getElementById('agenda');
      const date = document.getElementById('date');
      const time = document.getElementById('time');
      const duration = document.getElementById('duration');
      const timezoneField = document.getElementById('timezone');
      const timezoneSearch = document.getElementById('timezoneSearch');
      const timezonePicker = document.getElementById('timezonePicker');
      const timezoneOptions = document.getElementById('timezoneOptions');
      const timezoneAnnouncement = document.getElementById('timezoneAnnouncement');
      const accessFields = [...form.querySelectorAll('input[name="guestAccess"]')];
      const error = document.getElementById('schedulerError');
      const scheduleList = document.getElementById('scheduleList');
      const state = { editingId: null, revision: null, link: '', preferences: null, selectedTimeZone: '' };
      const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      function canonicalTimeZone(zone) { return zone === 'Asia/Calcutta' ? 'Asia/Kolkata' : zone; }
      const zones = typeof Intl.supportedValuesOf === 'function'
        ? [...new Set(['UTC', deviceTimezone, ...Intl.supportedValuesOf('timeZone')].map(canonicalTimeZone))]
        : [...new Set(['UTC', deviceTimezone, 'Asia/Kolkata', 'Asia/Colombo', 'America/New_York', 'America/Los_Angeles', 'Europe/London'])];
      const countryByZone = {
        'Africa/Abidjan': 'Ivory Coast', 'Africa/Addis_Ababa': 'Ethiopia', 'Africa/Algiers': 'Algeria',
        'Africa/Cairo': 'Egypt', 'Africa/Casablanca': 'Morocco', 'Africa/Dar_es_Salaam': 'Tanzania',
        'Africa/Harare': 'Zimbabwe', 'Africa/Johannesburg': 'South Africa', 'Africa/Kampala': 'Uganda',
        'Africa/Khartoum': 'Sudan', 'Africa/Kigali': 'Rwanda', 'Africa/Kinshasa': 'Democratic Republic of the Congo',
        'Africa/Lagos': 'Nigeria', 'Africa/Maputo': 'Mozambique', 'Africa/Nairobi': 'Kenya',
        'Africa/Tripoli': 'Libya', 'Africa/Tunis': 'Tunisia', 'Africa/Windhoek': 'Namibia',
        'America/Anchorage': 'United States', 'America/Argentina/Buenos_Aires': 'Argentina',
        'America/Asuncion': 'Paraguay', 'America/Bogota': 'Colombia', 'America/Caracas': 'Venezuela',
        'America/Chicago': 'United States', 'America/Costa_Rica': 'Costa Rica', 'America/Denver': 'United States',
        'America/Guatemala': 'Guatemala', 'America/Halifax': 'Canada', 'America/Havana': 'Cuba',
        'America/Jamaica': 'Jamaica', 'America/Lima': 'Peru', 'America/Los_Angeles': 'United States',
        'America/Mexico_City': 'Mexico', 'America/Montevideo': 'Uruguay', 'America/New_York': 'United States',
        'America/Panama': 'Panama', 'America/Phoenix': 'United States', 'America/Port-au-Prince': 'Haiti',
        'America/Santiago': 'Chile', 'America/Sao_Paulo': 'Brazil', 'America/St_Johns': 'Canada',
        'America/Toronto': 'Canada', 'America/Vancouver': 'Canada',
        'Asia/Baghdad': 'Iraq', 'Asia/Bahrain': 'Bahrain', 'Asia/Bangkok': 'Thailand',
        'Asia/Beirut': 'Lebanon', 'Asia/Dhaka': 'Bangladesh', 'Asia/Dubai': 'United Arab Emirates',
        'Asia/Hong_Kong': 'Hong Kong', 'Asia/Jakarta': 'Indonesia', 'Asia/Jerusalem': 'Israel',
        'Asia/Kabul': 'Afghanistan', 'Asia/Karachi': 'Pakistan', 'Asia/Kathmandu': 'Nepal',
        'Asia/Colombo': 'Sri Lanka', 'Asia/Kolkata': 'India', 'Asia/Kuala_Lumpur': 'Malaysia', 'Asia/Manila': 'Philippines',
        'Asia/Muscat': 'Oman', 'Asia/Phnom_Penh': 'Cambodia', 'Asia/Qatar': 'Qatar',
        'Asia/Riyadh': 'Saudi Arabia', 'Asia/Seoul': 'South Korea', 'Asia/Shanghai': 'China',
        'Asia/Singapore': 'Singapore', 'Asia/Taipei': 'Taiwan', 'Asia/Tehran': 'Iran',
        'Asia/Tokyo': 'Japan', 'Asia/Ulaanbaatar': 'Mongolia', 'Asia/Ho_Chi_Minh': 'Vietnam',
        'Asia/Yangon': 'Myanmar',
        'Australia/Adelaide': 'Australia', 'Australia/Brisbane': 'Australia', 'Australia/Perth': 'Australia',
        'Australia/Sydney': 'Australia', 'Europe/Amsterdam': 'Netherlands', 'Europe/Athens': 'Greece',
        'Europe/Belgrade': 'Serbia', 'Europe/Berlin': 'Germany', 'Europe/Bratislava': 'Slovakia',
        'Europe/Brussels': 'Belgium', 'Europe/Bucharest': 'Romania', 'Europe/Budapest': 'Hungary',
        'Europe/Copenhagen': 'Denmark', 'Europe/Dublin': 'Ireland', 'Europe/Helsinki': 'Finland',
        'Europe/Istanbul': 'Turkey', 'Europe/Kyiv': 'Ukraine', 'Europe/Lisbon': 'Portugal',
        'Europe/London': 'United Kingdom', 'Europe/Luxembourg': 'Luxembourg', 'Europe/Madrid': 'Spain',
        'Europe/Moscow': 'Russia', 'Europe/Oslo': 'Norway', 'Europe/Paris': 'France',
        'Europe/Prague': 'Czechia', 'Europe/Riga': 'Latvia', 'Europe/Rome': 'Italy',
        'Europe/Sarajevo': 'Bosnia and Herzegovina', 'Europe/Sofia': 'Bulgaria',
        'Europe/Stockholm': 'Sweden', 'Europe/Tallinn': 'Estonia', 'Europe/Vienna': 'Austria',
        'Europe/Vilnius': 'Lithuania', 'Europe/Warsaw': 'Poland', 'Europe/Zurich': 'Switzerland',
        'Pacific/Auckland': 'New Zealand', 'Pacific/Fiji': 'Fiji', 'Pacific/Guam': 'United States',
        'Pacific/Honolulu': 'United States', 'Pacific/Port_Moresby': 'Papua New Guinea',
      };
      function zoneLabel(zone) {
        zone = canonicalTimeZone(zone);
        const meetingDate = date.value ? new Date(date.value + 'T12:00:00Z') : new Date();
        const formatter = (timeZoneName) => new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName }).formatToParts(meetingDate)
          .find((part) => part.type === 'timeZoneName')?.value || '';
        const offsetName = formatter('longOffset');
        const offsetMatch = /^GMT([+-])(\\d{1,2})(?::?(\\d{2}))?$/.exec(offsetName);
        const offset = !offsetName || offsetName === 'GMT'
          ? 'UTC+00:00'
          : offsetMatch ? 'UTC' + offsetMatch[1] + offsetMatch[2].padStart(2, '0') + ':' + (offsetMatch[3] || '00') : offsetName.replace(/^GMT/, 'UTC');
        const longName = formatter('long');
        const city = zone === 'UTC' ? 'UTC' : zone.split('/').pop().replace(/_/g, ' ');
        const country = countryByZone[zone] || '';
        const location = [city, country].filter(Boolean).join(', ');
        const shortName = formatter('short');
        if (zone === 'Asia/Kolkata') {
          return {
            label: '(UTC+05:30) India Standard Time (IST) — India (Chennai / Kolkata / Mumbai)',
            search: [zone, 'Asia/Calcutta', 'Calcutta', 'India', 'Chennai', 'Kolkata', 'Mumbai', 'IST', longName, shortName, offset, offsetName].join(' ').toLocaleLowerCase(),
          };
        }
        if (zone === 'Asia/Colombo') {
          return {
            label: '(UTC+05:30) Sri Lanka Standard Time (SLST) — Colombo, Sri Lanka',
            search: [zone, 'Sri Lanka', 'Colombo', 'SLST', 'Sri Lanka Standard Time', offset, offsetName].join(' ').toLocaleLowerCase(),
          };
        }
        const label = '(' + offset + ') ' + longName + ' — ' + location;
        return { label, search: [zone, city, country, longName, shortName, offset, offsetName, zone.replace(/[_/]/g, ' ')].join(' ').toLocaleLowerCase() };
      }
      function renderTimeZones() {
        const selectedZone = canonicalTimeZone(state.selectedTimeZone || timezoneField.value || deviceTimezone);
        state.selectedTimeZone = selectedZone;
        const query = timezoneSearch.value.trim().toLocaleLowerCase();
        const matches = zones.map((zone) => ({ zone, ...zoneLabel(zone) }))
          .filter((entry) => !query || entry.search.includes(query))
          .sort((left, right) => {
            const indianSearch = /^(india|ind|ist|chennai|mumbai|kolkata|calcutta)$/.test(query);
            if (indianSearch && (left.zone === 'Asia/Kolkata' || right.zone === 'Asia/Kolkata')) {
              return left.zone === 'Asia/Kolkata' ? -1 : 1;
            }
            const leftLabelMatch = left.label.toLocaleLowerCase().includes(query);
            const rightLabelMatch = right.label.toLocaleLowerCase().includes(query);
            return Number(rightLabelMatch) - Number(leftLabelMatch) || left.label.localeCompare(right.label);
          });
        timezoneField.value = selectedZone;
        if (document.activeElement !== timezoneSearch) timezoneSearch.value = zoneLabel(selectedZone).label;
        timezoneOptions.replaceChildren();
        const visibleMatches = matches;
        if (!visibleMatches.length) {
          const empty = document.createElement('div');
          empty.className = 'timezone-empty';
          empty.textContent = 'No matching time zones.';
          timezoneOptions.append(empty);
        }
        for (const entry of visibleMatches) {
          const option = document.createElement('div');
          option.className = 'timezone-suggestion';
          option.id = 'timezone-option-' + entry.zone.replace(/[^A-Za-z0-9_-]/g, '-');
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', String(entry.zone === selectedZone));
          option.dataset.timeZone = entry.zone;
          option.textContent = entry.label + (entry.zone === deviceTimezone ? ' (device)' : '');
          timezoneOptions.append(option);
        }
        return visibleMatches;
      }
      let visibleTimeZones = [];
      let activeTimeZoneIndex = -1;
      function showTimeZoneSuggestions() {
        visibleTimeZones = renderTimeZones();
        activeTimeZoneIndex = -1;
        timezoneOptions.hidden = false;
        timezoneSearch.setAttribute('aria-expanded', 'true');
        timezoneSearch.removeAttribute('aria-activedescendant');
        timezoneAnnouncement.textContent = visibleTimeZones.length + ' time zone suggestions.';
      }
      function closeTimeZoneSuggestions(restoreSelection = true) {
        timezoneOptions.hidden = true;
        timezoneSearch.setAttribute('aria-expanded', 'false');
        timezoneSearch.removeAttribute('aria-activedescendant');
        activeTimeZoneIndex = -1;
        if (restoreSelection) timezoneSearch.value = zoneLabel(state.selectedTimeZone).label;
      }
      function setActiveTimeZone(index) {
        if (!visibleTimeZones.length) return;
        activeTimeZoneIndex = (index + visibleTimeZones.length) % visibleTimeZones.length;
        const activeId = 'timezone-option-' + visibleTimeZones[activeTimeZoneIndex].zone.replace(/[^A-Za-z0-9_-]/g, '-');
        timezoneSearch.setAttribute('aria-activedescendant', activeId);
        for (const [optionIndex, option] of [...timezoneOptions.querySelectorAll('[role="option"]')].entries()) {
          option.setAttribute('aria-selected', String(optionIndex === activeTimeZoneIndex));
        }
        document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
      }
      function selectTimeZone(zone) {
        state.selectedTimeZone = canonicalTimeZone(zone);
        timezoneField.value = state.selectedTimeZone;
        timezoneSearch.value = zoneLabel(state.selectedTimeZone).label;
        closeTimeZoneSuggestions(false);
        refresh();
        timezoneSearch.focus();
        timezoneSearch.select();
        timezoneAnnouncement.textContent = timezoneSearch.value + ' selected.';
      }
      function ensureTimeZone(zone) {
        zone = canonicalTimeZone(zone);
        if (!zones.includes(zone)) zones.push(zone);
        renderTimeZones();
      }
      function applyPreferences() {
        if (!state.preferences) return;
        duration.value = String(state.preferences.defaultDurationMinutes);
        const guestAccess = form.querySelector('input[name="guestAccess"][value="' + state.preferences.defaultGuestAccess + '"]');
        if (guestAccess) guestAccess.checked = true;
        if (state.preferences.timeZoneExplicit) {
          ensureTimeZone(state.preferences.timeZone);
          state.selectedTimeZone = canonicalTimeZone(state.preferences.timeZone);
        } else {
          state.selectedTimeZone = deviceTimezone;
        }
        renderTimeZones();
      }
      function selectedAccess() { return form.querySelector('input[name="guestAccess"]:checked').value; }
      function accessLabel(value) { return ({ HOST_APPROVAL: 'Host approval', OPEN: 'Open access', LOCKED: 'Locked' })[value] || 'Host approval'; }
      function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character])); }
      function showError(message) {
        error.textContent = message || '';
        error.style.display = message ? 'block' : 'none';
      }
      async function api(path, options = {}) {
        const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
        let payload;
        try { payload = await response.json(); } catch { throw new Error('The scheduler could not read the server response.'); }
        if (response.status === 401) { window.location.href = '/account#login'; throw new Error('Sign in to manage scheduled meetings.'); }
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to complete the meeting request.');
        return payload.data;
      }
      function formatMeetingDate(meeting) {
        return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: meeting.timeZone }).format(new Date(meeting.startsAt));
      }
      function formatMeetingTime(meeting) {
        return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: meeting.timeZone }).format(new Date(meeting.startsAt));
      }
      function updateSummaryLink(link) {
        state.link = link || '';
        const output = document.getElementById('summaryLink');
        output.textContent = state.link || 'Generated after scheduling';
        document.getElementById('copyLinkButton').disabled = !state.link;
      }
      const refresh = () => {
        document.getElementById('summaryTitle').textContent = title.value.trim() || 'Untitled meeting';
        document.getElementById('summaryDate').textContent = date.value
          ? new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(date.value + 'T12:00:00'))
          : 'Choose a date';
        const durationLabel = duration.options[duration.selectedIndex].textContent;
        document.getElementById('summaryTime').textContent = (time.value || 'Choose a start time') + ' · ' + durationLabel;
        const zone = canonicalTimeZone(state.selectedTimeZone || timezoneField.value || deviceTimezone);
        document.getElementById('summaryTimezone').textContent = zoneLabel(zone).label;
        document.getElementById('summaryAccess').textContent = accessLabel(selectedAccess());
        for (const option of accessFields) option.closest('.access-option').classList.toggle('selected', option.checked);
      };
      const localNow = new Date();
      date.min = [localNow.getFullYear(), String(localNow.getMonth() + 1).padStart(2, '0'), String(localNow.getDate()).padStart(2, '0')].join('-');
      state.selectedTimeZone = deviceTimezone;
      renderTimeZones();
      form.addEventListener('input', refresh);
      form.addEventListener('change', (event) => {
        if (event.target === date) renderTimeZones();
        refresh();
      });
      timezoneSearch.addEventListener('focus', () => {
        timezoneSearch.value = '';
        showTimeZoneSuggestions();
      });
      timezoneSearch.addEventListener('input', showTimeZoneSuggestions);
      timezoneSearch.addEventListener('click', () => {
        if (!timezoneOptions.hidden) return;
        if (timezoneSearch.value === zoneLabel(state.selectedTimeZone).label) timezoneSearch.value = '';
        showTimeZoneSuggestions();
      });
      timezoneSearch.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (timezoneOptions.hidden) showTimeZoneSuggestions();
          setActiveTimeZone(activeTimeZoneIndex + 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (timezoneOptions.hidden) showTimeZoneSuggestions();
          setActiveTimeZone(activeTimeZoneIndex < 0 ? visibleTimeZones.length - 1 : activeTimeZoneIndex - 1);
        } else if (event.key === 'Enter' && !timezoneOptions.hidden) {
          event.preventDefault();
          const entry = visibleTimeZones[activeTimeZoneIndex < 0 ? 0 : activeTimeZoneIndex];
          if (entry) selectTimeZone(entry.zone);
        } else if (event.key === 'Escape' && !timezoneOptions.hidden) {
          event.preventDefault();
          closeTimeZoneSuggestions();
        } else if (event.key === 'Tab') {
          closeTimeZoneSuggestions();
        }
      });
      timezoneOptions.addEventListener('pointerdown', (event) => event.preventDefault());
      timezoneOptions.addEventListener('click', (event) => {
        const option = event.target.closest('[data-time-zone]');
        if (option) selectTimeZone(option.dataset.timeZone);
      });
      document.addEventListener('pointerdown', (event) => {
        if (!timezonePicker.contains(event.target)) closeTimeZoneSuggestions();
      });
      timezoneSearch.addEventListener('blur', () => {
        window.setTimeout(() => {
          if (!timezonePicker.contains(document.activeElement)) closeTimeZoneSuggestions();
        }, 0);
      });
      time.addEventListener('change', () => {
        if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(time.value)) return;
        window.setTimeout(() => {
          if (document.activeElement === time) time.blur();
        }, 0);
      });
      function resetForm() {
        form.reset();
        state.editingId = null;
        state.revision = null;
        state.selectedTimeZone = deviceTimezone;
        applyPreferences();
        document.getElementById('submitScheduleButton').textContent = 'Schedule meeting';
        updateSummaryLink('');
        showError('');
        refresh();
      }
      document.getElementById('resetFormButton').addEventListener('click', resetForm);
      document.getElementById('copyLinkButton').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(state.link);
          document.getElementById('copyLinkButton').textContent = 'Copied';
          window.setTimeout(() => { document.getElementById('copyLinkButton').textContent = 'Copy meeting link'; }, 1600);
        } catch { showError('The link could not be copied. Select and copy the link shown above.'); }
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        showError('');
        const button = document.getElementById('submitScheduleButton');
        button.disabled = true;
        const body = {
          title: title.value,
          agenda: agenda.value,
          date: date.value,
          time: time.value,
          durationMinutes: Number(duration.value),
          timeZone: canonicalTimeZone(state.selectedTimeZone || timezoneField.value || deviceTimezone),
          guestAccess: selectedAccess(),
          ...(state.editingId ? { revision: state.revision } : {}),
        };
        try {
          const saved = await api(state.editingId ? '/api/schedules/' + encodeURIComponent(state.editingId) : '/api/schedules', {
            method: state.editingId ? 'PUT' : 'POST',
            body: JSON.stringify(body),
          });
          state.editingId = saved.id;
          state.revision = saved.revision;
          document.getElementById('submitScheduleButton').textContent = 'Save changes';
          updateSummaryLink(saved.shareUrl);
          await loadSchedules();
        } catch (failure) {
          showError(failure instanceof Error ? failure.message : 'Unable to save this meeting.');
        } finally { button.disabled = false; }
      });
      function renderSchedules(entries) {
        if (!entries.length) {
          scheduleList.innerHTML = '<div class="empty-schedules">No scheduled meetings yet. Use the form above to plan your first meeting.</div>';
          return;
        }
        scheduleList.innerHTML = entries.map((meeting) => {
          const actions = [];
          if (meeting.status === 'SCHEDULED') {
            actions.push('<button type="button" data-action="edit" data-id="' + escapeHtml(meeting.id) + '">Edit</button>');
            actions.push('<button class="start-action" type="button" data-action="start" data-id="' + escapeHtml(meeting.id) + '" data-revision="' + meeting.revision + '">Start meeting</button>');
            actions.push('<button type="button" data-action="cancel" data-id="' + escapeHtml(meeting.id) + '" data-revision="' + meeting.revision + '">Cancel</button>');
            actions.push('<a href="/contacts?meeting=' + encodeURIComponent(meeting.id) + '">Invite guests</a>');
          } else if (meeting.status === 'STARTING') {
            actions.push('<button class="start-action" type="button" data-action="start" data-id="' + escapeHtml(meeting.id) + '" data-revision="' + meeting.revision + '">Continue start</button>');
          } else if (meeting.status === 'STARTED' || meeting.status === 'ENDED') {
            actions.push('<a href="/?meeting=' + encodeURIComponent(meeting.id) + '">Open meeting room</a>');
          }
          return '<details class="schedule-entry"><summary><span><strong>' + escapeHtml(meeting.title) + '</strong><small>' + escapeHtml(formatMeetingDate(meeting) + ' · ' + formatMeetingTime(meeting) + ' · ' + meeting.durationMinutes + ' min') + '</small></span><span class="schedule-status">' + escapeHtml(meeting.status) + '</span></summary><div class="schedule-details"><strong>' + escapeHtml(meeting.timeZone) + ' · ' + escapeHtml(accessLabel(meeting.guestAccess)) + '</strong>' + (meeting.agenda ? '<p>' + escapeHtml(meeting.agenda) + '</p>' : '') + '<a class="schedule-link" href="' + escapeHtml(meeting.shareUrl) + '">' + escapeHtml(meeting.shareUrl) + '</a><div class="schedule-entry-actions">' + actions.join('') + '<button type="button" data-action="copy" data-link="' + escapeHtml(meeting.shareUrl) + '">Copy link</button></div></div></details>';
        }).join('');
      }
      async function loadSchedules() {
        renderSchedules(await api('/api/schedules'));
      }
      async function editSchedule(id) {
        const meeting = await api('/api/schedules/' + encodeURIComponent(id));
        state.editingId = meeting.id;
        state.revision = meeting.revision;
        title.value = meeting.title;
        agenda.value = meeting.agenda;
        date.value = meeting.localDate;
        time.value = meeting.localTime;
        duration.value = String(meeting.durationMinutes);
        ensureTimeZone(meeting.timeZone);
        state.selectedTimeZone = canonicalTimeZone(meeting.timeZone);
        timezoneSearch.value = '';
        renderTimeZones();
        const matchingAccess = accessFields.find((input) => input.value === meeting.guestAccess);
        if (matchingAccess) matchingAccess.checked = true;
        document.getElementById('submitScheduleButton').textContent = 'Save changes';
        updateSummaryLink(meeting.shareUrl);
        refresh();
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      scheduleList.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        showError('');
        try {
          const id = button.dataset.id;
          if (button.dataset.action === 'edit') await editSchedule(id);
          if (button.dataset.action === 'copy') await navigator.clipboard.writeText(button.dataset.link);
          if (button.dataset.action === 'cancel' && window.confirm('Cancel this scheduled meeting?')) {
            await api('/api/schedules/' + encodeURIComponent(id), { method: 'DELETE', body: JSON.stringify({ revision: Number(button.dataset.revision) }) });
            if (state.editingId === id) resetForm();
            await loadSchedules();
          }
          if (button.dataset.action === 'start') {
            button.disabled = true;
            const result = await api('/api/schedules/' + encodeURIComponent(id) + '/start', { method: 'POST', body: JSON.stringify({ revision: Number(button.dataset.revision) }) });
            window.location.href = '/?meeting=' + encodeURIComponent(result.meeting.id);
          }
        } catch (failure) {
          showError(failure instanceof Error ? failure.message : 'Unable to complete this meeting action.');
          await loadSchedules().catch(() => {});
        }
      });
      async function initialize() {
        try {
          const profile = await api('/api/accounts/me');
          document.getElementById('schedulerAccountName').textContent = profile.account.fullName;
          document.getElementById('schedulerAccountEmail').textContent = profile.account.email;
          try {
            const accountSettings = await api('/api/preferences');
            state.preferences = accountSettings.preferences;
            applyPreferences();
          } catch (failure) {
            showError(failure instanceof Error
              ? 'Your saved meeting defaults could not be loaded. Device defaults are in use. ' + failure.message
              : 'Your saved meeting defaults could not be loaded. Device defaults are in use.');
          }
          await loadSchedules();
          const requestedId = new URLSearchParams(window.location.search).get('meeting');
          if (requestedId) await editSchedule(requestedId);
        } catch (failure) {
          showError(failure instanceof Error ? failure.message : 'Unable to load your scheduled meetings.');
        }
      }
      refresh();
      void initialize();
    })();
  </script>
</body>
</html>`;
}
