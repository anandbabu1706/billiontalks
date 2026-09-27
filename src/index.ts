import { validateRealtimeEnv, type RealtimeEnv } from "./config";
import {
  CloudflareMediaProvider,
  DurableMeetingRepository,
  InMemoryMeetingRepository,
  MeetingAccessMode,
  MeetingService,
  NullMediaProvider,
  type Meeting,
  type MeetingRepository,
} from "./meeting";
import { CloudflareRealtimeConnectionClient } from "./realtime";

type DurableObjectStateLike = {
  storage: {
    get: <T>(key: string) => Promise<T | undefined>;
    put: (key: string, value: unknown) => Promise<void>;
  };
};

const DurableObjectBase: new (...args: any[]) => object =
  (globalThis as typeof globalThis & { DurableObject?: new (...args: any[]) => object }).DurableObject ??
  class {
    constructor() {}
  };

export class MeetingStateDurableObject extends DurableObjectBase {
  constructor(ctx: DurableObjectStateLike, env: unknown) {
    super(ctx, env);
  }

  async saveMeeting(meeting: Meeting): Promise<void> {
    const ctx = (this as any).ctx as { storage?: { put: (key: string, value: unknown) => Promise<void> } } | undefined;

    if (!ctx?.storage) {
      return;
    }

    await ctx.storage.put("meeting", meeting);
  }

  async getMeeting(): Promise<Meeting | undefined> {
    const ctx = (this as any).ctx as { storage?: { get: <T>(key: string) => Promise<T | undefined> } } | undefined;

    if (!ctx?.storage) {
      return undefined;
    }

    return (await ctx.storage.get<Meeting>("meeting")) ?? undefined;
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function resolveMeetingRepository(env: Partial<RealtimeEnv> = {}): MeetingRepository {
  if (!env.MEETING_STORE) {
    throw new Error(
      "MEETING_STORE Durable Object binding is required. Configure wrangler.jsonc and deploy with the MeetingStateDurableObject binding before using persisted meetings.",
    );
  }

  return new DurableMeetingRepository(env.MEETING_STORE as any);
}

function getMeetingService(env: Partial<RealtimeEnv> = {}): MeetingService {
  const mediaProvider =
    env.REALTIME_SFU_APP_ID && env.REALTIME_SFU_BEARER_TOKEN
      ? new CloudflareMediaProvider(env.REALTIME_SFU_APP_ID, env.REALTIME_SFU_BEARER_TOKEN)
      : new NullMediaProvider();

  return new MeetingService(resolveMeetingRepository(env), mediaProvider);
}

function parseJsonBody<T>(request: Request): Promise<T | null> {
  return request.json().catch(() => null) as Promise<T | null>;
}

function meetingUiHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BillionTalks V0</title>
    <style>
      :root {
        --bg: #0b1020;
        --panel: rgba(15, 23, 42, 0.8);
        --panel-strong: #111827;
        --panel-soft: #172033;
        --text: #e5eefb;
        --muted: #9aa8c7;
        --primary: #7c9cff;
        --primary-strong: #4f75ff;
        --success: #3ddc97;
        --warning: #fbbf24;
        --danger: #f87171;
        --border: rgba(148, 163, 184, 0.25);
        --shadow: 0 18px 40px rgba(15, 23, 42, 0.35);
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        min-height: 100%;
        background: radial-gradient(circle at top, #1b2540 0%, var(--bg) 48%);
        color: var(--text);
        font-family: Inter, "Segoe UI", sans-serif;
      }
      body {
        min-height: 100vh;
        display: flex;
        justify-content: center;
        align-items: stretch;
      }
      .app-shell {
        width: min(1420px, 100%);
        padding: 24px;
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      }
      .brand {
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #dfe9ff;
      }
      .status-pill {
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(15, 23, 42, 0.7);
        color: var(--muted);
        font-size: 12px;
      }
      .screen {
        display: none;
      }
      .screen.visible {
        display: block;
      }
      .home-card,
      .panel,
      .meeting-shell {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 20px;
        box-shadow: var(--shadow);
      }
      .home-card {
        max-width: 760px;
        margin: 48px auto 0;
        padding: 36px;
      }
      h1, h2, h3, p { margin-top: 0; }
      .kicker {
        color: var(--primary);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 12px;
        font-weight: 700;
        margin-bottom: 10px;
      }
      .hero {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 28px;
      }
      .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 20px;
      }
      button, input {
        font: inherit;
      }
      button {
        border: none;
        border-radius: 12px;
        cursor: pointer;
        transition: transform 0.2s ease, opacity 0.2s ease;
      }
      button:hover { transform: translateY(-1px); }
      .primary {
        background: linear-gradient(135deg, var(--primary), var(--primary-strong));
        color: white;
        padding: 12px 18px;
        font-weight: 700;
      }
      .secondary {
        background: rgba(148, 163, 184, 0.12);
        color: var(--text);
        padding: 12px 18px;
        border: 1px solid var(--border);
      }
      .ghost {
        background: transparent;
        color: var(--text);
        border: 1px solid var(--border);
        padding: 10px 12px;
      }
      .input-group {
        margin-top: 20px;
      }
      label {
        display: block;
        color: var(--muted);
        margin-bottom: 8px;
        font-size: 13px;
      }
      input {
        width: 100%;
        padding: 12px 14px;
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.7);
        border: 1px solid var(--border);
        color: var(--text);
      }
      .info-box {
        padding: 18px;
        border-radius: 16px;
        background: rgba(124, 156, 255, 0.08);
        border: 1px solid rgba(124, 156, 255, 0.2);
      }
      .form-grid {
        display: grid;
        gap: 16px;
      }
      .meeting-shell {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 320px;
        min-height: 780px;
        overflow: hidden;
      }
      .stage-panel {
        padding: 16px 16px 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .video-stage {
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.7), rgba(30, 41, 59, 0.9));
        border: 1px solid var(--border);
        border-radius: 18px;
        min-height: 500px;
        display: grid;
        grid-template-columns: repeat(2, minmax(160px, 1fr));
        gap: 12px;
        padding: 12px;
      }
      .tile {
        position: relative;
        border-radius: 18px;
        background: linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(51, 65, 85, 0.95));
        border: 1px solid var(--border);
        min-height: 180px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        color: var(--text);
      }
      .tile .placeholder {
        font-weight: 700;
        letter-spacing: 0.04em;
        opacity: 0.8;
      }
      .tile .meta {
        position: absolute;
        left: 10px;
        bottom: 10px;
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(15, 23, 42, 0.65);
        border-radius: 999px;
        padding: 5px 8px;
        font-size: 12px;
      }
      .tile.self {
        background: linear-gradient(135deg, rgba(79, 117, 255, 0.38), rgba(51, 65, 85, 0.96));
      }
      .side-panel {
        border-left: 1px solid var(--border);
        background: rgba(10, 16, 28, 0.75);
        padding: 16px;
      }
      .participant-list {
        list-style: none;
        padding: 0;
        margin: 18px 0 0;
        display: grid;
        gap: 10px;
      }
      .participant-list li {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(148, 163, 184, 0.06);
        border: 1px solid var(--border);
      }
      .dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--success);
      }
      .controls {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: center;
        padding: 12px 0 4px;
      }
      .control {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        border: 1px solid var(--border);
        background: rgba(148, 163, 184, 0.12);
        color: var(--text);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        position: relative;
      }
      .control .device-icon {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .control .device-icon::after {
        content: "";
        position: absolute;
        left: 8%;
        right: 8%;
        top: 50%;
        height: 2px;
        background: currentColor;
        transform: translateY(-50%) rotate(-45deg);
        opacity: 0;
      }
      .control.active {
        background: rgba(61, 220, 151, 0.18);
        border-color: rgba(61, 220, 151, 0.45);
        color: #dfffee;
      }
      .control.off {
        background: rgba(15, 23, 42, 0.7);
        border-color: rgba(148, 163, 184, 0.5);
        color: #f8fafc;
      }
      .control.off .device-icon::after {
        opacity: 1;
      }
      .control.danger {
        background: rgba(248, 113, 113, 0.16);
        border-color: rgba(248, 113, 113, 0.45);
      }
      .dev-toggle {
        padding: 8px 12px;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(15, 23, 42, 0.7);
        color: var(--muted);
      }
      .dev-panel {
        display: none;
        margin: 0 0 16px;
        border: 1px solid rgba(124, 156, 255, 0.35);
        border-radius: 16px;
        background: rgba(17, 24, 39, 0.8);
        box-shadow: var(--shadow);
        overflow: hidden;
      }
      .dev-panel.visible {
        display: block;
      }
      .dev-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.25);
        background: rgba(124, 156, 255, 0.08);
        font-size: 12px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #dfe9ff;
      }
      .dev-panel-content {
        padding: 14px;
      }
      .dev-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 10px;
      }
      .dev-grid button {
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: rgba(148, 163, 184, 0.08);
        color: var(--text);
        text-align: left;
      }
      .dev-note {
        margin-top: 12px;
        font-size: 12px;
        color: var(--muted);
      }
      .meeting-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px 14px;
      }
      .meeting-header strong { font-size: 18px; }
      .meeting-id {
        background: rgba(124, 156, 255, 0.12);
        border: 1px solid rgba(124, 156, 255, 0.3);
        border-radius: 10px;
        padding: 8px 10px;
        color: var(--text);
        font-family: "SFMono-Regular", ui-monospace, monospace;
      }
      .muted { color: var(--muted); }
      .error {
        color: #fdd2d2;
        background: rgba(248, 113, 113, 0.08);
        border: 1px solid rgba(248, 113, 113, 0.35);
        border-radius: 10px;
        padding: 10px 12px;
        margin-top: 12px;
      }
      .device-status {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 16px;
      }
      .chip {
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(148, 163, 184, 0.06);
        font-size: 12px;
        color: var(--muted);
      }
      .chip.ok {
        border-color: rgba(61, 220, 151, 0.5);
        color: var(--success);
      }
      @media (max-width: 980px) {
        .hero, .meeting-shell {
          grid-template-columns: 1fr;
        }
        .side-panel {
          border-left: none;
          border-top: 1px solid var(--border);
        }
        .video-stage {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="app-shell">
      <div class="topbar">
        <div class="brand">BillionTalks</div>
        <div style="display:flex; align-items:center; gap:10px;">
          <button class="dev-toggle" id="toggleDevPanelBtn" type="button">Dev tools</button>
          <div class="status-pill" id="statusPill">V0 Meeting UI</div>
        </div>
      </div>

      <div class="dev-panel" id="devPanel" aria-label="Development testing panel">
        <div class="dev-panel-header">
          <span>Development testing</span>
          <span class="muted" style="font-size:10px; letter-spacing:0.08em;">Local UI only</span>
        </div>
        <div class="dev-panel-content">
          <div class="dev-grid">
            <button type="button" data-dev-action="addParticipant">Add participant</button>
            <button type="button" data-dev-action="removeParticipant">Remove participant</button>
            <button type="button" data-dev-action="hostView">Host UI</button>
            <button type="button" data-dev-action="participantView">Participant UI</button>
            <button type="button" data-dev-action="participantLeave">Participant left</button>
            <button type="button" data-dev-action="meetingEnded">Meeting ended</button>
            <button type="button" data-dev-action="micOff">Mic off</button>
            <button type="button" data-dev-action="cameraOff">Camera off</button>
            <button type="button" data-dev-action="showGrid">Participant grid</button>
          </div>
          <div style="margin-top:12px; display:flex; flex-direction:column; gap:6px;">
            <label for="devParticipantSelect" style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:var(--muted);">Remove selected participant</label>
            <select id="devParticipantSelect" style="width:100%; border-radius:10px; background:rgba(15,23,42,0.7); color:var(--text); border:1px solid var(--border); padding:10px 12px;">
              <option value="">Select a participant</option>
            </select>
          </div>
          <div class="dev-note">This panel is for local development simulation only. It does not create real audio/video connections.</div>
        </div>
      </div>

      <section id="homeScreen" class="screen visible">
        <div class="home-card">
          <div class="kicker">Meeting foundation</div>
          <div class="hero">
            <div>
              <h1>Start or join a meeting</h1>
              <p class="muted">Create a new BillionTalks room or join by Meeting ID. This interface stays separate from the Cloudflare media provider and only uses the BT meeting API layer.</p>
              <div class="actions">
                <button class="primary" id="startMeetingBtn">Start Meeting</button>
                <button class="secondary" id="joinMeetingBtn">Join Meeting</button>
              </div>
            </div>
            <div class="info-box">
              <h3>Local UI state</h3>
              <p class="muted">Microphone and camera toggles are local device controls only until the real SFU connection is available.</p>
              <div class="device-status">
                <span class="chip ok">Mic ready</span>
                <span class="chip ok">Camera ready</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="createScreen" class="screen">
        <div class="home-card">
          <div class="kicker">Create meeting</div>
          <h2>Set up a new room</h2>
          <div class="form-grid">
            <div class="input-group">
              <label for="meetingTitle">Meeting title</label>
              <input id="meetingTitle" type="text" placeholder="Sprint review" />
            </div>
            <div class="input-group">
              <label for="hostName">Your name</label>
              <input id="hostName" type="text" placeholder="Alex" />
            </div>
            <div class="actions">
              <button class="primary" id="createMeetingButton">Create Meeting</button>
              <button class="secondary" id="backToHomeFromCreate">Back</button>
            </div>
          </div>
        </div>
      </section>

      <section id="joinScreen" class="screen">
        <div class="home-card">
          <div class="kicker">Join meeting</div>
          <h2>Use a Meeting ID</h2>
          <div class="form-grid">
            <div class="input-group">
              <label for="meetingIdInput">Meeting ID</label>
              <input id="meetingIdInput" type="text" placeholder="btm_..." />
            </div>
            <div class="actions">
              <button class="primary" id="resolveMeetingButton">Resolve Meeting</button>
              <button class="secondary" id="backToHomeFromJoin">Back</button>
            </div>
          </div>
        </div>
      </section>

      <section id="prejoinScreen" class="screen">
        <div class="home-card">
          <div class="kicker">Pre-join</div>
          <h2 id="prejoinTitle">Ready to join</h2>
          <div class="form-grid">
            <div class="input-group">
              <label for="displayNameInput">Display name</label>
              <input id="displayNameInput" type="text" placeholder="Your name" />
            </div>
            <div class="device-status">
              <button class="secondary" id="toggleMicBtn">Mic: On</button>
              <button class="secondary" id="toggleCameraBtn">Camera: On</button>
            </div>
            <div class="actions">
              <button class="primary" id="joinNowButton">Join Now</button>
              <button class="secondary" id="backToHomeFromPrejoin">Cancel</button>
            </div>
          </div>
        </div>
      </section>

      <section id="meetingScreen" class="screen">
        <div class="meeting-shell">
          <div class="stage-panel">
            <div class="meeting-header">
              <div>
                <div class="kicker" style="margin:0;">Meeting room</div>
                <strong id="meetingTitleText">Meeting</strong>
              </div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span class="meeting-id" id="meetingIdBadge">Loading...</span>
                <button class="ghost" id="copyMeetingIdBtn">Copy ID</button>
              </div>
            </div>

            <div class="video-stage" id="videoStage">
              <div class="tile self">
                <div class="placeholder" id="localTileLabel">You</div>
                <div class="meta"><span class="dot"></span><span id="localStatusLabel">Mic on</span></div>
              </div>
              <div class="tile">
                <div class="placeholder">Guest</div>
                <div class="meta"><span class="dot"></span><span>Waiting</span></div>
              </div>
              <div class="tile">
                <div class="placeholder">Guest</div>
                <div class="meta"><span class="dot"></span><span>Waiting</span></div>
              </div>
              <div class="tile">
                <div class="placeholder">Guest</div>
                <div class="meta"><span class="dot"></span><span>Waiting</span></div>
              </div>
            </div>

            <div class="controls" id="meetingControls">
              <button class="control active" id="micControlBtn" title="Microphone">🎙️</button>
              <button class="control active" id="cameraControlBtn" title="Camera">📷</button>
              <button class="control" id="shareScreenBtn" title="Screen share">🖥️</button>
              <button class="control" id="participantsBtn" title="Participants">👥</button>
              <button class="control danger" id="leaveMeetingBtn" title="Leave">✕</button>
              <button class="control danger" id="endMeetingBtn" title="End meeting">⏹️</button>
            </div>
          </div>

          <aside class="side-panel">
            <div class="kicker">Participants</div>
            <ul class="participant-list" id="participantList"></ul>
            <div id="admissionPanel" style="margin-top: 18px; display:none;">
              <div class="kicker">Admission</div>
              <div id="admissionModeLabel" class="muted" style="margin-bottom: 10px;">Host approval</div>
              <div id="pendingAdmissionsList" class="participant-list" style="margin-top: 8px;"></div>
              <div class="actions" style="margin-top: 12px;">
                <button class="secondary" id="requestAdmissionBtn" type="button">Request to join</button>
                <button class="ghost" id="refreshAdmissionsBtn" type="button">Refresh</button>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section id="endedScreen" class="screen">
        <div class="home-card">
          <div class="kicker">Session ended</div>
          <h2 id="endedTitle">The meeting has ended.</h2>
          <div class="info-box">
            <p id="endedMessage">The host ended the room or the connection was interrupted.</p>
          </div>
          <div class="actions" style="margin-top: 18px;">
            <button class="primary" id="returnHomeBtn">Return home</button>
          </div>
        </div>
      </section>

      <div id="errorBanner"></div>
    </div>

    <script>
      const state = {
        route: 'home',
        meetingId: '',
        meeting: null,
        displayName: '',
        currentUserId: '',
        isHost: false,
        admissionStatus: '',
        localDevice: {
          micEnabled: true,
          cameraEnabled: true,
          screenShareEnabled: false,
          micAvailable: true,
          cameraAvailable: true,
        },
        error: null,
      };

      const screens = {
        home: document.getElementById('homeScreen'),
        create: document.getElementById('createScreen'),
        join: document.getElementById('joinScreen'),
        prejoin: document.getElementById('prejoinScreen'),
        meeting: document.getElementById('meetingScreen'),
        ended: document.getElementById('endedScreen'),
      };

      const statusPill = document.getElementById('statusPill');
      const errorBanner = document.getElementById('errorBanner');

      function setError(message) {
        state.error = message;
        if (message) {
          if (errorBanner) {
            errorBanner.textContent = message;
            errorBanner.className = 'error';
          }
        } else if (errorBanner) {
          errorBanner.textContent = '';
          errorBanner.className = '';
        }
      }

      function showScreen(name) {
        state.route = name;
        Object.entries(screens).forEach(([key, node]) => {
          if (node) {
            node.classList.toggle('visible', key === name);
          }
        });

        if (statusPill) {
          if (name === 'meeting') {
            statusPill.textContent = 'In meeting';
          } else if (name === 'prejoin') {
            statusPill.textContent = 'Pre-join';
          } else if (name === 'home' || name === 'create' || name === 'join') {
            statusPill.textContent = 'V0 Meeting UI';
          } else if (name === 'ended') {
            statusPill.textContent = 'Ended';
          }
        }
      }

      function createLocalMediaState() {
        return {
          micStream: null,
          cameraStream: null,
          micRequestInFlight: false,
          cameraRequestInFlight: false,
        };
      }

      function startLocalMediaStream(mediaState, device, stream) {
        const nextState = stopLocalMediaStream(mediaState, device);

        if (device === 'mic') {
          return {
            ...nextState,
            micStream: stream,
            micRequestInFlight: false,
          };
        }

        return {
          ...nextState,
          cameraStream: stream,
          cameraRequestInFlight: false,
        };
      }

      function stopLocalMediaStream(mediaState, device) {
        const stream = device === 'mic' ? mediaState.micStream : mediaState.cameraStream;

        if (stream) {
          stream.getTracks().forEach((track) => {
            if (track.readyState !== 'ended') {
              try {
                track.stop();
              } catch {
                // Ignore stop failures; the stale ref is still cleared.
              }
            }
          });
        }

        if (device === 'mic') {
          return {
            ...mediaState,
            micStream: null,
            micRequestInFlight: false,
          };
        }

        return {
          ...mediaState,
          cameraStream: null,
          cameraRequestInFlight: false,
        };
      }

      function removeSelectedDevParticipant(currentState, participantId) {
        if (!currentState.meeting || !participantId) {
          return currentState;
        }

        const nextParticipants = currentState.meeting.participants.filter((participant) => participant.id !== participantId);
        if (nextParticipants.length === currentState.meeting.participants.length) {
          return currentState;
        }

        return {
          ...currentState,
          meeting: {
            ...currentState.meeting,
            participants: nextParticipants,
          },
        };
      }

      const localMediaState = createLocalMediaState();

      function renderLocalState() {
        const micBtn = document.getElementById('toggleMicBtn');
        const cameraBtn = document.getElementById('toggleCameraBtn');
        const micControl = document.getElementById('micControlBtn');
        const cameraControl = document.getElementById('cameraControlBtn');
        const shareControl = document.getElementById('shareScreenBtn');
        const localStatusLabel = document.getElementById('localStatusLabel');

        const micIsOn = state.localDevice.micEnabled && state.localDevice.micAvailable;
        const cameraIsOn = state.localDevice.cameraEnabled && state.localDevice.cameraAvailable;

        if (micControl) {
          micControl.classList.toggle('active', micIsOn);
          micControl.classList.toggle('off', !micIsOn);
          micControl.innerHTML = '<span class="device-icon">🎙️</span>';
        }

        if (cameraControl) {
          cameraControl.classList.toggle('active', cameraIsOn);
          cameraControl.classList.toggle('off', !cameraIsOn);
          cameraControl.innerHTML = '<span class="device-icon">📷</span>';
        }

        if (shareControl) {
          shareControl.classList.toggle('active', state.localDevice.screenShareEnabled);
        }

        const micStatus = state.localDevice.micAvailable ? (micIsOn ? 'Mic on' : 'Mic off') : 'Microphone unavailable';
        const cameraStatus = state.localDevice.cameraAvailable ? (cameraIsOn ? 'Camera on' : 'Camera off') : 'Camera unavailable';
        if (localStatusLabel) {
          localStatusLabel.textContent = micStatus + ' • ' + cameraStatus;
        }

        if (micBtn) {
          micBtn.textContent = state.localDevice.micAvailable ? 'Mic: ' + (micIsOn ? 'On' : 'Off') : 'Mic: Unavailable';
        }
        if (cameraBtn) {
          cameraBtn.textContent = state.localDevice.cameraAvailable ? 'Camera: ' + (cameraIsOn ? 'On' : 'Off') : 'Camera: Unavailable';
        }

        syncLocalCameraPreview();
      }

      function syncLocalCameraPreview() {
        const selfTile = document.querySelector('.tile.self');
        if (!selfTile) {
          return;
        }

        const existingPreview = selfTile.querySelector('video.local-preview');
        if (existingPreview) {
          existingPreview.remove();
        }

        const placeholder = selfTile.querySelector('.placeholder');
        if (placeholder) {
          placeholder.style.display = 'block';
          placeholder.textContent = 'You';
        }

        if (!state.localDevice.cameraAvailable || !state.localDevice.cameraEnabled || !localMediaState.cameraStream) {
          if (placeholder) {
            placeholder.textContent = state.localDevice.cameraAvailable ? 'You' : 'Camera unavailable';
          }
          return;
        }

        const video = document.createElement('video');
        video.className = 'local-preview';
        video.srcObject = localMediaState.cameraStream;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        video.style.background = 'rgba(15, 23, 42, 0.7)';

        if (placeholder) {
          placeholder.style.display = 'none';
        }

        selfTile.appendChild(video);
        void video.play().catch(() => undefined);
      }

      function stopLocalMicrophone() {
        Object.assign(localMediaState, stopLocalMediaStream(localMediaState, 'mic'));
        state.localDevice.micEnabled = false;
        renderLocalState();
      }

      function stopLocalCamera() {
        Object.assign(localMediaState, stopLocalMediaStream(localMediaState, 'camera'));
        state.localDevice.cameraEnabled = false;
        renderLocalState();
      }

      function stopAllLocalMedia() {
        stopLocalMicrophone();
        stopLocalCamera();
      }

      async function toggleMicrophone() {
        if (state.localDevice.micEnabled && localMediaState.micStream) {
          stopLocalMicrophone();
          return;
        }

        if (state.localDevice.micAvailable === false || localMediaState.micRequestInFlight) {
          return;
        }

        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          state.localDevice.micAvailable = false;
          state.localDevice.micEnabled = false;
          renderLocalState();
          setError('This browser does not support microphone capture.');
          return;
        }

        try {
          localMediaState.micRequestInFlight = true;
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

          if (!stream.getAudioTracks().length) {
            throw new DOMException('No microphone device is available.', 'NotFoundError');
          }

          Object.assign(localMediaState, startLocalMediaStream(localMediaState, 'mic', stream));
          state.localDevice.micAvailable = true;
          state.localDevice.micEnabled = true;
          renderLocalState();
          setError(null);
        } catch (error) {
          state.localDevice.micEnabled = false;
          const name = error instanceof DOMException ? error.name : '';
          if (name === 'NotAllowedError' || name === 'AbortError' || name === 'NotFoundError') {
            state.localDevice.micAvailable = false;
            setError('Microphone unavailable or permission was denied.');
          } else if (error instanceof Error) {
            setError(error.message);
          } else {
            setError('Unable to start the microphone.');
          }
          renderLocalState();
        } finally {
          localMediaState.micRequestInFlight = false;
        }
      }

      async function toggleCamera() {
        if (state.localDevice.cameraEnabled && localMediaState.cameraStream) {
          stopLocalCamera();
          return;
        }

        if (state.localDevice.cameraAvailable === false || localMediaState.cameraRequestInFlight) {
          return;
        }

        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          state.localDevice.cameraAvailable = false;
          state.localDevice.cameraEnabled = false;
          renderLocalState();
          setError('This browser does not support camera capture.');
          return;
        }

        try {
          localMediaState.cameraRequestInFlight = true;
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

          if (!stream.getVideoTracks().length) {
            throw new DOMException('No camera device is available.', 'NotFoundError');
          }

          Object.assign(localMediaState, startLocalMediaStream(localMediaState, 'camera', stream));
          state.localDevice.cameraAvailable = true;
          state.localDevice.cameraEnabled = true;
          renderLocalState();
          setError(null);
        } catch (error) {
          state.localDevice.cameraEnabled = false;
          const name = error instanceof DOMException ? error.name : '';
          if (name === 'NotAllowedError' || name === 'AbortError' || name === 'NotFoundError') {
            state.localDevice.cameraAvailable = false;
            setError('Camera unavailable or permission was denied.');
          } else if (error instanceof Error) {
            setError(error.message);
          } else {
            setError('Unable to start the camera.');
          }
          renderLocalState();
        } finally {
          localMediaState.cameraRequestInFlight = false;
        }
      }

      function syncMeetingRoleUi() {
        const endMeetingBtn = document.getElementById('endMeetingBtn');
        const meetingIsHost = Boolean(state.meeting && state.currentUserId && state.meeting.hostId === state.currentUserId);

        state.isHost = meetingIsHost;

        if (endMeetingBtn) {
          endMeetingBtn.style.display = meetingIsHost ? 'flex' : 'none';
        }
      }

      let activeScreenShareStream = null;

      function clearScreenSharePreview() {
        const selfTile = document.querySelector('.tile.self');
        if (!selfTile) {
          return;
        }

        const preview = selfTile.querySelector('video');
        if (preview) {
          preview.remove();
        }

        const placeholder = selfTile.querySelector('.placeholder');
        if (placeholder) {
          placeholder.style.display = 'block';
          placeholder.textContent = 'You';
        }
      }

      function showScreenSharePreview(stream) {
        const selfTile = document.querySelector('.tile.self');
        if (!selfTile || !stream) {
          return;
        }

        clearScreenSharePreview();

        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        video.style.background = 'rgba(15, 23, 42, 0.7)';

        const placeholder = selfTile.querySelector('.placeholder');
        if (placeholder) {
          placeholder.style.display = 'none';
        }

        selfTile.appendChild(video);
        void video.play().catch(() => undefined);
      }

      function stopScreenShareCapture() {
        if (activeScreenShareStream) {
          activeScreenShareStream.getTracks().forEach((track) => {
            if (track.readyState !== 'ended') {
              track.stop();
            }
          });
          activeScreenShareStream = null;
        }

        state.localDevice.screenShareEnabled = false;
        clearScreenSharePreview();
        renderLocalState();
      }

      async function handleScreenShareToggle() {
        if (state.localDevice.screenShareEnabled) {
          stopScreenShareCapture();
          return;
        }

        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
          setError('This browser does not support native screen sharing.');
          return;
        }

        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });

          if (!stream) {
            throw new DOMException('No display stream was returned.', 'NotFoundError');
          }

          activeScreenShareStream = stream;
          state.localDevice.screenShareEnabled = true;
          showScreenSharePreview(stream);
          renderLocalState();
          setError(null);

          const handleStreamEnded = () => {
            if (state.localDevice.screenShareEnabled) {
              stopScreenShareCapture();
            }
          };

          stream.getTracks().forEach((track) => {
            track.addEventListener('ended', handleStreamEnded);
          });
        } catch (error) {
          const name = error instanceof DOMException ? error.name : '';

          if (name === 'NotAllowedError' || name === 'AbortError' || name === 'NotFoundError') {
            setError('Screen share was cancelled or permission was denied.');
          } else if (error instanceof Error) {
            setError(error.message);
          } else {
            setError('Unable to start screen sharing.');
          }

          if (state.localDevice.screenShareEnabled) {
            state.localDevice.screenShareEnabled = false;
            renderLocalState();
          }
        }
      }

      function createMockParticipants() {
        return [
          { id: 'demo-host', displayName: 'Host', role: 'HOST', state: 'JOINED' },
          { id: 'demo-guest-1', displayName: 'Ava', role: 'PARTICIPANT', state: 'JOINED' },
          { id: 'demo-guest-2', displayName: 'Sam', role: 'PARTICIPANT', state: 'PENDING' },
          { id: 'demo-guest-3', displayName: 'Priya', role: 'PARTICIPANT', state: 'JOINED' },
        ];
      }

      function applyDemoMeeting(overrides = {}) {
        state.meeting = {
          id: 'btm_dev_1234567890',
          title: 'Development Test Room',
          status: 'active',
          createdAt: new Date().toISOString(),
          hostId: 'host-dev',
          participants: createMockParticipants(),
          ...overrides,
        };
        state.meetingId = state.meeting.id;
        renderMeetingRoom();
        showScreen('meeting');
      }

      let selectedDevParticipantId = '';

      function syncDevParticipantSelection() {
        const select = document.getElementById('devParticipantSelect');
        if (!select || !state.meeting) {
          return;
        }

        const options = state.meeting.participants
          .filter((participant) => participant.role === 'PARTICIPANT' && participant.state !== 'LEFT')
          .map((participant) => ({
            id: participant.id,
            label: participant.displayName || participant.userId || participant.id,
          }));

        const currentSelection = selectedDevParticipantId;
        select.innerHTML = options.length
          ? '<option value="">Select a participant</option>' + options.map((option) => '<option value="' + option.id + '">' + option.label + '</option>').join('')
          : '<option value="">No participants</option>';

        if (currentSelection && options.some((option) => option.id === currentSelection)) {
          select.value = currentSelection;
          selectedDevParticipantId = currentSelection;
        } else {
          select.value = '';
          selectedDevParticipantId = '';
        }
      }

      function syncAdmissionPanel() {
        const panel = document.getElementById('admissionPanel');
        const modeLabel = document.getElementById('admissionModeLabel');
        const pendingList = document.getElementById('pendingAdmissionsList');
        const requestBtn = document.getElementById('requestAdmissionBtn');

        if (!panel || !state.meeting) {
          return;
        }

        const meetingMode = state.meeting.accessMode || 'HOST_APPROVAL';
        const isHost = Boolean(state.currentUserId && state.meeting.hostId === state.currentUserId);
        panel.style.display = isHost ? 'block' : 'none';

        if (requestBtn) {
          requestBtn.style.display = isHost || meetingMode !== 'HOST_APPROVAL' || state.admissionStatus === 'WAITING' ? 'none' : 'inline-flex';
        }

        if (modeLabel) {
          modeLabel.textContent = 'Access: ' + meetingMode;
        }

        if (!isHost || !pendingList) {
          return;
        }

        const pending = Array.isArray(state.meeting.accessRequests) ? state.meeting.accessRequests.filter((request) => request.status === 'WAITING') : [];

        if (!pending.length) {
          pendingList.innerHTML = '<li><span>No pending requests</span><span class="muted">0</span></li>';
          return;
        }

        pendingList.innerHTML = pending.map((request) => {
          return '<li><span>' + (request.displayName || request.userId) + '</span><span style="display:flex; gap:6px;"><button type="button" data-admission-action="approve" data-request-id="' + request.id + '" style="padding:4px 8px; border-radius:8px; background:rgba(61,220,151,0.16); color:#dfffee; border:1px solid rgba(61,220,151,0.35);">Approve</button><button type="button" data-admission-action="reject" data-request-id="' + request.id + '" style="padding:4px 8px; border-radius:8px; background:rgba(248,113,113,0.12); color:#fdd2d2; border:1px solid rgba(248,113,113,0.35);">Reject</button></span></li>';
        }).join('');

        pendingList.querySelectorAll('[data-admission-action]').forEach((button) => {
          button.addEventListener('click', async () => {
            const action = button.getAttribute('data-admission-action');
            const requestId = button.getAttribute('data-request-id');
            if (!requestId || !state.meetingId) {
              return;
            }

            const url = '/api/meetings/' + encodeURIComponent(state.meetingId) + '/admission/' + encodeURIComponent(requestId) + '/' + action;
            const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: state.currentUserId }) });
            const payload = await response.json();

            if (!response.ok || !payload.ok) {
              setError(payload.error || 'Unable to update a meeting admission request.');
              return;
            }

            const meetingResponse = await fetch('/api/meetings/' + encodeURIComponent(state.meetingId));
            const meetingPayload = await meetingResponse.json();
            if (meetingResponse.ok && meetingPayload.ok && meetingPayload.data) {
              state.meeting = meetingPayload.data;
              renderMeetingRoom();
            }
          });
        });
      }

      function renderMeetingRoom() {
        if (!state.meeting) {
          return;
        }

        const meetingTitleText = document.getElementById('meetingTitleText');
        const meetingIdBadge = document.getElementById('meetingIdBadge');
        if (meetingTitleText) {
          meetingTitleText.textContent = state.meeting.title;
        }
        if (meetingIdBadge) {
          meetingIdBadge.textContent = state.meeting.id;
        }
        syncDevParticipantSelection();
        syncAdmissionPanel();

        const participantList = document.getElementById('participantList');
        const stage = document.getElementById('videoStage');
        const visibleParticipants = state.meeting.participants.filter((participant) => participant.state !== 'LEFT');
        const allParticipants = visibleParticipants.length ? visibleParticipants : [{
          id: 'local-user',
          userId: 'local-user',
          displayName: state.displayName || 'You',
          role: 'PARTICIPANT',
          state: 'JOINED',
        }];

        participantList.innerHTML = '';
        stage.innerHTML = '';

        allParticipants.forEach((participant) => {
          const item = document.createElement('li');
          const participantColor = participant.state === 'JOINED' ? '#9ae6b4' : '#d1d5db';
          const statusColor = participant.state === 'JOINED' ? '#3ddc97' : '#94a3b8';
          const displayName = participant.displayName === state.displayName ? 'You' : participant.displayName;

          item.innerHTML =
            '<span>' + displayName + '</span>' +
            '<span style="display:flex; align-items:center; gap:8px; color:' + participantColor + ';">' +
              '<span class="dot" style="background:' + statusColor + '"></span>' +
              participant.role +
            '</span>';
          participantList.appendChild(item);
        });

        const orderedParticipants = [...allParticipants];
        const localIndex = orderedParticipants.findIndex((participant) => {
          const participantName = (participant.displayName || '').trim().toLowerCase();
          const localName = (state.displayName || '').trim().toLowerCase();
          return participantName === localName || participant.userId === 'user-me' || participant.id === 'demo-me';
        });

        if (localIndex > 0) {
          const [localParticipant] = orderedParticipants.splice(localIndex, 1);
          orderedParticipants.unshift(localParticipant);
        }

        const stageParticipants = orderedParticipants.length ? orderedParticipants : [{
          id: 'local-user',
          userId: 'local-user',
          displayName: state.displayName || 'You',
          role: 'PARTICIPANT',
          state: 'JOINED',
        }];

        const count = Math.max(stageParticipants.length, 1);
        stage.style.gridTemplateColumns = count <= 1 ? '1fr' : count <= 4 ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))';

        stageParticipants.forEach((participant) => {
          const tile = document.createElement('div');
          tile.className = 'tile';
          if (participant.displayName === state.displayName || participant.userId === 'user-me' || participant.id === 'demo-me') {
            tile.classList.add('self');
          }

          const tileLabel = participant.displayName === state.displayName || participant.userId === 'user-me' || participant.id === 'demo-me' ? 'You' : participant.displayName;
          const tileStatus = participant.state === 'JOINED' ? 'Joined' : 'Waiting';
          const isLocalTile = participant.displayName === state.displayName || participant.userId === 'user-me' || participant.id === 'demo-me';

          tile.innerHTML =
            '<div class="placeholder">' + tileLabel + '</div>' +
            '<div class="meta"><span class="dot"></span><span' + (isLocalTile ? ' id="localStatusLabel"' : '') + '>' + tileStatus + '</span></div>';
          stage.appendChild(tile);
        });

        syncMeetingRoleUi();
      }

      async function requestAdmissionForMeeting() {
        const meetingId = state.meetingId || document.getElementById('meetingIdInput').value.trim();
        const displayName = document.getElementById('displayNameInput').value.trim();

        if (!meetingId || !displayName) {
          setError('Please enter a display name before requesting entry.');
          return;
        }

        try {
          const response = await fetch('/api/meetings/' + encodeURIComponent(meetingId) + '/admission/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: 'user-' + Date.now(), displayName: displayName }),
          });

          const payload = await response.json();
          if (!response.ok || !payload.ok || !payload.data) {
            throw new Error(payload.error || 'Unable to request meeting admission.');
          }

          state.currentUserId = payload.data.userId;
          state.displayName = displayName;
          state.meeting = {
            ...(state.meeting || { id: meetingId, title: 'Meeting', status: 'active', hostId: '', participants: [], accessRequests: [] }),
            accessRequests: [...((state.meeting && Array.isArray(state.meeting.accessRequests)) ? state.meeting.accessRequests : []), payload.data],
          };
          renderMeetingRoom();
          setError(null);
          showScreen('meeting');
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Unable to request admission.');
        }
      }

      async function createMeeting() {
        const title = document.getElementById('meetingTitle').value.trim();
        const hostName = document.getElementById('hostName').value.trim();

        if (!title || !hostName) {
          setError('Please provide a meeting title and your name.');
          return;
        }

        try {
          const response = await fetch('/api/meetings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title, hostUserId: 'host-' + Date.now(), accessMode: 'HOST_APPROVAL' })
          });

          const payload = await response.json();
          if (!response.ok || !payload.ok || !payload.data) {
            throw new Error(payload.error || 'Unable to create the meeting.');
          }

          state.meetingId = payload.data.id;
          state.currentUserId = payload.data.hostId;
          state.displayName = hostName;
          state.meeting = payload.data;
          document.getElementById('displayNameInput').value = hostName;
          document.getElementById('prejoinTitle').textContent = payload.data.title + ' • ' + payload.data.id;
          setError(null);
          syncMeetingRoleUi();
          showScreen('prejoin');
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Unable to create meeting.');
        }
      }

      async function resolveMeeting() {
        const meetingId = document.getElementById('meetingIdInput').value.trim();
        if (!meetingId) {
          setError('Please enter a Meeting ID.');
          return;
        }

        try {
          const response = await fetch('/api/meetings/' + encodeURIComponent(meetingId));
          const payload = await response.json();

          if (!response.ok || !payload.ok || !payload.data) {
            throw new Error(payload.error || 'Meeting not found.');
          }

          state.meetingId = payload.data.id;
          state.meeting = payload.data;
          state.currentUserId = '';
          state.isHost = false;
          document.getElementById('displayNameInput').value = '';
          document.getElementById('prejoinTitle').textContent = payload.data.title + ' • ' + payload.data.id;
          setError(null);
          syncMeetingRoleUi();
          showScreen('prejoin');
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Unable to resolve meeting.');
        }
      }

      async function joinMeetingNow() {
        const displayName = document.getElementById('displayNameInput').value.trim();
        if (!displayName) {
          setError('Please enter a display name.');
          return;
        }

        const meetingId = state.meetingId || document.getElementById('meetingIdInput').value.trim();
        const currentUserIsHost = Boolean(state.meeting && state.currentUserId && state.meeting.hostId === state.currentUserId);
        const userId = currentUserIsHost ? state.currentUserId : 'user-' + Date.now();

        try {
          const meetingEndpoint = currentUserIsHost || (state.meeting && state.meeting.accessMode !== 'HOST_APPROVAL')
            ? '/api/meetings/' + encodeURIComponent(meetingId) + '/join'
            : '/api/meetings/' + encodeURIComponent(meetingId) + '/admission/request';

          const response = await fetch(meetingEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId, displayName: displayName })
          });

          const payload = await response.json();
          if (!response.ok || !payload.ok || !payload.data) {
            throw new Error(payload.error || 'Unable to join the meeting.');
          }

          if (payload.data.status === 'WAITING') {
            state.currentUserId = payload.data.userId;
            state.displayName = displayName;
            state.admissionStatus = 'WAITING';
            state.meeting = {
              ...(state.meeting || { id: meetingId, title: 'Meeting', status: 'active', hostId: '', participants: [], accessRequests: [], accessMode: 'HOST_APPROVAL' }),
              accessRequests: [...((state.meeting && Array.isArray(state.meeting.accessRequests)) ? state.meeting.accessRequests : []), payload.data],
            };
            const joinButton = document.getElementById('joinNowButton');
            if (joinButton) {
              joinButton.textContent = 'Waiting for host approval';
              joinButton.disabled = true;
            }
            const prejoinTitle = document.getElementById('prejoinTitle');
            if (prejoinTitle) {
              prejoinTitle.textContent = (state.meeting.title || 'Meeting') + ' • ' + meetingId + ' • Waiting for host approval';
            }
            renderMeetingRoom();
            setError(null);
            showScreen('prejoin');
            return;
          }

          state.admissionStatus = 'APPROVED';
          const nextParticipants = [...(state.meeting?.participants ?? [])];
          const existingIndex = nextParticipants.findIndex((participant) => participant.userId === payload.data.userId);

          if (existingIndex >= 0) {
            nextParticipants[existingIndex] = payload.data;
          } else {
            nextParticipants.push(payload.data);
          }

          state.currentUserId = payload.data.userId;
          state.displayName = displayName;
          state.meeting = {
            ...state.meeting,
            participants: nextParticipants,
          };
          syncMeetingRoleUi();

          renderMeetingRoom();
          setError(null);
          showScreen('meeting');
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Unable to join the meeting.');
        }
      }

      async function leaveMeeting() {
        const meetingId = state.meetingId;
        if (!meetingId) return;

        const userId = state.currentUserId || 'user-' + Date.now();

        try {
          await fetch('/api/meetings/' + encodeURIComponent(meetingId) + '/leave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId })
          });
        } catch (error) {
          console.warn('Leave request ignored in local UI demo:', error);
        }

        stopScreenShareCapture();
        stopAllLocalMedia();
        state.currentUserId = '';
        state.isHost = false;
        state.meeting = null;
        state.meetingId = '';
        syncMeetingRoleUi();
        showScreen('home');
      }

      async function endMeeting() {
        const meetingId = state.meetingId;
        if (!meetingId) return;

        if (!state.currentUserId || !state.isHost) {
          setError('Only the host may end the meeting.');
          return;
        }

        try {
          const response = await fetch('/api/meetings/' + encodeURIComponent(meetingId) + '/end', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: state.currentUserId })
          });

          const payload = await response.json();
          if (!response.ok || !payload.ok) {
            throw new Error(payload.error || 'Unable to end the meeting.');
          }

          stopScreenShareCapture();
          stopAllLocalMedia();
          state.meeting = payload.data;
          state.isHost = false;
          syncMeetingRoleUi();
          showScreen('ended');
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Unable to end the meeting.');
        }
      }

      async function copyMeetingId() {
        if (!state.meetingId) return;
        try {
          await navigator.clipboard.writeText(state.meetingId);
          setError('Meeting ID copied to clipboard.');
        } catch {
          setError('Clipboard access unavailable in this browser.');
        }
      }

      function toggleDevPanel() {
        const panel = document.getElementById('devPanel');
        panel.classList.toggle('visible');
      }

      const devMediaState = {
        micEnabled: true,
        cameraEnabled: true,
      };

      function handleDevAction(action) {
        if (action === 'addParticipant') {
          const baseMeeting = state.meeting && state.meeting.id ? state.meeting : {
            id: 'btm_dev_1234567890',
            title: 'Development Test Room',
            status: 'active',
            createdAt: new Date().toISOString(),
            hostId: 'host-dev',
            participants: createMockParticipants(),
          };

          const nextId = 'demo-guest-' + (baseMeeting.participants.length + 1);
          baseMeeting.participants.push({
            id: nextId,
            displayName: 'Guest ' + baseMeeting.participants.length,
            role: 'PARTICIPANT',
            state: 'JOINED',
            meetingId: baseMeeting.id,
            userId: nextId,
            joinedAt: new Date().toISOString(),
          });
          state.meeting = baseMeeting;
          state.meetingId = baseMeeting.id;
          state.currentUserId = state.currentUserId || 'host-dev';
          renderMeetingRoom();
          showScreen('meeting');
          return;
        }

        if (action === 'removeParticipant') {
          const select = document.getElementById('devParticipantSelect');
          const selectedId = (select && select instanceof HTMLSelectElement ? select.value : '') || selectedDevParticipantId;

          if (!selectedId) {
            setError('Select a simulated participant to remove from the dev tools panel.');
            return;
          }

          const participantToRemove = state.meeting?.participants.find((participant) => participant.id === selectedId);
          if (!participantToRemove) {
            setError('The selected simulated participant is no longer in the room.');
            return;
          }

          const nextMeeting = removeSelectedDevParticipant(state, selectedId);
          state.meeting = nextMeeting.meeting;
          selectedDevParticipantId = '';
          renderMeetingRoom();
          showScreen('meeting');
          setError(null);
          return;
        }

        if (action === 'hostView') {
          state.currentUserId = 'host-dev';
          state.isHost = true;
          applyDemoMeeting({
            title: 'Development Host View',
            participants: [
              { id: 'demo-host', displayName: 'Host', role: 'HOST', state: 'JOINED', meetingId: 'btm_dev_1234567890', userId: 'host-dev', joinedAt: new Date().toISOString() },
              { id: 'demo-guest-1', displayName: 'Ava', role: 'PARTICIPANT', state: 'JOINED', meetingId: 'btm_dev_1234567890', userId: 'user-ava', joinedAt: new Date().toISOString() },
              { id: 'demo-guest-2', displayName: 'Sam', role: 'PARTICIPANT', state: 'PENDING', meetingId: 'btm_dev_1234567890', userId: 'user-sam', joinedAt: new Date().toISOString() },
              { id: 'demo-guest-3', displayName: 'Priya', role: 'PARTICIPANT', state: 'JOINED', meetingId: 'btm_dev_1234567890', userId: 'user-priya', joinedAt: new Date().toISOString() },
            ],
          });
          syncMeetingRoleUi();
          return;
        }

        if (action === 'participantView') {
          state.currentUserId = 'user-me';
          state.isHost = false;
          applyDemoMeeting({
            title: 'Development Participant View',
            participants: [
              { id: 'demo-host', displayName: 'Host', role: 'HOST', state: 'JOINED', meetingId: 'btm_dev_1234567890', userId: 'host-dev', joinedAt: new Date().toISOString() },
              { id: 'demo-me', displayName: 'You', role: 'PARTICIPANT', state: 'JOINED', meetingId: 'btm_dev_1234567890', userId: 'user-me', joinedAt: new Date().toISOString() },
            ],
          });
          syncMeetingRoleUi();
          return;
        }

        if (action === 'participantLeave') {
          state.isHost = false;
          applyDemoMeeting({
            title: 'Participant left state',
            participants: [
              { id: 'demo-host', displayName: 'Host', role: 'HOST', state: 'JOINED', meetingId: 'btm_dev_1234567890', userId: 'host-dev', joinedAt: new Date().toISOString() },
              { id: 'demo-guest-1', displayName: 'Ava', role: 'PARTICIPANT', state: 'LEFT', meetingId: 'btm_dev_1234567890', userId: 'user-ava', joinedAt: new Date().toISOString(), leftAt: new Date().toISOString() },
            ],
          });
          return;
        }

        if (action === 'meetingEnded') {
          state.meeting = {
            id: 'btm_dev_1234567890',
            title: 'Development Ended State',
            status: 'ended',
            createdAt: new Date().toISOString(),
            hostId: 'host-dev',
            participants: [
              { id: 'demo-host', displayName: 'Host', role: 'HOST', state: 'LEFT', meetingId: 'btm_dev_1234567890', userId: 'host-dev', joinedAt: new Date().toISOString(), leftAt: new Date().toISOString() },
            ],
          };
          state.meetingId = state.meeting.id;
          showScreen('ended');
          document.getElementById('endedTitle').textContent = 'Development testing ended';
          document.getElementById('endedMessage').textContent = 'This is a local UI simulation only — no real meeting was connected.';
          return;
        }

        if (action === 'micOff') {
          devMediaState.micEnabled = false;
          return;
        }

        if (action === 'cameraOff') {
          devMediaState.cameraEnabled = false;
          return;
        }

        if (action === 'showGrid') {
          state.isHost = true;
          applyDemoMeeting({
            title: 'Participant grid layout',
            participants: [
              { id: 'demo-host', displayName: 'Host', role: 'HOST', state: 'JOINED', meetingId: 'btm_dev_1234567890', userId: 'host-dev', joinedAt: new Date().toISOString() },
              { id: 'demo-guest-1', displayName: 'Ava', role: 'PARTICIPANT', state: 'JOINED', meetingId: 'btm_dev_1234567890', userId: 'user-ava', joinedAt: new Date().toISOString() },
              { id: 'demo-guest-2', displayName: 'Sam', role: 'PARTICIPANT', state: 'JOINED', meetingId: 'btm_dev_1234567890', userId: 'user-sam', joinedAt: new Date().toISOString() },
              { id: 'demo-guest-3', displayName: 'Priya', role: 'PARTICIPANT', state: 'JOINED', meetingId: 'btm_dev_1234567890', userId: 'user-priya', joinedAt: new Date().toISOString() },
            ],
          });
        }
      }

      document.getElementById('toggleDevPanelBtn').addEventListener('click', toggleDevPanel);
      const devParticipantSelect = document.getElementById('devParticipantSelect');
      if (devParticipantSelect) {
        devParticipantSelect.addEventListener('change', (event) => {
          selectedDevParticipantId = event.target.value;
        });
      }
      document.querySelectorAll('[data-dev-action]').forEach((button) => {
        button.addEventListener('click', () => handleDevAction(button.dataset.devAction));
      });

      document.getElementById('startMeetingBtn').addEventListener('click', () => {
        setError(null);
        showScreen('create');
      });

      document.getElementById('joinMeetingBtn').addEventListener('click', () => {
        setError(null);
        showScreen('join');
      });

      document.getElementById('createMeetingButton').addEventListener('click', createMeeting);
      document.getElementById('backToHomeFromCreate').addEventListener('click', () => showScreen('home'));
      document.getElementById('backToHomeFromJoin').addEventListener('click', () => showScreen('home'));
      document.getElementById('resolveMeetingButton').addEventListener('click', resolveMeeting);
      document.getElementById('joinNowButton').addEventListener('click', joinMeetingNow);
      document.getElementById('requestAdmissionBtn').addEventListener('click', requestAdmissionForMeeting);
      document.getElementById('refreshAdmissionsBtn').addEventListener('click', async () => {
        if (!state.meetingId || !state.currentUserId || !state.isHost) {
          return;
        }

        const response = await fetch('/api/meetings/' + encodeURIComponent(state.meetingId) + '/admission/pending', {
          headers: { 'X-Host-User-Id': state.currentUserId },
        });
        const payload = await response.json();
        if (response.ok && payload.ok && payload.data) {
          state.meeting = {
            ...(state.meeting || { id: state.meetingId, title: 'Meeting', status: 'active', hostId: state.currentUserId, participants: [], accessRequests: [] }),
            accessRequests: payload.data,
          };
          renderMeetingRoom();
        }
      });
      document.getElementById('backToHomeFromPrejoin').addEventListener('click', () => showScreen('home'));
      document.getElementById('toggleMicBtn').addEventListener('click', () => {
        void toggleMicrophone();
      });

      document.getElementById('toggleCameraBtn').addEventListener('click', () => {
        void toggleCamera();
      });

      document.getElementById('micControlBtn').addEventListener('click', () => {
        if (state.localDevice.micEnabled) {
          stopLocalMicrophone();
          return;
        }
        void toggleMicrophone();
      });

      document.getElementById('cameraControlBtn').addEventListener('click', () => {
        if (state.localDevice.cameraEnabled) {
          stopLocalCamera();
          return;
        }
        void toggleCamera();
      });

      document.getElementById('shareScreenBtn').addEventListener('click', handleScreenShareToggle);

      document.getElementById('copyMeetingIdBtn').addEventListener('click', copyMeetingId);
      document.getElementById('leaveMeetingBtn').addEventListener('click', leaveMeeting);
      document.getElementById('endMeetingBtn').addEventListener('click', endMeeting);
      document.getElementById('returnHomeBtn').addEventListener('click', () => {
        stopScreenShareCapture();
        stopAllLocalMedia();
        state.currentUserId = '';
        state.isHost = false;
        state.meetingId = '';
        state.meeting = null;
        setError(null);
        syncMeetingRoleUi();
        showScreen('home');
      });

      renderLocalState();
      showScreen('home');
    </script>
  </body>
</html>`;
}

export default {
  async fetch(request: Request, env: Partial<RealtimeEnv> = {}): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/ui")) {
      return new Response(meetingUiHtml(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const validation = validateRealtimeEnv(env);

      return jsonResponse({
        ok: true,
        service: "billiontalks-realtime-backend",
        envConfigured: validation.ok,
      });
    }

    if (request.method === "POST" && url.pathname === "/api/realtime/session") {
      const validation = validateRealtimeEnv(env);

      if (!validation.ok) {
        return jsonResponse(
          {
            ok: false,
            error: "Cloudflare Realtime configuration is missing.",
            missing: validation.missing,
          },
          500,
        );
      }

      try {
        const client = new CloudflareRealtimeConnectionClient(
          env.REALTIME_SFU_APP_ID!,
          env.REALTIME_SFU_BEARER_TOKEN!,
        );

        const result = await client.createSession();

        return jsonResponse(
          {
            ok: true,
            data: {
              sessionId: result.sessionId,
            },
          },
          200,
        );
      } catch (error) {
        const upstreamStatus =
          error instanceof Error && "upstreamStatus" in error
            ? Number((error as { upstreamStatus?: number }).upstreamStatus)
            : undefined;

        const errorMessage =
          typeof upstreamStatus === "number" && Number.isFinite(upstreamStatus)
            ? `Cloudflare Realtime session creation failed. HTTP status: ${upstreamStatus}.`
            : "Cloudflare Realtime session creation failed.";

        return jsonResponse(
          {
            ok: false,
            error: errorMessage,
            upstreamStatus,
          },
          500,
        );
      }
    }

    if (request.method === "POST" && url.pathname === "/api/meetings") {
      const body = await parseJsonBody<{ title?: string; hostUserId?: string; accessMode?: string }>(request);

      if (!body || !body.title || !body.hostUserId) {
        return jsonResponse(
          {
            ok: false,
            error: "Meeting title and hostUserId are required.",
          },
          400,
        );
      }

      try {
        const meeting = await getMeetingService(env).createMeeting({
          title: body.title,
          hostUserId: body.hostUserId,
          accessMode: body.accessMode,
        });

        return jsonResponse(
          {
            ok: true,
            data: meeting,
          },
          201,
        );
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Unable to create meeting.",
          },
          500,
        );
      }
    }

    const meetingAdmissionRequestMatch = /^\/api\/meetings\/([^/]+)\/admission\/request$/.exec(
      url.pathname,
    );

    if (meetingAdmissionRequestMatch && request.method === "POST") {
      const body = await parseJsonBody<{ userId?: string; displayName?: string }>(request);

      if (!body || !body.userId || !body.displayName) {
        return jsonResponse(
          {
            ok: false,
            error: "userId and displayName are required to request meeting admission.",
          },
          400,
        );
      }

      try {
        const requestResult = await getMeetingService(env).requestAdmission(meetingAdmissionRequestMatch[1], {
          userId: body.userId,
          displayName: body.displayName,
        });

        return jsonResponse({ ok: true, data: requestResult });
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Unable to request meeting admission.",
          },
          400,
        );
      }
    }

    const meetingPendingAdmissionsMatch = /^\/api\/meetings\/([^/]+)\/admission\/pending$/.exec(
      url.pathname,
    );

    if (meetingPendingAdmissionsMatch && request.method === "GET") {
      const actorUserId = request.headers.get("x-host-user-id") || request.headers.get("X-Host-User-Id");

      if (!actorUserId) {
        return jsonResponse({ ok: false, error: "Host userId is required to list pending admissions." }, 403);
      }

      try {
        const pending = await getMeetingService(env).listPendingAdmissions(meetingPendingAdmissionsMatch[1], actorUserId);
        return jsonResponse({ ok: true, data: pending });
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Unable to list pending admissions.",
          },
          403,
        );
      }
    }

    const meetingAdmissionDecisionMatch = /^\/api\/meetings\/([^/]+)\/admission\/([^/]+)\/(approve|reject)$/.exec(
      url.pathname,
    );

    if (meetingAdmissionDecisionMatch && request.method === "POST") {
      const body = await parseJsonBody<{ userId?: string }>(request);

      if (!body || !body.userId) {
        return jsonResponse(
          {
            ok: false,
            error: "userId is required to decide an admission request.",
          },
          400,
        );
      }

      try {
        const service = getMeetingService(env);
        const admission =
          meetingAdmissionDecisionMatch[3] === "approve"
            ? await service.approveAdmission(meetingAdmissionDecisionMatch[1], body.userId, meetingAdmissionDecisionMatch[2])
            : await service.rejectAdmission(meetingAdmissionDecisionMatch[1], body.userId, meetingAdmissionDecisionMatch[2]);

        return jsonResponse({ ok: true, data: admission });
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Unable to process meeting admission.",
          },
          403,
        );
      }
    }

    const meetingAccessModeMatch = /^\/api\/meetings\/([^/]+)\/access-mode$/.exec(url.pathname);

    if (meetingAccessModeMatch && request.method === "POST") {
      const body = await parseJsonBody<{ actorUserId?: string; accessMode?: string }>(request);

      if (!body || !body.actorUserId || !body.accessMode) {
        return jsonResponse(
          {
            ok: false,
            error: "actorUserId and accessMode are required to change meeting access.",
          },
          400,
        );
      }

      try {
        const accessMode = await getMeetingService(env).changeAccessMode(
          meetingAccessModeMatch[1],
          body.actorUserId,
          body.accessMode,
        );

        return jsonResponse({ ok: true, data: { accessMode } });
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Unable to change meeting access mode.",
          },
          403,
        );
      }
    }

    const meetingMatch = /^\/api\/meetings\/([^/]+)(?:\/(join|leave|end|participants))?$/.exec(
      url.pathname,
    );

    if (meetingMatch && request.method === "GET" && !meetingMatch[2]) {
      const meeting = await getMeetingService(env).getMeeting(meetingMatch[1]);

      if (!meeting) {
        return jsonResponse({ ok: false, error: "Meeting not found." }, 404);
      }

      return jsonResponse({ ok: true, data: meeting });
    }

    if (meetingMatch && request.method === "POST" && meetingMatch[2] === "join") {
      const body = await parseJsonBody<{ userId?: string; displayName?: string }>(request);

      if (!body || !body.userId || !body.displayName) {
        return jsonResponse(
          {
            ok: false,
            error: "userId and displayName are required to join a meeting.",
          },
          400,
        );
      }

      try {
        const service = getMeetingService(env);
        const meeting = await service.getMeeting(meetingMatch[1]);

        if (meeting && meeting.hostId === body.userId) {
          const participant = await service.joinMeeting(meetingMatch[1], {
            userId: body.userId,
            displayName: body.displayName,
          });
          return jsonResponse({ ok: true, data: participant });
        }

        if (meeting && meeting.accessMode === "HOST_APPROVAL") {
          const requestResult = await service.requestAdmission(meetingMatch[1], {
            userId: body.userId,
            displayName: body.displayName,
          });
          return jsonResponse({ ok: true, data: requestResult });
        }

        const participant = await service.joinMeeting(meetingMatch[1], {
          userId: body.userId,
          displayName: body.displayName,
        });

        return jsonResponse({ ok: true, data: participant });
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Unable to join meeting.",
          },
          400,
        );
      }
    }

    if (meetingMatch && request.method === "POST" && meetingMatch[2] === "leave") {
      const body = await parseJsonBody<{ userId?: string }>(request);

      if (!body || !body.userId) {
        return jsonResponse(
          {
            ok: false,
            error: "userId is required to leave a meeting.",
          },
          400,
        );
      }

      try {
        const participant = await getMeetingService(env).leaveMeeting(meetingMatch[1], body.userId);

        return participant
          ? jsonResponse({ ok: true, data: participant })
          : jsonResponse({ ok: false, error: "Participant not found." }, 404);
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Unable to leave meeting.",
          },
          400,
        );
      }
    }

    if (meetingMatch && request.method === "POST" && meetingMatch[2] === "end") {
      const body = await parseJsonBody<{ userId?: string }>(request);

      if (!body || !body.userId) {
        return jsonResponse(
          {
            ok: false,
            error: "userId is required to end the meeting.",
          },
          400,
        );
      }

      try {
        const meeting = await getMeetingService(env).endMeeting(meetingMatch[1], body.userId);
        return jsonResponse({ ok: true, data: meeting });
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Unable to end meeting.",
          },
          403,
        );
      }
    }

    if (meetingMatch && request.method === "GET" && meetingMatch[2] === "participants") {
      const participants = await getMeetingService(env).listParticipants(meetingMatch[1]);
      return jsonResponse({ ok: true, data: participants });
    }

    return jsonResponse(
      {
        ok: false,
        error: "Not found.",
      },
      404,
    );
  },
};
