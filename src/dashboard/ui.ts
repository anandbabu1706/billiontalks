import logoSource from "../assets/brand/billiontalks-logo.png";

function logoDataUrl(source: string | ArrayBuffer): string {
  if (typeof source === "string") return source;
  const bytes = new Uint8Array(source);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

export function dashboardPage(): string {
  const logoUrl = logoDataUrl(logoSource);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard · BillionTalks</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f4f7fc;
      color: #17233c;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; min-height: 100vh; background: linear-gradient(135deg, #f7faff 0%, #edf3fb 100%); }
    a, button, input, select { font: inherit; }
    a { color: inherit; text-decoration: none; }
    button { cursor: pointer; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .app-shell { display: grid; grid-template-columns: 224px minmax(0, 1fr); min-height: 100vh; }
    .sidebar {
      position: sticky;
      top: 0;
      z-index: 20;
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
    .logo-link { display: inline-flex; align-items: center; width: 172px; max-width: 100%; }
    .logo-link img { display: block; width: 100%; height: auto; }
    .sidebar .logo-link {
      margin: 0 6px 35px;
      padding: 8px 10px;
      border: 1px solid rgba(255, 255, 255, .22);
      border-radius: 12px;
      background: #f9fbff;
      box-shadow: 0 12px 28px rgba(3, 21, 54, .3);
    }
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
    .nav-item:not(.disabled):hover, .nav-item:not(.disabled):focus-visible, .sign-out:hover, .sign-out:focus-visible { color: #fff; background: rgba(255, 255, 255, .11); outline: none; }
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
    .sign-out { color: #dbeafe; }
    .main-column { min-width: 0; }
    .topbar {
      display: grid;
      grid-template-columns: minmax(220px, 420px) auto;
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
    .mobile-brand, .sidebar-toggle { display: none; }
    .search-shell {
      display: flex;
      align-items: center;
      gap: 11px;
      min-height: 42px;
      padding: 0 14px;
      border: 1px solid #e1e7f0;
      border-radius: 11px;
      background: #f8faff;
      color: #93a0b3;
    }
    .search-shell svg { width: 17px; height: 17px; }
    .search-shell span:first-of-type { flex: 1; font-size: 13px; }
    .header-soon { font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .account-summary { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .notification {
      display: grid;
      place-items: center;
      width: 39px;
      height: 39px;
      border: 1px solid #e2e8f0;
      border-radius: 11px;
      background: #fff;
      color: #8b98ab;
      cursor: default;
    }
    .notification svg { width: 18px; height: 18px; }
    .avatar {
      display: grid;
      place-items: center;
      width: 41px;
      height: 41px;
      flex: 0 0 auto;
      border-radius: 12px;
      background: linear-gradient(135deg, #357ff0, #72a9ff);
      color: #fff;
      font-size: 14px;
      font-weight: 850;
      box-shadow: 0 8px 18px rgba(49, 119, 232, .22);
    }
    .account-copy { min-width: 0; }
    .account-copy strong, .account-copy span { display: block; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .account-copy strong { color: #25334b; font-size: 13px; }
    .account-copy span { margin-top: 3px; color: #8a98ab; font-size: 11px; }
    .dashboard { width: min(100%, 1370px); margin: 0 auto; padding: 35px clamp(22px, 3.2vw, 48px) 48px; }
    .welcome { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 26px; }
    .welcome h1 { margin: 0; color: #17233c; font-size: clamp(28px, 3vw, 38px); line-height: 1.15; letter-spacing: -.035em; }
    .welcome h1 span { color: #2879eb; }
    .welcome p { margin: 9px 0 0; color: #77869b; font-size: 14px; }
    .local-time { flex: 0 0 auto; color: #7c8ba0; font-size: 12px; text-align: right; }
    .local-time strong { display: block; margin-bottom: 4px; color: #43546e; font-size: 13px; }
    #error { min-height: 0; margin: 0 0 14px; color: #b3294e; font-size: 13px; font-weight: 650; }
    #error:empty { display: none; }
    .meeting-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; margin-bottom: 22px; }
    .action-card {
      position: relative;
      min-height: 198px;
      padding: 23px;
      overflow: hidden;
      border-radius: 19px;
      color: #fff;
      box-shadow: 0 15px 34px rgba(28, 58, 108, .14);
    }
    .action-card::after {
      content: "";
      position: absolute;
      right: -40px;
      bottom: -65px;
      width: 180px;
      height: 180px;
      border-radius: 50%;
      background: rgba(255, 255, 255, .11);
    }
    .start-card { background: linear-gradient(135deg, #246fe5, #3a8af5); }
    .join-card { background: linear-gradient(135deg, #14a66f, #36bf86); }
    .schedule-card { background: linear-gradient(135deg, #7352d1, #936fea); }
    .action-heading { position: relative; z-index: 1; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .action-icon {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 13px;
      background: rgba(255, 255, 255, .18);
      border: 1px solid rgba(255, 255, 255, .18);
    }
    .action-icon svg { width: 22px; height: 22px; }
    .action-card h2 { margin: 17px 0 6px; font-size: 18px; letter-spacing: -.02em; }
    .action-card p { position: relative; z-index: 1; max-width: 310px; margin: 0; color: rgba(255, 255, 255, .83); font-size: 12px; line-height: 1.55; }
    .action-control {
      position: relative;
      z-index: 2;
      display: flex;
      gap: 8px;
      margin-top: 17px;
    }
    .action-card input, .action-card select {
      min-width: 0;
      height: 38px;
      padding: 0 11px;
      border: 1px solid rgba(255, 255, 255, .28);
      border-radius: 9px;
      outline: none;
      background: rgba(255, 255, 255, .15);
      color: #fff;
      font-size: 11px;
    }
    .action-card input { flex: 1; }
    .action-card input::placeholder { color: rgba(255, 255, 255, .7); }
    .action-card select { width: 106px; }
    .action-card select option { color: #17233c; }
    .action-card input:focus, .action-card select:focus { border-color: #fff; box-shadow: 0 0 0 3px rgba(255, 255, 255, .15); }
    .action-button {
      flex: 0 0 auto;
      min-height: 38px;
      padding: 0 14px;
      border: 0;
      border-radius: 9px;
      background: #fff;
      font-size: 11px;
      font-weight: 800;
      white-space: nowrap;
      box-shadow: 0 6px 16px rgba(19, 39, 75, .14);
    }
    .start-card .action-button { color: #236ddd; }
    .join-card .action-button { color: #13865b; }
    .disabled-action {
      position: relative;
      z-index: 2;
      display: inline-flex;
      align-items: center;
      min-height: 38px;
      margin-top: 17px;
      padding: 0 14px;
      border-radius: 9px;
      background: rgba(255, 255, 255, .16);
      border: 1px solid rgba(255, 255, 255, .22);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .05em;
      text-transform: uppercase;
    }
    .content-grid { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(280px, .85fr); gap: 24px; }
    .left-column, .right-column { display: grid; align-content: start; gap: 24px; min-width: 0; }
    .panel {
      min-width: 0;
      padding: 23px;
      border: 1px solid #dce5f0;
      border-top-width: 3px;
      border-radius: 18px;
      background: #fff;
      box-shadow: 0 14px 32px rgba(27, 58, 103, .075), 0 2px 7px rgba(27, 58, 103, .035);
    }
    .left-column .panel:nth-child(1) { border-top-color: #4a89ee; }
    .left-column .panel:nth-child(2) { border-top-color: #8061dd; }
    .left-column .panel:nth-child(3) { border-top-color: #27ad7b; }
    .right-column .panel:nth-child(1) { border-top-color: #f0a34a; }
    .right-column .panel:nth-child(2) { border-top-color: #347fe9; }
    .panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    .panel-heading h2 { margin: 0; color: #25334b; font-size: 16px; letter-spacing: -.015em; }
    .panel-meta { color: #95a1b2; font-size: 10px; font-weight: 750; text-transform: uppercase; letter-spacing: .06em; }
    .next-empty {
      display: flex;
      align-items: center;
      gap: 18px;
      min-height: 100px;
      padding: 18px;
      border: 1px solid #dbe5f1;
      border-radius: 13px;
      background: linear-gradient(120deg, #f5f9ff, #fbfdff);
      box-shadow: inset 0 1px 0 #fff;
    }
    .empty-icon { display: grid; place-items: center; width: 48px; height: 48px; flex: 0 0 auto; border-radius: 13px; background: #eaf2ff; color: #2d79e9; }
    .empty-icon svg { width: 22px; height: 22px; }
    .next-empty strong { display: block; color: #34435b; font-size: 13px; }
    .next-empty p { margin: 5px 0 0; color: #8996a9; font-size: 11px; line-height: 1.5; }
    .tabs { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 15px; }
    .tab { padding: 6px 9px; border: 1px solid #e5eaf2; border-radius: 8px; background: #f8faff; color: #8996a9; font-size: 10px; font-weight: 750; }
    .tab.active { color: #276fd9; background: #edf4ff; border-color: #d9e7fb; }
    .unavailable {
      display: grid;
      place-items: center;
      min-height: 86px;
      padding: 18px;
      border: 1px dashed #cfdaea;
      border-radius: 12px;
      color: #8a97aa;
      background: #f9fbfe;
      font-size: 11px;
      text-align: center;
      line-height: 1.6;
    }
    .history-list { display: grid; gap: 9px; }
    .meeting {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 15px;
      padding: 13px 14px;
      border: 1px solid #e7ecf3;
      border-radius: 11px;
      background: #fbfcfe;
    }
    .meeting strong, .meeting small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meeting strong { color: #36445b; font-size: 12px; }
    .meeting small { margin-top: 4px; color: #98a4b5; font-size: 10px; }
    .meeting a { color: #2873df; font-size: 10px; font-weight: 800; white-space: nowrap; }
    .status { padding: 4px 7px; border-radius: 999px; color: #23765b; background: #e9f8f2; font-size: 8px; font-weight: 850; letter-spacing: .05em; text-transform: uppercase; }
    .empty { padding: 20px 10px; color: #8c99ac; font-size: 11px; text-align: center; }
    .calendar-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; }
    .calendar-top strong { color: #35445c; font-size: 13px; }
    .calendar-tag { color: #8f9bad; font-size: 9px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
    .calendar-grid span { display: grid; place-items: center; aspect-ratio: 1; border-radius: 8px; color: #69788e; font-size: 10px; }
    .calendar-grid .day-name { aspect-ratio: auto; padding-bottom: 5px; color: #a0aabc; font-size: 8px; font-weight: 800; text-transform: uppercase; }
    .calendar-grid .outside { color: #c5ccd7; }
    .calendar-grid .today { color: #fff; background: #2f7dea; font-weight: 850; box-shadow: 0 5px 12px rgba(47, 125, 234, .26); }
    .quick-list { display: grid; gap: 10px; }
    .quick-item {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 58px;
      padding: 12px;
      border: 1px solid #dfe7f1;
      border-radius: 12px;
      background: #f9fbfe;
    }
    .quick-item-icon { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 auto; border-radius: 10px; background: #edf4ff; color: #2f78e6; }
    .quick-item-icon svg { width: 17px; height: 17px; }
    .quick-item strong { display: block; color: #425067; font-size: 11px; }
    .quick-item span { display: block; margin-top: 3px; color: #98a3b3; font-size: 9px; }
    .quick-item .arrow { margin: 0 0 0 auto; color: #8d9bad; font-size: 16px; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 17px; margin-top: 24px; }
    .stat-card { min-height: 108px; padding: 17px; border: 1px solid transparent; border-radius: 16px; box-shadow: 0 10px 24px rgba(30, 59, 101, .055); }
    .stat-card span { display: block; color: #65748a; font-size: 10px; font-weight: 750; }
    .stat-card strong { display: block; margin-top: 12px; color: #25334b; font-size: 23px; letter-spacing: -.03em; }
    .stat-card small { display: block; margin-top: 5px; color: #8d99aa; font-size: 8px; line-height: 1.35; }
    .stat-blue { background: #eef5ff; border-color: #dceafb; }
    .stat-green { background: #edf9f4; border-color: #d9f0e6; }
    .stat-purple { background: #f4f0ff; border-color: #e7defb; }
    .stat-orange { background: #fff5e9; border-color: #f8e5cc; }
    @media (max-width: 1080px) {
      .meeting-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .schedule-card { grid-column: 1 / -1; min-height: 160px; }
      .content-grid { grid-template-columns: minmax(0, 1.35fr) minmax(260px, .8fr); }
      .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 820px) {
      .app-shell { display: block; }
      .sidebar { position: fixed; left: 0; transform: translateX(-105%); width: 224px; transition: transform .2s ease; box-shadow: 16px 0 40px rgba(22, 44, 79, .16); }
      .sidebar.open { transform: translateX(0); }
      .topbar { grid-template-columns: auto minmax(0, 1fr) auto; min-height: 70px; padding: 12px 20px; }
      .sidebar-toggle { display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; color: #52637b; }
      .sidebar-toggle svg { width: 19px; height: 19px; }
      .mobile-brand { display: inline-flex; width: 143px; }
      .mobile-brand img { width: 100%; height: auto; }
      .search-shell { display: none; }
      .topbar .account-summary { justify-self: end; }
      .account-copy { display: none; }
      .dashboard { padding: 29px 20px 38px; }
      .content-grid { grid-template-columns: 1fr; }
      .right-column { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .right-column .panel { height: 100%; }
    }
    @media (max-width: 620px) {
      .topbar { grid-template-columns: auto minmax(0, 1fr) auto; padding: 10px 14px; }
      .mobile-brand { width: 128px; }
      .notification { display: none; }
      .dashboard { padding: 25px 14px 34px; }
      .welcome { display: block; }
      .welcome h1 { font-size: 28px; }
      .local-time { margin-top: 13px; text-align: left; }
      .meeting-actions { grid-template-columns: 1fr; }
      .schedule-card { grid-column: auto; }
      .action-card { min-height: 190px; }
      .action-control { flex-wrap: wrap; }
      .action-card input { flex-basis: calc(100% - 114px); }
      .start-card select { order: 3; width: 100%; }
      .content-grid, .left-column, .right-column { gap: 16px; }
      .right-column { grid-template-columns: 1fr; }
      .panel { padding: 18px; }
      .meeting { grid-template-columns: minmax(0, 1fr) auto; }
      .meeting .status { display: none; }
      .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
      .stat-card { min-height: 100px; padding: 14px; }
    }
    @media (max-width: 350px) {
      .mobile-brand { width: 112px; }
      .avatar { width: 37px; height: 37px; }
      .stats-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="app-shell">
    <aside class="sidebar" id="sidebar">
      <a class="logo-link" href="/dashboard" aria-label="BillionTalks dashboard"><img src="${logoUrl}" alt="BillionTalks"></a>
      <div class="nav-label">Workspace</div>
      <nav class="side-nav" aria-label="Workspace navigation">
        <a class="nav-item active" href="/dashboard" aria-current="page">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>
          Dashboard
        </a>
        <a class="nav-item" href="#historyTitle">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m9 10 5-3v10l-5-3z"/></svg>
          Meetings
        </a>
        <span class="nav-item disabled" aria-disabled="true">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>
          Calendar <span class="soon-badge">Soon</span>
        </span>
        <span class="nav-item disabled" aria-disabled="true">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.8M18 15a4 4 0 0 1 2.5 4"/></svg>
          Contacts <span class="soon-badge">Soon</span>
        </span>
        <span class="nav-item disabled" aria-disabled="true">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/></svg>
          Recordings <span class="soon-badge">Soon</span>
        </span>
        <a class="nav-item" href="/account#profile">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>
          Settings
        </a>
      </nav>
      <div class="sidebar-footer">
        <button class="sign-out" id="logoutButton" type="button">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M14 8l4 4-4 4M8 12h10"/></svg>
          Sign out
        </button>
      </div>
    </aside>
    <div class="main-column">
      <header class="topbar">
        <button class="sidebar-toggle" id="sidebarToggle" type="button" aria-controls="sidebar" aria-expanded="false">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
          <span class="sr-only">Open navigation</span>
        </button>
        <a class="mobile-brand" href="/dashboard" aria-label="BillionTalks dashboard"><img src="${logoUrl}" alt="BillionTalks"></a>
        <div class="search-shell" aria-disabled="true">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
          <span>Search meetings</span>
          <span class="header-soon">Coming soon</span>
        </div>
        <div class="account-summary">
          <span class="notification" aria-label="Notifications coming soon" title="Notifications coming soon">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>
          </span>
          <span class="avatar" id="identityAvatar" aria-hidden="true">BT</span>
          <span class="account-copy">
            <strong id="identityName">Loading account...</strong>
            <span id="identityEmail"></span>
          </span>
        </div>
      </header>
      <div class="dashboard">
        <section class="welcome" aria-labelledby="dashboardTitle">
          <div>
            <h1 id="dashboardTitle">Welcome back, <span id="welcomeName">there</span></h1>
            <p>Your meeting workspace is ready when you are.</p>
          </div>
          <div class="local-time" aria-live="polite">
            <strong id="localDate"></strong>
            <span id="localTime"></span>
          </div>
        </section>
        <div id="error" role="alert"></div>
        <section class="meeting-actions" aria-label="Meeting actions">
          <form class="action-card start-card" id="startMeetingForm">
            <div class="action-heading">
              <div>
                <div class="action-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3z"/></svg></div>
                <h2>Start Meeting</h2>
              </div>
            </div>
            <p>Create a private room and invite guests with its meeting ID.</p>
            <label class="sr-only" for="meetingTitle">Meeting title</label>
            <label class="sr-only" for="accessMode">Guest access</label>
            <div class="action-control">
              <input id="meetingTitle" name="title" required maxlength="120" placeholder="Meeting title">
              <select id="accessMode" name="accessMode" aria-label="Guest access">
                <option value="HOST_APPROVAL">Approve</option>
                <option value="OPEN">Open</option>
                <option value="LOCKED">Locked</option>
              </select>
              <button class="action-button" type="submit">Start now</button>
            </div>
          </form>
          <form class="action-card join-card" id="joinMeetingForm">
            <div class="action-heading">
              <div>
                <div class="action-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4M14 8l4 4-4 4M8 12h10"/></svg></div>
                <h2>Join Meeting</h2>
              </div>
            </div>
            <p>Enter a meeting ID from your host. Guest joining remains available.</p>
            <label class="sr-only" for="meetingId">Meeting ID</label>
            <div class="action-control">
              <input id="meetingId" name="meetingId" required pattern="btm_[A-Za-z0-9_-]{8,64}" placeholder="btm_...">
              <button class="action-button" type="submit">Join now</button>
            </div>
          </form>
          <article class="action-card schedule-card">
            <div class="action-heading">
              <div>
                <div class="action-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M12 14v4M10 16h4"/></svg></div>
                <h2>Schedule Meeting</h2>
              </div>
            </div>
            <p>Plan future conversations and send invitations from your workspace.</p>
            <a class="disabled-action" href="/schedule">Preview scheduler</a>
          </article>
        </section>
        <div class="content-grid">
          <div class="left-column">
            <section class="panel" aria-labelledby="nextMeetingTitle">
              <div class="panel-heading"><h2 id="nextMeetingTitle">Next Meeting</h2><span class="panel-meta">Schedule unavailable</span></div>
              <div class="next-empty">
                <span class="empty-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg></span>
                <div><strong>No scheduled meeting data</strong><p>Scheduling arrives in a future release. Start or join a live meeting above.</p></div>
              </div>
            </section>
            <section class="panel" aria-labelledby="upcomingTitle">
              <div class="panel-heading"><h2 id="upcomingTitle">Upcoming Meetings</h2><span class="panel-meta">Coming soon</span></div>
              <div class="tabs" aria-disabled="true">
                <span class="tab active">Today</span><span class="tab">Tomorrow</span><span class="tab">This Week</span><span class="tab">Later</span>
              </div>
              <div class="unavailable">Upcoming meeting filters will be available when scheduling is supported.</div>
            </section>
            <section class="panel" aria-labelledby="historyTitle">
              <div class="panel-heading"><h2 id="historyTitle">Recent Meetings</h2><span class="panel-meta">Private to your account</span></div>
              <div class="history-list" id="historyList"><div class="empty">Loading your meeting history...</div></div>
            </section>
          </div>
          <div class="right-column">
            <section class="panel" aria-labelledby="calendarTitle">
              <div class="panel-heading"><h2 id="calendarTitle">Calendar</h2><span class="panel-meta">Read only</span></div>
              <div class="calendar-top"><strong id="calendarMonth"></strong><span class="calendar-tag">Scheduling soon</span></div>
              <div class="calendar-grid" id="calendarGrid" aria-label="Current month calendar"></div>
            </section>
            <section class="panel" aria-labelledby="quickActionsTitle">
              <div class="panel-heading"><h2 id="quickActionsTitle">Quick Actions</h2></div>
              <div class="quick-list">
                <div class="quick-item" aria-disabled="true">
                  <span class="quick-item-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.8M18 15a4 4 0 0 1 2.5 4"/></svg></span>
                  <span><strong>Contacts</strong><span>Coming soon</span></span>
                </div>
                <a class="quick-item" href="/account#profile">
                  <span class="quick-item-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></span>
                  <span><strong>Account Settings</strong><span>Manage your profile</span></span>
                  <span class="arrow" aria-hidden="true">›</span>
                </a>
              </div>
            </section>
          </div>
        </div>
        <section class="stats-grid" aria-label="Meeting statistics">
          <article class="stat-card stat-blue"><span>Total Meetings</span><strong id="totalMeetings">—</strong><small>Authorized meeting history</small></article>
          <article class="stat-card stat-green"><span>Total Participants</span><strong>Unavailable</strong><small>History does not expose participant totals</small></article>
          <article class="stat-card stat-purple"><span>Total Meeting Time</span><strong>Unavailable</strong><small>Reliable attendance duration is not available</small></article>
          <article class="stat-card stat-orange"><span>Meetings This Month</span><strong id="monthlyMeetings">—</strong><small>Based on your local calendar month</small></article>
        </section>
      </div>
    </div>
  </main>
  <script>
    (() => {
      'use strict';
      const error = document.getElementById('error');
      const historyList = document.getElementById('historyList');
      const sidebar = document.getElementById('sidebar');
      const sidebarToggle = document.getElementById('sidebarToggle');
      sidebarToggle.addEventListener('click', () => {
        const open = sidebar.classList.toggle('open');
        sidebarToggle.setAttribute('aria-expanded', String(open));
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
      function renderClock(now) {
        document.getElementById('localDate').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(now);
        document.getElementById('localTime').textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(now);
      }
      function renderCalendar(now) {
        const year = now.getFullYear();
        const month = now.getMonth();
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const previousMonthDays = new Date(year, month, 0).getDate();
        document.getElementById('calendarMonth').textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(now);
        const cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => '<span class="day-name">' + day + '</span>');
        for (let index = firstDay - 1; index >= 0; index -= 1) cells.push('<span class="outside">' + (previousMonthDays - index) + '</span>');
        for (let day = 1; day <= daysInMonth; day += 1) cells.push('<span' + (day === now.getDate() ? ' class="today" aria-current="date"' : '') + '>' + day + '</span>');
        let followingDay = 1;
        while ((cells.length - 7) % 7 !== 0) cells.push('<span class="outside">' + followingDay++ + '</span>');
        document.getElementById('calendarGrid').innerHTML = cells.join('');
      }
      function renderHistory(entries) {
        const now = new Date();
        const monthlyMeetings = entries.filter((entry) => {
          const createdAt = new Date(entry.createdAt);
          return !Number.isNaN(createdAt.getTime()) && createdAt.getFullYear() === now.getFullYear() && createdAt.getMonth() === now.getMonth();
        }).length;
        document.getElementById('totalMeetings').textContent = String(entries.length);
        document.getElementById('monthlyMeetings').textContent = String(monthlyMeetings);
        if (!entries.length) {
          historyList.innerHTML = '<div class="empty">No meetings yet. Start your first room above.</div>';
          return;
        }
        historyList.innerHTML = entries.slice(0, 6).map((entry) => '<article class="meeting"><div><strong>' + escapeHtml(entry.title) + '</strong><small>' + escapeHtml(new Date(entry.createdAt).toLocaleString()) + ' · ' + escapeHtml(entry.meetingId) + '</small></div><a href="/?meeting=' + encodeURIComponent(entry.meetingId) + '">Open room</a><span class="status">' + escapeHtml(entry.status) + '</span></article>').join('');
      }
      document.getElementById('startMeetingForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        showError('');
        const form = event.currentTarget;
        try {
          const data = await api('/api/meetings', { method: 'POST', body: JSON.stringify({ title: form.title.value.trim(), accessMode: form.accessMode.value }) });
          window.location.href = '/?meeting=' + encodeURIComponent(data.id);
        } catch (failure) {
          showError(failure instanceof Error ? failure.message : 'Unable to start the meeting.');
        }
      });
      document.getElementById('joinMeetingForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const meetingId = event.currentTarget.meetingId.value.trim();
        if (event.currentTarget.reportValidity()) window.location.href = '/?meeting=' + encodeURIComponent(meetingId);
      });
      document.getElementById('logoutButton').addEventListener('click', async () => {
        try {
          await api('/api/accounts/logout', { method: 'POST', body: '{}' });
          window.location.href = '/account#login';
        } catch (failure) {
          showError(failure instanceof Error ? failure.message : 'Unable to sign out.');
        }
      });
      renderClock(new Date());
      renderCalendar(new Date());
      window.setInterval(() => renderClock(new Date()), 60000);
      (async () => {
        try {
          const account = await api('/api/accounts/me');
          const fullName = account.account.fullName;
          const firstName = fullName.trim().split(/\\s+/)[0] || 'there';
          const initials = fullName.trim().split(/\\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || 'BT';
          document.getElementById('identityName').textContent = fullName;
          document.getElementById('identityEmail').textContent = account.account.email;
          document.getElementById('identityAvatar').textContent = initials;
          document.getElementById('welcomeName').textContent = firstName;
          renderHistory(await api('/api/meetings/history'));
        } catch (failure) {
          showError(failure instanceof Error ? failure.message : 'Unable to load your dashboard.');
        }
      })();
    })();
  </script>
</body>
</html>`;
}
