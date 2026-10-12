import logoSource from "../assets/brand/billiontalks-logo.png";

function logoDataUrl(source: string | ArrayBuffer): string {
  if (typeof source === "string") return source;
  const bytes = new Uint8Array(source);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

export function calendarPage(): string {
  const logoUrl = logoDataUrl(logoSource);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Calendar · BillionTalks</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4f7fc; color: #17233c; }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; min-height: 100vh; background: linear-gradient(135deg, #f7faff 0%, #edf3fb 100%); }
    a, button, input, select { font: inherit; }
    a { color: inherit; text-decoration: none; }
    button { cursor: pointer; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .app-shell { display: grid; grid-template-columns: 224px minmax(0, 1fr); min-height: 100vh; }
    .sidebar { position: sticky; top: 0; z-index: 20; display: flex; flex-direction: column; height: 100vh; padding: 25px 15px 20px; overflow: hidden; background: linear-gradient(155deg, #071d49 0%, #0b3d88 58%, #176fd2 100%); border-right: 1px solid #153f79; box-shadow: 12px 0 34px rgba(7, 29, 73, .14); }
    .sidebar::before { content: ""; position: absolute; width: 270px; height: 270px; right: -178px; bottom: -102px; border: 1px solid rgba(255,255,255,.18); border-radius: 50%; box-shadow: 0 0 0 30px rgba(255,255,255,.045), 0 0 0 66px rgba(255,255,255,.025); }
    .sidebar::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(120deg, transparent 15%, rgba(85,185,255,.08) 48%, transparent 72%); }
    .sidebar > * { position: relative; z-index: 1; }
    .logo-link { display: inline-flex; align-items: center; width: 172px; max-width: 100%; margin: 0 6px 35px; padding: 8px 10px; border: 1px solid rgba(255,255,255,.22); border-radius: 12px; background: #f9fbff; box-shadow: 0 12px 28px rgba(3,21,54,.3); }
    .logo-link img { display: block; width: 100%; height: auto; }
    .nav-label { margin: 0 12px 10px; color: #9fc6f2; font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    .side-nav { display: grid; gap: 7px; }
    .nav-item, .sign-out { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 43px; padding: 10px 13px; border: 0; border-radius: 11px; background: transparent; color: #dbeafe; font-size: 13px; font-weight: 700; text-align: left; }
    .nav-item svg, .sign-out svg { width: 18px; height: 18px; flex: 0 0 auto; }
    .nav-item.active, .nav-item:hover, .nav-item:focus-visible, .sign-out:hover, .sign-out:focus-visible { color: #fff; background: linear-gradient(135deg, #176fd2, #318ff0); outline: none; box-shadow: 0 9px 20px rgba(3,21,54,.2); }
    .sidebar-footer { margin-top: auto; border-top: 1px solid rgba(255,255,255,.17); padding-top: 13px; }
    .main-column { min-width: 0; }
    .topbar { display: grid; grid-template-columns: minmax(220px, 1fr) auto; align-items: center; gap: 24px; min-height: 82px; padding: 15px clamp(24px, 4vw, 56px); border-bottom: 1px solid #e7edf5; background: rgba(255,255,255,.84); }
    .sidebar-toggle, .mobile-brand { display: none; }
    .search-shell { display: flex; align-items: center; gap: 10px; max-width: 430px; min-height: 42px; padding: 0 13px; border: 1px solid #e4eaf2; border-radius: 11px; background: #f8faff; color: #9aa6b6; font-size: 12px; }
    .search-shell svg { width: 16px; height: 16px; }
    .header-soon { margin-left: auto; color: #b0bac8; font-size: 9px; font-weight: 800; text-transform: uppercase; }
    .account-summary { display: flex; align-items: center; gap: 10px; }
    .avatar { display: grid; place-items: center; width: 40px; height: 40px; border: 2px solid #fff; border-radius: 13px; background: linear-gradient(135deg, #dcecff, #b9d7ff); box-shadow: 0 4px 12px #2c69b01c; color: #2669c2; font-size: 12px; font-weight: 850; }
    .account-copy strong, .account-copy span { display: block; }
    .account-copy strong { max-width: 220px; overflow: hidden; color: #34445d; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .account-copy span { margin-top: 3px; color: #95a1b1; font-size: 9px; }
    .workspace { max-width: 1480px; margin: auto; padding: 35px clamp(20px, 4vw, 56px) 52px; }
    .heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
    .eyebrow { margin: 0 0 8px; color: #5084ca; font-size: 10px; font-weight: 850; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 0; color: #172b4d; font-size: clamp(27px, 3vw, 36px); letter-spacing: -.045em; }
    .heading p { margin: 8px 0 0; color: #71819a; font-size: 13px; }
    .panel { min-width: 0; padding: 22px; border: 1px solid #e4eaf2; border-radius: 16px; background: #fff; box-shadow: 0 10px 28px rgba(30,59,101,.055); }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 19px; }
    .toolbar button, .toolbar select, .timezone-control select { min-height: 38px; padding: 8px 12px; border: 1px solid #dfe7f1; border-radius: 9px; background: #fff; color: #40536f; font-size: 12px; font-weight: 700; }
    .toolbar button:hover, .toolbar button:focus-visible, .toolbar select:focus-visible, .timezone-control select:focus-visible { outline: 3px solid #318aff33; border-color: #318aff; }
    .toolbar .primary { border-color: #176fd2; background: linear-gradient(135deg, #176fd2, #318ff0); color: #fff; }
    .toolbar .spacer { flex: 1 1 auto; }
    .toolbar .period { min-width: 230px; color: #263b5b; font-size: 17px; font-weight: 800; text-align: center; letter-spacing: -.02em; }
    .view-switch { display: inline-flex; gap: 3px; padding: 3px; border: 1px solid #e3eaf3; border-radius: 10px; background: #f7f9fd; }
    .view-switch button { min-height: 30px; padding: 5px 9px; border: 0; background: transparent; font-size: 11px; }
    .view-switch button[aria-pressed="true"] { background: #fff; color: #176fd2; box-shadow: 0 2px 8px #1a376018; }
    .timezone-control { display: flex; align-items: center; gap: 9px; margin: 0 0 18px; color: #74839a; font-size: 11px; font-weight: 750; }
    .timezone-control select { min-width: min(300px, 100%); color: #344967; }
    .timezone-hint { color: #9aa6b6; font-size: 10px; font-weight: 500; }
    .error { display: none; margin-bottom: 15px; padding: 12px 14px; border: 1px solid #f2cad2; border-radius: 10px; background: #fff2f4; color: #a52e4b; font-size: 12px; }
    .error:not(:empty) { display: block; }
    .loading, .empty { padding: 27px 14px; color: #8996a9; font-size: 12px; text-align: center; }
    .month-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid #edf1f6; border-left: 1px solid #edf1f6; }
    .weekday { padding: 10px 6px; color: #8291a7; font-size: 10px; font-weight: 850; text-align: center; text-transform: uppercase; }
    .month-day { min-width: 0; min-height: 116px; padding: 8px; border: 0; border-top: 1px solid #edf1f6; border-right: 1px solid #edf1f6; background: #fff; text-align: left; }
    .month-day:hover, .month-day:focus-visible { position: relative; z-index: 1; outline: 2px solid #6aa6f3; outline-offset: -2px; background: #f7faff; }
    .month-day.outside { background: #fafbfd; color: #adb8c6; }
    .month-day.selected { box-shadow: inset 0 0 0 2px #6aa6f3; background: #f5f9ff; }
    .day-number { display: inline-grid; place-items: center; width: 27px; height: 27px; border-radius: 9px; color: #4e5f78; font-size: 11px; font-weight: 750; }
    .month-day.today .day-number { background: #2f7dea; color: #fff; }
    .event-chip { display: block; width: 100%; margin-top: 5px; padding: 4px 6px; overflow: hidden; border: 0; border-left: 3px solid #3184e8; border-radius: 5px; background: #edf5ff; color: #36577f; font-size: 9px; font-weight: 700; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
    .event-chip[data-status="CANCELLED"] { border-color: #aab3c1; background: #f0f2f5; color: #7b8797; text-decoration: line-through; }
    .event-chip[data-status="ENDED"] { border-color: #32a879; background: #edf9f4; }
    .event-chip[data-status="STARTED"], .event-chip[data-status="STARTING"] { border-color: #7352d1; background: #f4f0ff; }
    .more-events { display: block; margin-top: 5px; color: #8492a6; font-size: 9px; }
    .selected-day { margin-top: 21px; padding-top: 17px; border-top: 1px solid #edf1f6; }
    .selected-day h2, .day-heading { margin: 0 0 12px; color: #35445c; font-size: 15px; }
    .event-list { display: grid; gap: 9px; }
    .event-card { min-width: 0; padding: 13px 14px; border: 1px solid #e7ecf3; border-left: 3px solid #3184e8; border-radius: 11px; background: #fbfcfe; }
    .event-card[data-status="CANCELLED"] { border-left-color: #aab3c1; }
    .event-card[data-status="ENDED"] { border-left-color: #32a879; }
    .event-card[data-status="STARTED"], .event-card[data-status="STARTING"] { border-left-color: #7352d1; }
    .event-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .event-card h3 { margin: 0; color: #30435f; font-size: 13px; }
    .event-card p { margin: 7px 0 0; color: #74839a; font-size: 11px; line-height: 1.55; overflow-wrap: anywhere; }
    .event-time { margin-top: 5px; color: #72839b; font-size: 10px; }
    .event-time .source-zone { color: #9aa6b6; }
    .status { flex: 0 0 auto; padding: 4px 7px; border-radius: 999px; background: #edf5ff; color: #3172ca; font-size: 8px; font-weight: 850; letter-spacing: .04em; text-transform: uppercase; }
    .status[data-status="CANCELLED"] { background: #f0f2f5; color: #778294; }
    .status[data-status="ENDED"] { background: #e9f8f2; color: #23765b; }
    .status[data-status="STARTED"], .status[data-status="STARTING"] { background: #f2edff; color: #6848c0; }
    .manage-link { display: inline-block; margin-top: 10px; color: #2873df; font-size: 10px; font-weight: 800; }
    .week-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid #edf1f6; border-left: 1px solid #edf1f6; }
    .week-day { min-width: 0; min-height: 230px; padding: 10px 8px; border: 0; border-top: 0; border-right: 1px solid #edf1f6; border-bottom: 1px solid #edf1f6; background: #fff; text-align: left; }
    .week-day:hover, .week-day:focus-visible { outline: 2px solid #6aa6f3; outline-offset: -2px; background: #f8fbff; }
    .week-day.selected { background: #f4f8ff; }
    .week-day-head { display: flex; align-items: center; justify-content: space-between; gap: 5px; margin-bottom: 9px; color: #40536f; font-size: 10px; font-weight: 800; }
    .week-day .event-chip { white-space: normal; line-height: 1.35; }
    .day-view { display: grid; gap: 9px; }
    [hidden] { display: none !important; }
    @media (max-width: 980px) {
      .topbar { padding-inline: 25px; }
      .workspace { padding-inline: 25px; }
      .month-day { min-height: 97px; padding: 6px; }
      .week-day { min-height: 200px; padding: 8px 5px; }
    }
    @media (max-width: 820px) {
      .app-shell { display: block; }
      .sidebar { position: fixed; left: 0; transform: translateX(-105%); width: 224px; transition: transform .2s ease; box-shadow: 16px 0 40px rgba(22,44,79,.16); }
      .sidebar.open { transform: translateX(0); }
      .topbar { grid-template-columns: auto minmax(0, 1fr) auto; min-height: 70px; padding: 12px 20px; }
      .sidebar-toggle { display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; color: #52637b; }
      .sidebar-toggle svg { width: 19px; height: 19px; }
      .mobile-brand { display: inline-flex; width: 143px; }
      .mobile-brand img { width: 100%; height: auto; }
      .search-shell { display: none; }
      .account-copy { display: none; }
      .workspace { padding: 29px 20px 38px; }
    }
    @media (max-width: 680px) {
      .workspace { padding: 22px 14px 30px; }
      .heading { display: block; }
      .toolbar { gap: 7px; }
      .toolbar .period { order: -1; flex: 1 1 100%; min-width: 0; text-align: left; }
      .toolbar .spacer { display: none; }
      .timezone-control { align-items: flex-start; flex-direction: column; }
      .timezone-control select { width: 100%; }
      .panel { padding: 14px; }
      .month-grid { grid-template-columns: repeat(7, minmax(0, 1fr)); }
      .weekday { padding: 8px 2px; font-size: 8px; }
      .month-day { min-height: 70px; padding: 3px; }
      .day-number { width: 23px; height: 23px; font-size: 10px; }
      .event-chip { margin-top: 3px; padding: 3px 2px; border-left-width: 2px; font-size: 7px; }
      .month-day .event-chip:nth-of-type(n+3) { display: none; }
      .more-events { font-size: 7px; }
      .week-grid { grid-template-columns: 1fr; }
      .week-day { min-height: 0; padding: 11px; border-left: 0; }
      .week-day-head { font-size: 12px; }
      .week-day .event-chip { font-size: 10px; }
    }
    @media (max-width: 360px) {
      .topbar { padding-inline: 10px; }
      .mobile-brand { width: 112px; }
      .avatar { width: 36px; height: 36px; }
      .toolbar button { padding-inline: 8px; }
      .view-switch button { padding-inline: 6px; }
      .month-day { min-height: 62px; }
    }
  </style>
</head>
<body>
  <main class="app-shell">
    <aside class="sidebar" id="sidebar">
      <a class="logo-link" href="/dashboard" aria-label="BillionTalks dashboard"><img src="${logoUrl}" alt="BillionTalks"></a>
      <div class="nav-label">Workspace</div>
      <nav class="side-nav" aria-label="Workspace navigation">
        <a class="nav-item" href="/dashboard"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>Dashboard</a>
        <a class="nav-item" href="/schedule"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m9 10 5-3v10l-5-3z"/></svg>Meetings</a>
        <a class="nav-item active" href="/calendar" aria-current="page"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>Calendar</a>
        <a class="nav-item" href="/contacts"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.8M18 15a4 4 0 0 1 2.5 4"/></svg>Contacts</a>
        <span class="nav-item" aria-disabled="true"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>Recordings</span>
        <a class="nav-item" href="/account#profile"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>Settings</a>
      </nav>
      <div class="sidebar-footer"><button class="sign-out" id="logoutButton" type="button"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M14 8l4 4-4 4M8 12h10"/></svg>Sign out</button></div>
    </aside>
    <div class="main-column">
      <header class="topbar">
        <button class="sidebar-toggle" id="sidebarToggle" type="button" aria-controls="sidebar" aria-expanded="false"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span class="sr-only">Open navigation</span></button>
        <a class="mobile-brand" href="/dashboard" aria-label="BillionTalks dashboard"><img src="${logoUrl}" alt="BillionTalks"></a>
        <div class="search-shell" aria-disabled="true"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><span>Search meetings</span><span class="header-soon">Workspace</span></div>
        <div class="account-summary"><span class="avatar" id="identityAvatar" aria-hidden="true">BT</span><span class="account-copy"><strong id="identityName">Loading account...</strong><span id="identityEmail"></span></span></div>
      </header>
      <section class="workspace" aria-labelledby="calendarTitle">
        <div class="heading"><div><p class="eyebrow">Your workspace</p><h1 id="calendarTitle">Calendar</h1><p>See your scheduled meetings in the time zone you choose.</p></div></div>
        <div id="calendarError" class="error" role="alert" aria-live="assertive"></div>
        <section class="panel" aria-label="Meeting calendar">
          <div class="toolbar" aria-label="Calendar navigation">
            <button id="previousPeriod" type="button" aria-label="Previous period">‹</button>
            <button id="nextPeriod" type="button" aria-label="Next period">›</button>
            <button id="todayButton" class="primary" type="button">Today</button>
            <strong id="periodLabel" class="period" aria-live="polite"></strong>
            <span class="spacer"></span>
            <div class="view-switch" role="group" aria-label="Calendar view">
              <button type="button" data-view="month" aria-pressed="true">Month</button>
              <button type="button" data-view="week" aria-pressed="false">Week</button>
              <button type="button" data-view="day" aria-pressed="false">Day</button>
            </div>
          </div>
          <label class="timezone-control" for="timeZoneSelect">Display time zone
            <select id="timeZoneSelect" aria-describedby="timeZoneHint"></select>
            <span class="timezone-hint" id="timeZoneHint">Your choice is kept for this browser session.</span>
          </label>
          <div id="calendarStatus" class="loading" role="status" aria-live="polite">Loading your scheduled meetings…</div>
          <div id="calendarContent" hidden>
            <div id="monthView" class="month-grid" role="grid" aria-label="Month view"></div>
            <div id="weekView" class="week-grid" role="grid" aria-label="Week view" hidden></div>
            <section id="dayView" class="day-view" aria-label="Day view" hidden></section>
            <section id="selectedDay" class="selected-day" aria-live="polite"></section>
          </div>
        </section>
      </section>
    </div>
  </main>
  <script>
    (() => {
      'use strict';
      const byId = (id) => document.getElementById(id);
      const status = byId('calendarStatus');
      const content = byId('calendarContent');
      const error = byId('calendarError');
      const timeZoneSelect = byId('timeZoneSelect');
      const state = { view: 'month', date: '', selectedDate: '', timeZone: '', meetings: [], invitations: [] };
      const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
      const pad = (value) => String(value).padStart(2, '0');
      function validZone(zone) {
        try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date()); return true; } catch { return false; }
      }
      function dateKeyInZone(instant, zone) {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
        const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        return values.year + '-' + values.month + '-' + values.day;
      }
      function addDays(key, amount) {
        const [year, month, day] = key.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day + amount));
        return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
      }
      function zoneToday(zone) { return dateKeyInZone(new Date(), zone); }
      function utcDate(key) { return new Date(key + 'T12:00:00Z'); }
      function dateLabel(key, options = {}) { return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(utcDate(key)); }
      function timeLabel(instant) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: state.timeZone }).format(new Date(instant)); }
      function dayMeetings(key) { return state.meetings.filter((meeting) => dateKeyInZone(meeting.startsAt, state.timeZone) === key).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)); }
      function monthDates(key) {
        const [year, month] = key.split('-').map(Number);
        const first = year + '-' + pad(month) + '-01';
        const weekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
        const start = addDays(first, -weekday);
        return Array.from({ length: 42 }, (_, index) => addDays(start, index));
      }
      function weekDates(key) {
        const [year, month, day] = key.split('-').map(Number);
        const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
        const start = addDays(key, -weekday);
        return Array.from({ length: 7 }, (_, index) => addDays(start, index));
      }
      function periodLabel() {
        if (state.view === 'month') return dateLabel(state.date, { month: 'long', year: 'numeric' });
        if (state.view === 'day') return dateLabel(state.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        const days = weekDates(state.date);
        const first = dateLabel(days[0], { month: 'short', day: 'numeric' });
        const last = dateLabel(days[6], { month: 'short', day: 'numeric', year: 'numeric' });
        return first + ' – ' + last;
      }
      function renderMeetingCard(meeting) {
        const sourceZone = meeting.timeZone && meeting.timeZone !== state.timeZone ? ' · scheduled in ' + meeting.timeZone : '';
        const invites = state.invitations.filter((invitation) => invitation.meetingId === meeting.id);
        const invitationStatus = invites.length
          ? '<p>' + invites.length + ' invitee' + (invites.length === 1 ? '' : 's') + ': ' +
            ['ACCEPTED', 'DECLINED', 'PENDING'].map((value) => {
              const count = invites.filter((invitation) => invitation.status === value).length;
              return count ? count + ' ' + value.toLowerCase() : '';
            }).filter(Boolean).join(' · ') + '</p>'
          : '<p>No invitations sent.</p>';
        return '<article class="event-card" data-status="' + escapeHtml(meeting.status) + '">' +
          '<div class="event-card-top"><div><h3>' + escapeHtml(meeting.title) + '</h3><div class="event-time">' + escapeHtml(timeLabel(meeting.startsAt)) + '<span class="source-zone">' + escapeHtml(sourceZone) + '</span></div></div>' +
          '<span class="status" data-status="' + escapeHtml(meeting.status) + '">' + escapeHtml(meeting.status.toLowerCase().replace('_', ' ')) + '</span></div>' +
          (meeting.agenda ? '<p>' + escapeHtml(meeting.agenda) + '</p>' : '') +
          invitationStatus +
          '<a class="manage-link" href="/schedule?meeting=' + encodeURIComponent(meeting.id) + '">View meeting details and manage</a> · ' +
          '<a class="manage-link" href="/contacts?meeting=' + encodeURIComponent(meeting.id) + '">Manage invitations</a></article>';
      }
      function renderMonth() {
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name) => '<div class="weekday" role="columnheader">' + name + '</div>');
        const currentMonth = state.date.slice(0, 7);
        const today = zoneToday(state.timeZone);
        const cells = monthDates(state.date).map((key) => {
          const meetings = dayMeetings(key);
          const classes = ['month-day'];
          if (key.slice(0, 7) !== currentMonth) classes.push('outside');
          if (key === today) classes.push('today');
          if (key === state.selectedDate) classes.push('selected');
          const chips = meetings.slice(0, 2).map((meeting) => '<span class="event-chip" data-status="' + escapeHtml(meeting.status) + '" title="' + escapeHtml(meeting.title + ' · ' + timeLabel(meeting.startsAt)) + '">' + escapeHtml(timeLabel(meeting.startsAt) + ' ' + meeting.title) + '</span>').join('');
          const more = meetings.length > 2 ? '<span class="more-events">+' + (meetings.length - 2) + ' more</span>' : '';
          return '<button class="' + classes.join(' ') + '" type="button" role="gridcell" data-date="' + key + '" aria-label="' + escapeHtml(dateLabel(key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ', ' + meetings.length + ' meetings') + '" aria-pressed="' + (key === state.selectedDate) + '"><span class="day-number">' + Number(key.slice(-2)) + '</span>' + chips + more + '</button>';
        });
        byId('monthView').innerHTML = weekdays.join('') + cells.join('');
      }
      function renderWeek() {
        const today = zoneToday(state.timeZone);
        byId('weekView').innerHTML = weekDates(state.date).map((key) => {
          const meetings = dayMeetings(key);
          const classes = ['week-day'];
          if (key === state.selectedDate) classes.push('selected');
          const chips = meetings.length ? meetings.map((meeting) => '<span class="event-chip" data-status="' + escapeHtml(meeting.status) + '">' + escapeHtml(timeLabel(meeting.startsAt) + ' · ' + meeting.title) + '</span>').join('') : '<span class="empty">No meetings</span>';
          return '<button class="' + classes.join(' ') + (key === today ? ' today' : '') + '" type="button" data-date="' + key + '" aria-pressed="' + (key === state.selectedDate) + '"><span class="week-day-head">' + escapeHtml(dateLabel(key, { weekday: 'short', month: 'short', day: 'numeric' })) + (key === today ? ' · Today' : '') + '</span>' + chips + '</button>';
        }).join('');
      }
      function renderDay() {
        const meetings = dayMeetings(state.date);
        byId('dayView').innerHTML = meetings.length
          ? meetings.map(renderMeetingCard).join('')
          : '<div class="empty">No scheduled meetings for this day.</div>';
      }
      function renderSelectedDay() {
        const meetings = dayMeetings(state.selectedDate);
        byId('selectedDay').innerHTML = '<h2>' + escapeHtml(dateLabel(state.selectedDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })) + '</h2>' +
          (meetings.length ? '<div class="event-list">' + meetings.map(renderMeetingCard).join('') + '</div>' : '<div class="empty">No meetings scheduled for this day.</div>');
      }
      function render() {
        byId('periodLabel').textContent = periodLabel();
        byId('monthView').hidden = state.view !== 'month';
        byId('weekView').hidden = state.view !== 'week';
        byId('dayView').hidden = state.view !== 'day';
        byId('selectedDay').hidden = state.view === 'day';
        document.querySelectorAll('[data-view]').forEach((button) => {
          button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
        });
        renderMonth();
        renderWeek();
        renderDay();
        renderSelectedDay();
      }
      async function loadCalendar() {
        status.hidden = false;
        status.className = 'loading';
        status.textContent = 'Loading your scheduled meetings…';
        content.hidden = true;
        error.textContent = '';
        try {
          const [schedulesResponse, invitationsResponse] = await Promise.all([
            fetch('/api/schedules', { credentials: 'same-origin', headers: { Accept: 'application/json' } }),
            fetch('/api/invitations', { credentials: 'same-origin', headers: { Accept: 'application/json' } }),
          ]);
          const [payload, invitationPayload] = await Promise.all([schedulesResponse.json(), invitationsResponse.json()]);
          if (schedulesResponse.status === 401 || invitationsResponse.status === 401) { window.location.href = '/account#login'; throw new Error('Sign in to view your calendar.'); }
          if (!schedulesResponse.ok || !payload.ok || !Array.isArray(payload.data)) throw new Error(payload.error || 'Unable to load your scheduled meetings.');
          if (!invitationsResponse.ok || !invitationPayload.ok || !Array.isArray(invitationPayload.data)) throw new Error(invitationPayload.error || 'Unable to load invitation status.');
          state.meetings = payload.data.filter((meeting) => meeting && typeof meeting.id === 'string' && typeof meeting.startsAt === 'string' && Number.isFinite(Date.parse(meeting.startsAt)));
          state.invitations = invitationPayload.data;
          status.hidden = true;
          content.hidden = false;
          render();
        } catch (failure) {
          status.hidden = false;
          status.className = 'empty';
          status.textContent = 'Your calendar could not be loaded.';
          error.textContent = failure instanceof Error ? failure.message : 'Unable to load your scheduled meetings.';
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.className = 'primary';
          retry.textContent = 'Try again';
          retry.addEventListener('click', loadCalendar, { once: true });
          status.append(' ', retry);
        }
      }
      function movePeriod(amount) {
        if (state.view === 'month') {
          const [year, month] = state.date.split('-').map(Number);
          const date = new Date(Date.UTC(year, month - 1 + amount, 1));
          state.date = date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-01';
        } else state.date = addDays(state.date, amount * (state.view === 'week' ? 7 : 1));
        state.selectedDate = state.date;
        render();
      }
      function setTimeZone(zone) {
        if (!validZone(zone)) return;
        state.timeZone = zone;
        sessionStorage.setItem('bt-calendar-time-zone', zone);
        timeZoneSelect.value = zone;
        render();
      }
      function initZones() {
        const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        let saved = '';
        try { saved = sessionStorage.getItem('bt-calendar-time-zone') || ''; } catch { saved = ''; }
        state.timeZone = validZone(saved) ? saved : (validZone(detected) ? detected : 'UTC');
        let zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
        zones = [...new Set([state.timeZone, detected, 'UTC', ...zones])].filter(validZone).sort((a, b) => a.localeCompare(b));
        if (!zones.includes(state.timeZone)) zones.unshift(state.timeZone);
        timeZoneSelect.innerHTML = zones.map((zone) => '<option value="' + escapeHtml(zone) + '">' + escapeHtml(zone) + (zone === detected ? ' · device' : '') + '</option>').join('');
        timeZoneSelect.value = state.timeZone;
        state.date = zoneToday(state.timeZone);
        state.selectedDate = state.date;
      }
      async function loadIdentity() {
        try {
          const response = await fetch('/api/accounts/me', { credentials: 'same-origin' });
          const payload = await response.json();
          if (response.status === 401) { window.location.href = '/account#login'; return; }
          const account = payload.data && payload.data.account;
          if (payload.ok && account) {
            byId('identityName').textContent = account.fullName || 'Your account';
            byId('identityEmail').textContent = account.email || '';
            byId('identityAvatar').textContent = String(account.fullName || account.email || 'BT').slice(0, 2).toUpperCase();
          }
        } catch { byId('identityName').textContent = 'Your account'; }
      }
      byId('previousPeriod').addEventListener('click', () => movePeriod(-1));
      byId('nextPeriod').addEventListener('click', () => movePeriod(1));
      byId('todayButton').addEventListener('click', () => { state.date = zoneToday(state.timeZone); state.selectedDate = state.date; render(); });
      document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { state.view = button.dataset.view; render(); }));
      byId('monthView').addEventListener('click', (event) => {
        const target = event.target.closest('[data-date]');
        if (!target) return;
        state.date = target.dataset.date;
        state.selectedDate = target.dataset.date;
        render();
      });
      byId('weekView').addEventListener('click', (event) => {
        const target = event.target.closest('[data-date]');
        if (!target) return;
        state.date = target.dataset.date;
        state.selectedDate = target.dataset.date;
        state.view = 'day';
        render();
      });
      timeZoneSelect.addEventListener('change', () => setTimeZone(timeZoneSelect.value));
      const sidebar = byId('sidebar');
      byId('sidebarToggle').addEventListener('click', (event) => {
        const open = sidebar.classList.toggle('open');
        event.currentTarget.setAttribute('aria-expanded', String(open));
      });
      byId('logoutButton').addEventListener('click', async () => {
        try {
          const response = await fetch('/api/accounts/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to sign out.');
          window.location.href = '/account#login';
        } catch (failure) { error.textContent = failure instanceof Error ? failure.message : 'Unable to sign out.'; }
      });
      initZones();
      void loadIdentity();
      void loadCalendar();
    })();
  </script>
</body>
</html>`;
}
