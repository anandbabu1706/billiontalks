import logoSource from "./assets/brand/billiontalks-logo.png";

/** Presentation only: retain the meeting controller, IDs and media geometry. */
export function meetingLogo(): string {
  if (typeof logoSource === "string") return logoSource;
  let binary = "";
  for (const byte of new Uint8Array(logoSource)) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

export const meetingAppearance = `
:root {
  color-scheme: light;
  --bg: #f3f7ff; --panel: #fff; --panel-strong: #fff; --panel-soft: #edf3ff;
  --text: #10214e; --muted: #596b8c; --primary: #175cff; --primary-strong: #267dff;
  --success: #008662; --warning: #946000; --danger: #c42c45;
  --border: #dce6fa; --shadow: 0 18px 48px rgba(40,76,140,.08);
}
html, body { background: #f3f7ff; }
body { background: radial-gradient(ellipse at 100% 0, #e5edff, transparent 48%), radial-gradient(ellipse at 0 100%, #e5edff, transparent 40%), #f6f9ff; }
.app-shell { width: min(1640px,100%); padding: 0 32px 32px; }
.topbar { min-height: 86px; margin: 0 -32px 24px; padding: 16px 32px; background: #fff; border-bottom: 1px solid var(--border); gap: 12px; }
.brand { display: inline-flex; width: 190px; max-width: 48%; }
.brand img { display: block; width: 100%; height: auto; }
.status-pill { background: #eff4ff; color: #1755c7; font-size: 13px; }
.home-card { max-width: 940px; margin: clamp(24px,8vh,100px) auto 0; padding: clamp(24px,4vw,56px); position: relative; background: radial-gradient(ellipse at 100% 100%,#f0eeff,transparent 35%),#fff; }
#homeScreen .home-card { max-width: 1180px; }
#joinScreen .home-card, #endedScreen .home-card { max-width: 820px; }
h1, h2 { color: #10214e; font-size: clamp(28px,3.2vw,46px); letter-spacing: -.035em; line-height: 1.15; margin-bottom: 20px; }
h3 { font-size: 23px; }
.home-card p { line-height: 1.65; font-size: 17px; }
.kicker { color: #3759bc; font-size: 12px; }
.hero { grid-template-columns: minmax(0,1.35fr) minmax(0,1fr); align-items: stretch; gap: 32px; }
.hero > div { min-width: 0; }
.hero .info-box { padding: 28px; background: linear-gradient(140deg,#f5f8ff,#eef4ff); }
#homeScreen .actions { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 14px; margin-top: 28px; }
#homeScreen .actions a { justify-content: center; text-align: center; text-decoration: none; font-weight: 600; }
.actions button, .actions a { min-height: 48px; display: inline-flex; align-items: center; justify-content: center; }
.primary { background: linear-gradient(110deg,#1454ef,#2785ff); box-shadow: 0 5px 12px #195ee81c; }
.secondary, .ghost { background: #fff; color: #15346e; border-color: #cdddf9; }
button, a, input, select { -webkit-tap-highlight-color: transparent; }
button:disabled { cursor: not-allowed; opacity: .55; transform: none; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, [tabindex]:focus-visible { outline: 3px solid #175cff; outline-offset: 3px; }
input, select, #meetingAccessMode { background: #fff; color: var(--text); border: 1px solid #cdddf9; font: inherit; border-radius: 12px; padding: 12px 14px; max-width: 100%; }
input::placeholder { color: #657797; opacity: 1; }
input[type=checkbox] { width: auto; accent-color: #175cff; }
label { font-size: 14px; }
.chip.ok { background: #e5f8f1; color: #00684f; border-color: #bce8d9; }
.meeting-shell { background: transparent; border: 0; box-shadow: none; overflow: visible; min-height: 0; grid-template-columns: minmax(0,1fr) 350px; gap: 18px; align-items: start; }
.stage-panel { padding: 0; min-width: 0; gap: 16px; }
.meeting-header { background: #fff; padding: 20px; box-shadow: var(--shadow); gap: 16px; flex-wrap: wrap; }
.meeting-header > div { min-width: 0; }
.meeting-header strong { overflow-wrap: anywhere; }
.meeting-id { background: #f8faff; border-color: var(--border); font-size: 12px; max-width: 100%; overflow-wrap: anywhere; }
.media-status, #mediaStatus[data-connection-state] { background: #eff4ff; color: #37517f; border-color: #d4e0f7; }
.video-stage { background: #fff; border-color: var(--border); box-shadow: var(--shadow); }
.tile, .tile.self { background: radial-gradient(ellipse at center,#f4f7ff,#dce7fa); color: #223f77; }
.tile .placeholder, .tile.self.camera-off .placeholder { color: #284779; background: #ffffffd9; border-color: #cdddf9; box-shadow: none; }
.error, .media-status.error { color: #a1263e; }
.tile .meta { background: #152342d9; color: #fff; }
.controls { background: #fff; border: 1px solid var(--border); border-radius: 18px; padding: 18px 12px 34px; gap: 24px; box-shadow: var(--shadow); }
.control { width: 52px; height: 52px; background: #edf3ff; color: #175cff; flex-shrink: 0; }
.control::after { content: attr(aria-label); position: absolute; top: calc(100% + 7px); font: 11px/1.2 Inter,"Segoe UI",sans-serif; color: #27416e; white-space: nowrap; }
.control.active { background: #dff5ed; color: #006c50; border-color: #bce7d7; }
.control.off { background: #f0f3f9; color: #4d5c78; border-color: #c7d2e6; }
.control.danger { background: #ffe5e9; border-color: #ffcbd4; color: #b3223c; }
.side-panel { padding: 0; background: transparent; border: 0; min-width: 0; display: grid; gap: 16px; }
.participants-card, .recording-panel, #admissionPanel, .chat-panel { padding: 20px; border: 1px solid var(--border); border-radius: 18px; background: #fff; box-shadow: var(--shadow); margin-top: 0 !important; min-width: 0; }
.side-panel .kicker { color: #10214e; text-transform: none; letter-spacing: 0; font-size: 16px; font-weight: 700; }
.participant-list li { background: #f8faff; gap: 8px; overflow-wrap: anywhere; flex-wrap: wrap; }
.recording-controls { flex-wrap: wrap; }
#meetingAccessMode { width: 100%; margin-bottom: 10px; }
#applyAccessModeBtn { margin-bottom: 10px; }
.chat-form input { background: #f7f9fe; }
.chat-form button, #startRecordingBtn { background: #175cff; color: #fff; }
.limited-release-notice { color: #815000; }
#endedScreen .home-card { text-align: center; }
#endedScreen .info-box { background: transparent; border: 0; padding: 0; color: var(--muted); }
#endedScreen .actions { justify-content: center; }
#returnHomeBtn { min-width: 220px; }
.ended-symbol { display: grid; place-items: center; width: 84px; height: 84px; margin: 0 auto 28px; background: #edf3ff; color: #175cff; border-radius: 24px; font-size: 36px; }
@media (max-width: 1100px) { .meeting-shell { grid-template-columns: minmax(0,1fr) 300px; } .controls { gap: 20px; } }
@media (max-width: 980px) { .hero, .meeting-shell { grid-template-columns: minmax(0,1fr); } .side-panel { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@media (max-width: 600px) {
 .app-shell { padding: 0 12px 24px; } .topbar { margin: 0 -12px 18px; padding: 14px 16px; min-height: 72px; } .brand { width: 155px; }
 .home-card { margin-top: 24px; padding: 24px 20px; border-radius: 18px; } .home-card p { font-size: 15px; }
 .side-panel { grid-template-columns: minmax(0,1fr); } .meeting-header { padding: 16px; }
 .hero .info-box { padding: 20px; } #homeScreen .actions { grid-template-columns: minmax(0,1fr); }
 .controls { gap: 32px 24px; padding-bottom: 34px; } .actions button { flex: 1 1 auto; }
}
/* Display density: fit V0 screens and the live room at 100% zoom on laptop/desktop; phone rules above are unchanged. */
@media (min-width: 601px) {
 .app-shell { padding: 0 24px 24px; }
 .topbar { min-height: 66px; margin: 0 -24px 18px; padding: 10px 24px; }
 .brand { width: 172px; }
 .home-card { margin-top: clamp(12px,4vh,48px); padding: clamp(22px,3vw,40px); }
 h1, h2 { font-size: clamp(26px,2.6vw,38px); margin-bottom: 14px; }
 h3 { font-size: 20px; margin-bottom: 10px; }
 .home-card p { font-size: 16px; line-height: 1.6; }
 .hero { gap: 24px; }
 .hero .info-box { padding: 22px; }
 .actions { margin-top: 18px; }
 #homeScreen .actions { gap: 12px; margin-top: 22px; }
 .actions button, .actions a { min-height: 44px; }
 .input-group { margin-top: 16px; }
 .device-status { margin-top: 12px; }
 .history-section { margin-top: 20px; padding-top: 14px; }
 .meeting-shell { gap: 16px; }
 .stage-panel, .side-panel { gap: 12px; }
 .meeting-header { padding: 13px 18px; gap: 12px; }
 .video-stage { min-height: clamp(340px, calc(100vh - 330px), 500px); }
 .controls { padding: 12px 12px 30px; gap: 24px 20px; }
 .participants-card, .recording-panel, #admissionPanel, .chat-panel { padding: 16px 18px; }
 .participant-list { margin-top: 12px; gap: 8px; }
 .participant-list li { padding: 8px 11px; }
 .ended-symbol { width: 72px; height: 72px; margin-bottom: 20px; font-size: 32px; }
 .registration-shell { margin-top: 16px; }
 .registration-aside { min-height: 560px; padding: 32px 30px; }
 .registration-aside h1 { margin: 48px 0 14px; }
 .registration-form-panel { padding: 30px 36px; }
 .registration-subtitle { margin-bottom: 18px; }
 .registration-form, .registration-fields { gap: 12px; }
}
.video-stage[data-participant-count]:not(.presentation-active) { align-content: stretch; grid-auto-rows: minmax(180px,1fr); }
.video-stage[data-participant-count]:not(.presentation-active) .tile { min-width: 0; }
.video-stage[data-participant-count="1"]:not(.presentation-active) { grid-template-columns: minmax(0,1fr); }
.video-stage[data-participant-count="2"]:not(.presentation-active),
.video-stage[data-participant-count="4"]:not(.presentation-active) { grid-template-columns: repeat(2,minmax(0,1fr)); }
.video-stage[data-participant-count="3"]:not(.presentation-active) { grid-template-columns: repeat(3,minmax(0,1fr)); }
@media (max-width: 1100px) {
 .video-stage[data-participant-count="3"]:not(.presentation-active) { grid-template-columns: repeat(2,minmax(0,1fr)); }
 .video-stage[data-participant-count="3"]:not(.presentation-active) .tile:last-child { grid-column: 1 / -1; }
}
@media (max-width: 720px) {
 .video-stage[data-participant-count]:not(.presentation-active) { grid-auto-rows: minmax(140px,1fr); }
}
@media (prefers-reduced-motion: reduce) { button { transition: none; } button:hover { transform: none; } }
`;
