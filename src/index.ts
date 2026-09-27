import { DurableObject, type DurableObjectState } from "cloudflare:workers";
import { validateRealtimeEnv, type RealtimeEnv } from "./config";
import {
  buildRecordingObjectKey,
  CloudflareMediaProvider,
  DurableMeetingRepository,
  InMemoryMeetingRepository,
  MeetingAccessMode,
  MeetingRecordingStatus,
  MeetingStatus,
  MeetingService,
  NullMediaProvider,
  ParticipantState,
  type MeetingChatMessage,
  type MeetingRecordingMetadata,
  type Meeting,
  type MeetingRepository,
} from "./meeting";
import { CloudflareRealtimeConnectionClient } from "./realtime";

const SESSION_COOKIE_NAME = "bt_session_v0";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const MAX_CHAT_MESSAGE_LENGTH = 2000;

type V0Session = {
  sessionId: string;
  userId: string;
  displayName: string;
  createdAt: string;
  lastSeenAt: string;
};

type V0SessionStoreStub = {
  getSession: (sessionId: string) => Promise<V0Session | undefined>;
  saveSession: (session: V0Session) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
};

type WorkerEnv = Partial<RealtimeEnv> & { SESSION_STORE?: unknown };

function resolveSessionStore(env: WorkerEnv): V0SessionStoreStub {
  const binding = env.SESSION_STORE ?? env.MEETING_STORE;

  if (!binding || typeof binding !== "object" || !("get" in binding) || !("idFromName" in binding)) {
    throw new Error("A Durable Object namespace is required to persist V0 sessions.");
  }

  const namespace = binding as {
    get: (id: unknown) => V0SessionStoreStub;
    idFromName: (name: string) => unknown;
  };
  const stub = namespace.get(namespace.idFromName("billiontalks-v0-sessions"));

  if (!stub || typeof stub.getSession !== "function" || typeof stub.saveSession !== "function" || typeof stub.deleteSession !== "function") {
    throw new Error("The configured Durable Object does not support V0 session storage.");
  }

  return stub;
}

function generateSessionUserId(): string {
  return `session_${crypto.randomUUID().slice(0, 12)}`;
}

function parseCookieHeader(rawCookieHeader: string | null): Map<string, string> {
  const cookies = new Map<string, string>();

  if (!rawCookieHeader) {
    return cookies;
  }

  for (const entry of rawCookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = entry.trim().split("=");
    if (!rawName || !rawValueParts.length) {
      continue;
    }

    const name = rawName.trim();
    const value = rawValueParts.join("=").trim();
    cookies.set(name, decodeURIComponent(value));
  }

  return cookies;
}

function getSessionIdFromRequest(request: Request): string | null {
  return parseCookieHeader(request.headers.get("Cookie") ?? request.headers.get("cookie")).get(SESSION_COOKIE_NAME) ?? null;
}

function buildSessionCookieHeader(sessionId: string, request: Request): string {
  const url = new URL(request.url);
  const isSecureContext = url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const secureSuffix = isSecureContext ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secureSuffix}; Max-Age=${SESSION_TTL_SECONDS}`;
}

function withSessionCookie(response: Response, request: Request, session: V0Session): Response {
  const headers = new Headers(response.headers);
  headers.set("Set-Cookie", buildSessionCookieHeader(session.sessionId, request));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function getOrCreateSession(request: Request, env: WorkerEnv, displayName?: string): Promise<{ session: V0Session; isNew: boolean }> {
  const store = resolveSessionStore(env);
  const sessionId = getSessionIdFromRequest(request);

  if (sessionId) {
    const existing = await store.getSession(sessionId);
    const now = Date.now();
    const lastSeenAt = existing ? Date.parse(existing.lastSeenAt) : Number.NaN;

    if (
      existing &&
      existing.sessionId === sessionId &&
      Number.isFinite(lastSeenAt) &&
      now >= lastSeenAt &&
      now - lastSeenAt < SESSION_TTL_SECONDS * 1000
    ) {
      const updated: V0Session = {
        ...existing,
        displayName: displayName?.trim() || existing.displayName,
        lastSeenAt: new Date(now).toISOString(),
      };
      await store.saveSession(updated);
      return { session: updated, isNew: false };
    }

    if (existing) {
      await store.deleteSession(sessionId);
    }
  }

  const now = new Date().toISOString();
  const createSession: V0Session = {
    sessionId: crypto.randomUUID(),
    userId: generateSessionUserId(),
    displayName: displayName?.trim() || "Guest",
    createdAt: now,
    lastSeenAt: now,
  };

  await store.saveSession(createSession);
  return { session: createSession, isNew: true };
}

export class MeetingStateDurableObject extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
  }

  async saveMeeting(meeting: Meeting): Promise<number> {
    return this.ctx.storage.transaction(async (storage: { get: <T>(key: string) => Promise<T | undefined> | T | undefined; put: (key: string, value: unknown) => Promise<void> | void }) => {
      const current = await storage.get<Meeting>("meeting");
      if ((current?.revision ?? 0) !== (meeting.revision ?? 0)) {
        throw new Error("Meeting changed. Refresh and try again.");
      }
      const revision = (current?.revision ?? 0) + 1;
      await storage.put("meeting", { ...meeting, revision });
      if (!current && !(await storage.get<MeetingRecordingMetadata[]>("recordings"))) {
        await storage.put("recordings", [{ meetingId: meeting.id, status: MeetingRecordingStatus.NOT_STARTED }]);
      }
      return revision;
    });
  }

  async getMeeting(): Promise<Meeting | undefined> {
    return (await this.ctx.storage.get<Meeting>("meeting")) ?? undefined;
  }

  async addMeetingHistoryReference(userId: string, meetingId: string): Promise<void> {
    await this.ctx.storage.transaction(async (storage: { get: <T>(key: string) => Promise<T | undefined> | T | undefined; put: (key: string, value: unknown) => Promise<void> | void }) => {
      const key = `meeting-history:${userId}`;
      const references = (await storage.get<string[]>(key)) ?? [];
      if (!references.includes(meetingId)) await storage.put(key, [...references, meetingId]);
    });
  }

  async listMeetingHistoryReferences(userId: string): Promise<string[]> {
    return (await this.ctx.storage.get<string[]>(`meeting-history:${userId}`)) ?? [];
  }

  async getRecordingMetadata(): Promise<MeetingRecordingMetadata[]> {
    return (await this.ctx.storage.get<MeetingRecordingMetadata[]>("recordings")) ?? [];
  }

  async startRecording(actorUserId: string): Promise<MeetingRecordingMetadata> {
    return this.ctx.storage.transaction(async (storage: { get: <T>(key: string) => Promise<T | undefined> | T | undefined; put: (key: string, value: unknown) => Promise<void> | void }) => {
      const meeting = await storage.get<Meeting>("meeting");
      if (!meeting) throw new Error("Meeting not found.");
      if (meeting.hostId !== actorUserId || !meeting.participants.some((participant) => participant.userId === actorUserId && participant.role === "HOST")) {
        throw new Error("Only the meeting host may control recording.");
      }
      if (meeting.status !== MeetingStatus.ACTIVE) throw new Error("Meeting is not active.");

      const recordings = (await storage.get<MeetingRecordingMetadata[]>("recordings")) ?? [];
      if (recordings.some((recording) => recording.status === MeetingRecordingStatus.RECORDING)) {
        throw new Error("Recording is already active.");
      }

      const recordingId = `rec_${crypto.randomUUID()}`;
      const recording: MeetingRecordingMetadata = {
        meetingId: meeting.id,
        recordingId,
        status: MeetingRecordingStatus.RECORDING,
        startedAt: new Date().toISOString(),
        initiatedByUserId: actorUserId,
        storageRef: {
          provider: "r2",
            objectKey: buildRecordingObjectKey(meeting.id, recordingId),
        },
      };
      await storage.put("recordings", [...recordings, recording]);
      return recording;
    });
  }

  async stopRecording(actorUserId: string): Promise<MeetingRecordingMetadata> {
    return this.ctx.storage.transaction(async (storage: { get: <T>(key: string) => Promise<T | undefined> | T | undefined; put: (key: string, value: unknown) => Promise<void> | void }) => {
      const meeting = await storage.get<Meeting>("meeting");
      if (!meeting) throw new Error("Meeting not found.");
      if (meeting.hostId !== actorUserId || !meeting.participants.some((participant) => participant.userId === actorUserId && participant.role === "HOST")) {
        throw new Error("Only the meeting host may control recording.");
      }

      const recordings = (await storage.get<MeetingRecordingMetadata[]>("recordings")) ?? [];
      const index = recordings.findIndex((recording) => recording.status === MeetingRecordingStatus.RECORDING);
      if (index < 0) throw new Error("No active recording to stop.");
      const updated: MeetingRecordingMetadata = {
        ...recordings[index],
        status: MeetingRecordingStatus.STOPPED,
        stoppedAt: new Date().toISOString(),
      };
      await storage.put("recordings", recordings.map((recording, entryIndex) => entryIndex === index ? updated : recording));
      return updated;
    });
  }

  async listChatMessages(): Promise<MeetingChatMessage[]> {
    return (await this.ctx.storage.get<MeetingChatMessage[]>("chat")) ?? [];
  }

  async appendChatMessage(senderUserId: string, content: string): Promise<MeetingChatMessage> {
    return this.ctx.storage.transaction(async (storage: { get: <T>(key: string) => Promise<T | undefined> | T | undefined; put: (key: string, value: unknown) => Promise<void> | void }) => {
      const meeting = await storage.get<Meeting>("meeting");
      if (!meeting) {
        throw new Error("Meeting not found.");
      }
      if (meeting.status !== MeetingStatus.ACTIVE) {
        throw new Error("Meeting is not active.");
      }

      const participant = meeting.participants.find((entry) => entry.userId === senderUserId);
      if (participant?.state === ParticipantState.REMOVED) {
        throw new Error("You were removed from this meeting.");
      }
      if (!participant || participant.state !== ParticipantState.JOINED) {
        throw new Error("Only joined participants may send chat messages.");
      }

      const messages = (await storage.get<MeetingChatMessage[]>("chat")) ?? [];
      const previousTimestamp = messages.length ? Date.parse(messages[messages.length - 1].createdAt) : Number.NaN;
      const timestamp = Math.max(Date.now(), Number.isFinite(previousTimestamp) ? previousTimestamp + 1 : 0);
      const message: MeetingChatMessage = {
        id: `chat_${crypto.randomUUID()}`,
        meetingId: meeting.id,
        sequence: messages.length + 1,
        senderUserId: participant.userId,
        senderDisplayName: participant.displayName,
        content,
        createdAt: new Date(timestamp).toISOString(),
      };
      await storage.put("chat", [...messages, message]);
      return message;
    });
  }

  async getSession(sessionId: string): Promise<V0Session | undefined> {
    return (await this.ctx.storage.get<V0Session>(`v0-session:${sessionId}`)) ?? undefined;
  }

  async saveSession(session: V0Session): Promise<void> {
    await this.ctx.storage.put(`v0-session:${session.sessionId}`, session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.ctx.storage.delete(`v0-session:${sessionId}`);
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function toPublicRecordingMetadata(recording: MeetingRecordingMetadata): Omit<MeetingRecordingMetadata, "storageRef"> {
  const { storageRef: _storageRef, ...publicMetadata } = recording;
  return publicMetadata;
}

export function resolveMeetingRepository(env: Partial<RealtimeEnv> = {}): MeetingRepository {
  if (!env.MEETING_STORE) {
    throw new Error(
      "MEETING_STORE Durable Object binding is required. Configure wrangler.jsonc and deploy with the MeetingStateDurableObject binding before using persisted meetings.",
    );
  }

  if (
    typeof env.MEETING_STORE === "object" &&
    env.MEETING_STORE !== null &&
    "saveMeeting" in env.MEETING_STORE &&
    "getMeeting" in env.MEETING_STORE &&
    "setMediaConnection" in env.MEETING_STORE &&
    "getMediaConnection" in env.MEETING_STORE &&
    "deleteMediaConnection" in env.MEETING_STORE
  ) {
    return env.MEETING_STORE as MeetingRepository;
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
    <title>BillionTalks</title>
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
      .history-section {
        margin-top: 24px;
        padding-top: 18px;
        border-top: 1px solid var(--border);
      }
      .history-heading {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }
      .history-status {
        color: var(--muted);
        font-size: 12px;
      }
      .history-list {
        list-style: none;
        margin: 8px 0 0;
        padding: 0;
        display: grid;
        gap: 6px;
      }
      .history-entry {
        padding: 9px 11px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: rgba(148, 163, 184, 0.05);
      }
      .history-entry summary {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        cursor: pointer;
      }
      .history-entry summary strong {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .history-entry-meta,
      .history-details {
        color: var(--muted);
        font-size: 12px;
      }
      .history-details {
        margin-top: 8px;
        display: grid;
        gap: 4px;
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
      .chat-panel {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--border);
      }
      .chat-heading {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }
      .chat-status {
        color: var(--muted);
        font-size: 11px;
      }
      .chat-messages {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 230px;
        overflow-y: auto;
        margin: 8px 0 12px;
        padding: 0;
      }
      .chat-message {
        min-width: 0;
        padding: 8px 10px;
        border-left: 2px solid rgba(124, 156, 255, 0.55);
        background: rgba(148, 163, 184, 0.06);
        overflow-wrap: anywhere;
      }
      .chat-message-meta {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 3px;
        color: var(--muted);
        font-size: 11px;
      }
      .chat-message-content {
        margin: 0;
        color: var(--text);
        font-size: 13px;
        line-height: 1.4;
        white-space: pre-wrap;
      }
      .chat-form {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
      }
      .chat-form input {
        min-width: 0;
        padding: 9px 10px;
      }
      .chat-form button {
        padding: 9px 12px;
        border-radius: 10px;
      }
      .recording-panel {
        margin-top: 18px;
        padding-top: 14px;
        border-top: 1px solid var(--border);
      }
      .recording-copy {
        margin: 6px 0 10px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.4;
      }
      .recording-controls {
        display: flex;
        gap: 8px;
      }
      .recording-controls button {
        padding: 8px 10px;
        border-radius: 10px;
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
          <button class="dev-toggle" id="toggleDevPanelBtn" type="button">Developer tools</button>
          <div class="status-pill" id="statusPill">Meeting</div>
        </div>
      </div>

      <div class="dev-panel" id="devPanel" aria-label="Developer tools panel">
        <div class="dev-panel-header">
          <span>Developer tools</span>
          <span class="muted" style="font-size:10px; letter-spacing:0.08em;">Local-only</span>
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
          <div class="kicker">Welcome</div>
          <div class="hero">
            <div>
              <h1>Start or join a meeting</h1>
              <p class="muted">Create a room for your team or join with a Meeting ID to continue the conversation.</p>
              <div class="actions">
                <button class="primary" id="startMeetingBtn">Start Meeting</button>
                <button class="secondary" id="joinMeetingBtn">Join Meeting</button>
              </div>
            </div>
            <div class="info-box">
              <h3>Ready to connect</h3>
              <p class="muted">Your mic and camera are ready before you join, and your room keeps your meeting state updated as people enter or rejoin.</p>
              <div class="device-status">
                <span class="chip ok">Mic ready</span>
                <span class="chip ok">Camera ready</span>
              </div>
            </div>
          </div>
          <section class="history-section" aria-label="Meeting history">
            <div class="history-heading">
              <div class="kicker" style="margin:0;">Recent Meetings</div>
              <span id="historyStatus" class="history-status" aria-live="polite">Loading</span>
            </div>
            <ol id="meetingHistoryList" class="history-list"></ol>
          </section>
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
            <section class="recording-panel" aria-label="Meeting recording">
              <div class="kicker" style="margin:0;">Recording</div>
              <p id="recordingStatus" class="recording-copy" aria-live="polite">Not started. Media capture is not connected.</p>
              <div id="recordingControls" class="recording-controls" style="display:none;">
                <button id="startRecordingBtn" type="button" class="secondary">Start</button>
                <button id="stopRecordingBtn" type="button" class="ghost" style="display:none;">Stop</button>
              </div>
            </section>
            <div id="admissionPanel" style="margin-top: 18px; display:none;">
              <div class="kicker">Admission</div>
              <label for="meetingAccessMode">Who can join?</label>
              <select id="meetingAccessMode">
                <option value="HOST_APPROVAL">Host approval</option>
                <option value="OPEN">Open meeting</option>
                <option value="LOCKED">Locked</option>
              </select>
              <button type="button" id="applyAccessModeBtn" class="secondary">Apply</button>
              <div id="admissionModeLabel" class="muted" style="margin-bottom: 10px;">Host approval</div>
              <div id="pendingAdmissionsList" class="participant-list" style="margin-top: 8px;"></div>
              <div class="actions" style="margin-top: 12px;">
                <button class="secondary" id="requestAdmissionBtn" type="button">Request to join</button>
                <button class="ghost" id="refreshAdmissionsBtn" type="button">Refresh</button>
              </div>
            </div>
            <section class="chat-panel" aria-label="Meeting chat">
              <div class="chat-heading">
                <div class="kicker" style="margin:0;">Chat</div>
                <span id="chatStatus" class="chat-status" aria-live="polite">No messages</span>
              </div>
              <ol id="chatMessages" class="chat-messages" aria-live="polite"></ol>
              <form id="chatForm" class="chat-form">
                <input id="chatInput" type="text" maxlength="2000" placeholder="Write a message" aria-label="Chat message" autocomplete="off" />
                <button type="submit" class="secondary" aria-label="Send chat message">Send</button>
              </form>
            </section>
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
        recordings: [],
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

      function formatUiMessage(message) {
        const value = String(message || '');
        if (!value) {
          return '';
        }

        const lower = value.toLowerCase();
        if (lower.includes('waiting for host approval')) {
          return 'Waiting for host approval.';
        }
        if (lower.includes('rejected')) {
          return 'Your request was not approved for this meeting.';
        }
        if (lower.includes('locked')) {
          return 'This meeting is currently locked.';
        }
        if (lower.includes('not active') || lower.includes('meeting has ended') || lower.includes('ended the room') || lower.includes('ended')) {
          return 'This meeting has ended.';
        }
        if (lower.includes('meeting not found')) {
          return 'This meeting could not be found.';
        }

        return value;
      }

      function setError(message) {
        const normalizedMessage = formatUiMessage(message);
        state.error = normalizedMessage;
        if (normalizedMessage) {
          if (errorBanner) {
            errorBanner.textContent = normalizedMessage;
            errorBanner.className = 'error';
          }
        } else if (errorBanner) {
          errorBanner.textContent = '';
          errorBanner.className = '';
        }
      }

      function getAccessModeLabel(mode) {
        switch (mode) {
          case 'OPEN':
            return 'Open meeting';
          case 'LOCKED':
            return 'Meeting locked';
          case 'HOST_APPROVAL':
          default:
            return 'Host approval required';
        }
      }

      let hostActionPending = false;
      let hostActionVersion = 0;
      let meetingRefreshTimer = null;
      let meetingRefreshPending = false;
      let chatRefreshPending = false;
      let chatRefreshMeetingId = '';
      let chatMessagesMeetingId = '';
      let chatMessages = [];
      let recordingRefreshPending = false;
      let recordingRefreshMeetingId = '';
      let recordingsMeetingId = '';
      let recordingActionPending = false;
      let historyRefreshPending = false;

      function escapeHtml(value) {
        const span = document.createElement('span');
        span.textContent = String(value || '');
        return span.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
      }

      function renderMeetingHistory(entries) {
        const list = document.getElementById('meetingHistoryList');
        const status = document.getElementById('historyStatus');
        if (!list || !status) return;

        list.replaceChildren();
        const history = Array.isArray(entries) ? entries : [];
        status.textContent = history.length ? history.length + (history.length === 1 ? ' meeting' : ' meetings') : 'No meetings yet';
        if (!history.length) {
          const empty = document.createElement('li');
          empty.className = 'history-status';
          empty.textContent = 'Your previous meetings will appear here.';
          list.appendChild(empty);
          return;
        }

        history.forEach((entry) => {
          const item = document.createElement('li');
          item.className = 'history-entry';
          const disclosure = document.createElement('details');
          const summary = document.createElement('summary');
          const title = document.createElement('strong');
          title.textContent = entry.title || entry.meetingId;
          const meta = document.createElement('span');
          meta.className = 'history-entry-meta';
          meta.textContent = entry.status + ' · ' + entry.participantRole;
          summary.append(title, meta);

          const details = document.createElement('div');
          details.className = 'history-details';
          const addDetail = (label, value) => {
            const row = document.createElement('div');
            row.textContent = label + ': ' + value;
            details.appendChild(row);
          };
          addDetail('Meeting ID', entry.meetingId);
          addDetail('Created', new Date(entry.createdAt).toLocaleString());
          if (entry.endedAt) addDetail('Ended', new Date(entry.endedAt).toLocaleString());
          if (entry.latestRecordingStatus) addDetail('Recording', entry.latestRecordingStatus);
          disclosure.append(summary, details);
          item.appendChild(disclosure);
          list.appendChild(item);
        });
      }

      async function refreshMeetingHistory() {
        if (historyRefreshPending) return;
        historyRefreshPending = true;
        const status = document.getElementById('historyStatus');
        if (status) status.textContent = 'Loading';
        try {
          const response = await fetch('/api/meetings/history');
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to load meeting history.');
          renderMeetingHistory(payload.data);
        } catch (error) {
          if (status) status.textContent = 'History unavailable';
        } finally {
          historyRefreshPending = false;
        }
      }

      function syncHostActionButtons() {
        document.querySelectorAll('#applyAccessModeBtn, #meetingAccessMode, #endMeetingBtn, [data-admission-action], [data-remove-user-id]').forEach((button) => {
          button.disabled = hostActionPending || button.dataset.admissionAction === 'approve' && state.meeting && state.meeting.accessMode === 'LOCKED';
        });
      }

      function finishLocalSession(message) {
        stopScreenShareCapture();
        stopAllLocalMedia();
        state.isHost = false;
        state.admissionStatus = '';
        document.getElementById('endedMessage').textContent = message;
        document.getElementById('endedTitle').textContent = state.meeting && state.meeting.status === 'ended' ? 'The meeting has ended.' : 'You have left the meeting.';
        syncMeetingRoleUi();
        showScreen('ended');
      }

      function applyMeetingSnapshot(meeting) {
        const changed = JSON.stringify(state.meeting) !== JSON.stringify(meeting);
        state.meeting = meeting;
        if (meeting.status !== 'active') {
          finishLocalSession('The host ended this meeting.');
          return;
        }
        const participant = meeting.participants.find((entry) => entry.userId === state.currentUserId);
        if (participant && participant.state === 'REMOVED') {
          finishLocalSession('You were removed by the host.');
          return;
        }
        if (state.admissionStatus === 'WAITING') {
          const admission = (meeting.accessRequests || []).find((entry) => entry.userId === state.currentUserId);
          if (admission && admission.status === 'REJECTED') {
            finishLocalSession('Your request was not approved for this meeting.');
            return;
          }
          if (participant && participant.state === 'JOINED') {
            state.admissionStatus = 'APPROVED';
            showScreen('meeting');
          }
        }
        if (changed) renderMeetingRoom();
      }

      function renderChatMessages(messages) {
        const list = document.getElementById('chatMessages');
        const status = document.getElementById('chatStatus');
        if (!list || !status) return;

        const wasNearBottom = list.scrollHeight - list.clientHeight - list.scrollTop < 32;
        chatMessages = Array.isArray(messages) ? messages : [];
        status.textContent = chatMessages.length ? chatMessages.length + (chatMessages.length === 1 ? ' message' : ' messages') : 'No messages';
        list.innerHTML = chatMessages.length ? chatMessages.map((message) => {
          const timestamp = new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const sender = message.senderUserId === state.currentUserId ? 'You' : message.senderDisplayName;
          return '<li class="chat-message"><div class="chat-message-meta"><span>' + escapeHtml(sender) + '</span><time datetime="' + escapeHtml(message.createdAt) + '">' + escapeHtml(timestamp) + '</time></div><p class="chat-message-content">' + escapeHtml(message.content) + '</p></li>';
        }).join('') : '<li class="muted">No messages yet.</li>';
        if (wasNearBottom) list.scrollTop = list.scrollHeight;
      }

      async function refreshMeetingChat() {
        if (!state.meetingId || state.route !== 'meeting') return;
        const meetingId = state.meetingId;
        if (chatMessagesMeetingId !== meetingId) {
          chatMessagesMeetingId = meetingId;
          chatMessages = [];
          renderChatMessages(chatMessages);
        }
        if (chatRefreshPending && chatRefreshMeetingId === meetingId) return;
        chatRefreshPending = true;
        chatRefreshMeetingId = meetingId;

        try {
          const response = await fetch('/api/meetings/' + encodeURIComponent(meetingId) + '/chat');
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to load chat.');
          if (meetingId === state.meetingId && state.route === 'meeting') {
            renderChatMessages(payload.data);
          }
        } catch (error) {
          if (meetingId === state.meetingId && state.route === 'meeting') {
            const status = document.getElementById('chatStatus');
            if (status) status.textContent = 'Chat unavailable';
          }
        } finally {
          if (chatRefreshMeetingId === meetingId) {
            chatRefreshPending = false;
            chatRefreshMeetingId = '';
          }
        }
      }

      async function submitMeetingChat(event) {
        event.preventDefault();
        const input = document.getElementById('chatInput');
        const submitButton = document.querySelector('#chatForm button[type="submit"]');
        const content = input.value.trim();
        if (!content || !state.meetingId || state.route !== 'meeting') return;

        const meetingId = state.meetingId;
        submitButton.disabled = true;
        try {
          const response = await fetch('/api/meetings/' + encodeURIComponent(meetingId) + '/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
          });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to send message.');
          if (meetingId === state.meetingId && state.route === 'meeting') {
            input.value = '';
            chatMessages = [...chatMessages, payload.data];
            renderChatMessages(chatMessages);
          }
        } catch (error) {
          const status = document.getElementById('chatStatus');
          if (status) status.textContent = error instanceof Error ? error.message : 'Unable to send message.';
        } finally {
          submitButton.disabled = false;
        }
      }

      function renderRecordingStatus() {
        const statusElement = document.getElementById('recordingStatus');
        const controls = document.getElementById('recordingControls');
        const startButton = document.getElementById('startRecordingBtn');
        const stopButton = document.getElementById('stopRecordingBtn');
        if (!statusElement || !controls || !startButton || !stopButton) return;

        const current = state.recordings[state.recordings.length - 1];
        const active = current && current.status === 'RECORDING';
        if (active) {
          statusElement.textContent = 'Recording is active. Media capture is not connected yet.';
        } else if (current && current.status === 'STOPPED') {
          statusElement.textContent = 'Recording stopped. Media capture is not connected yet.';
        } else if (current && current.status === 'FAILED') {
          statusElement.textContent = 'Recording failed. Media capture is not connected yet.';
        } else {
          statusElement.textContent = 'Not started. Media capture is not connected.';
        }

        const hostCanControl = state.isHost && state.meeting && state.meeting.status === 'active';
        controls.style.display = hostCanControl ? 'flex' : 'none';
        startButton.style.display = active ? 'none' : 'inline-flex';
        stopButton.style.display = active ? 'inline-flex' : 'none';
        startButton.disabled = recordingActionPending;
        stopButton.disabled = recordingActionPending;
      }

      async function refreshRecordingStatus() {
        if (!state.meetingId || state.route !== 'meeting') return;
        const meetingId = state.meetingId;
        if (recordingsMeetingId !== meetingId) {
          recordingsMeetingId = meetingId;
          state.recordings = [];
          renderRecordingStatus();
        }
        if (recordingRefreshPending && recordingRefreshMeetingId === meetingId) return;
        recordingRefreshPending = true;
        recordingRefreshMeetingId = meetingId;
        try {
          const response = await fetch('/api/meetings/' + encodeURIComponent(meetingId) + '/recording');
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to load recording status.');
          if (meetingId === state.meetingId && state.route === 'meeting') {
            state.recordings = Array.isArray(payload.data) ? payload.data : [];
            renderRecordingStatus();
          }
        } catch (error) {
          const statusElement = document.getElementById('recordingStatus');
          if (meetingId === state.meetingId && state.route === 'meeting' && statusElement) {
            statusElement.textContent = 'Recording status unavailable.';
          }
        } finally {
          if (recordingRefreshMeetingId === meetingId) {
            recordingRefreshPending = false;
            recordingRefreshMeetingId = '';
          }
        }
      }

      async function updateRecording(action) {
        if (!state.isHost || recordingActionPending || !state.meetingId || state.route !== 'meeting') return;
        const meetingId = state.meetingId;
        recordingActionPending = true;
        renderRecordingStatus();
        try {
          const response = await fetch('/api/meetings/' + encodeURIComponent(meetingId) + '/recording/' + action, { method: 'POST' });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to update recording.');
          if (meetingId === state.meetingId) {
            const existing = state.recordings.filter((recording) => recording.recordingId !== payload.data.recordingId);
            state.recordings = [...existing, payload.data];
            renderRecordingStatus();
          }
        } catch (error) {
          const statusElement = document.getElementById('recordingStatus');
          if (statusElement) statusElement.textContent = error instanceof Error ? error.message : 'Unable to update recording.';
        } finally {
          recordingActionPending = false;
          renderRecordingStatus();
        }
      }

      async function refreshMeetingState() {
        if (meetingRefreshPending || hostActionPending || !state.meetingId || !state.currentUserId) return;
        const meetingId = state.meetingId;
        const userId = state.currentUserId;
        const actionVersion = hostActionVersion;
        meetingRefreshPending = true;
        try {
          const response = await fetch('/api/meetings/' + encodeURIComponent(meetingId));
          const payload = await response.json();
          if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || 'Unable to refresh meeting.');
          if (meetingId === state.meetingId && userId === state.currentUserId && actionVersion === hostActionVersion && !hostActionPending && ['meeting', 'prejoin'].includes(state.route)) {
            applyMeetingSnapshot(payload.data);
            if (state.route === 'meeting') {
              await refreshMeetingChat();
              await refreshRecordingStatus();
            }
          }
        } catch (error) {
          if (meetingId === state.meetingId && ['meeting', 'prejoin'].includes(state.route)) setError('Unable to refresh meeting. Retrying automatically.');
        } finally {
          meetingRefreshPending = false;
        }
      }

      function scheduleMeetingRefresh() {
        clearTimeout(meetingRefreshTimer);
        if (!state.currentUserId || !state.meetingId || state.meetingId === 'btm_dev_1234567890' || !(state.route === 'meeting' || state.admissionStatus === 'WAITING' && state.route === 'prejoin')) return;
        meetingRefreshTimer = setTimeout(async () => {
          await refreshMeetingState();
          scheduleMeetingRefresh();
        }, 3000);
      }

      async function runHostAction(path, body) {
        if (hostActionPending || !state.isHost || !state.meeting || state.meeting.status !== 'active') return;
        const meetingId = state.meetingId;
        const userId = state.currentUserId;
        hostActionPending = true;
        hostActionVersion += 1;
        syncHostActionButtons();
        setError(null);
        try {
          const response = await fetch('/api/meetings/' + encodeURIComponent(meetingId) + path, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to update meeting.');
          if (meetingId !== state.meetingId || userId !== state.currentUserId || state.route !== 'meeting') return;
          if (path === '/end' || path === '/remove') {
            applyMeetingSnapshot(payload.data);
          } else {
            const refreshed = await fetch('/api/meetings/' + encodeURIComponent(meetingId));
            const latest = await refreshed.json();
            if (!refreshed.ok || !latest.ok || !latest.data) throw new Error('Action saved. Refresh the meeting to see the latest state.');
            if (meetingId === state.meetingId && userId === state.currentUserId && state.route === 'meeting') applyMeetingSnapshot(latest.data);
          }
        } catch (error) {
          if (meetingId === state.meetingId && userId === state.currentUserId) setError(error instanceof Error ? error.message : 'Unable to update meeting.');
        } finally {
          hostActionPending = false;
          syncHostActionButtons();
        }
      }

      function showScreen(name) {
        state.route = name;
        if (name === 'home') void refreshMeetingHistory();
        if (name === 'meeting') {
          void refreshMeetingChat();
          void refreshRecordingStatus();
        }
        if (name === 'prejoin' && state.admissionStatus !== 'WAITING') {
          document.getElementById('joinNowButton').disabled = false;
          document.getElementById('joinNowButton').textContent = 'Join now';
        }
        scheduleMeetingRefresh();
        Object.entries(screens).forEach(([key, node]) => {
          if (node) {
            node.classList.toggle('visible', key === name);
          }
        });

        if (statusPill) {
          if (name === 'meeting') {
            statusPill.textContent = 'In meeting';
          } else if (name === 'prejoin') {
            statusPill.textContent = 'Ready to join';
          } else if (name === 'home' || name === 'create' || name === 'join') {
            statusPill.textContent = 'Meeting';
          } else if (name === 'ended') {
            statusPill.textContent = 'Meeting ended';
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

      let localCaptureGeneration = 0;

      function stopAllLocalMedia() {
        localCaptureGeneration += 1;
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

        const captureGeneration = localCaptureGeneration;
        try {
          localMediaState.micRequestInFlight = true;
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          if (captureGeneration !== localCaptureGeneration) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }

          if (!stream.getAudioTracks().length) {
            throw new DOMException('No microphone device is available.', 'NotFoundError');
          }

          Object.assign(localMediaState, startLocalMediaStream(localMediaState, 'mic', stream));
          state.localDevice.micAvailable = true;
          state.localDevice.micEnabled = true;
          renderLocalState();
          setError(null);
        } catch (error) {
          if (captureGeneration !== localCaptureGeneration) return;
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
          if (captureGeneration === localCaptureGeneration) localMediaState.micRequestInFlight = false;
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

        const captureGeneration = localCaptureGeneration;
        try {
          localMediaState.cameraRequestInFlight = true;
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          if (captureGeneration !== localCaptureGeneration) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }

          if (!stream.getVideoTracks().length) {
            throw new DOMException('No camera device is available.', 'NotFoundError');
          }

          Object.assign(localMediaState, startLocalMediaStream(localMediaState, 'camera', stream));
          state.localDevice.cameraAvailable = true;
          state.localDevice.cameraEnabled = true;
          renderLocalState();
          setError(null);
        } catch (error) {
          if (captureGeneration !== localCaptureGeneration) return;
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
          if (captureGeneration === localCaptureGeneration) localMediaState.cameraRequestInFlight = false;
        }
      }

      function syncMeetingRoleUi() {
        const endMeetingBtn = document.getElementById('endMeetingBtn');
        const meetingIsHost = Boolean(state.meeting && state.meeting.status === 'active' && state.currentUserId && state.meeting.hostId === state.currentUserId);

        state.isHost = meetingIsHost;

        if (endMeetingBtn) {
          endMeetingBtn.style.display = meetingIsHost ? 'flex' : 'none';
        }
        renderRecordingStatus();
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

        const captureGeneration = localCaptureGeneration;
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });

          if (!stream) {
            throw new DOMException('No display stream was returned.', 'NotFoundError');
          }

          if (captureGeneration !== localCaptureGeneration) {
            stream.getTracks().forEach((track) => track.stop());
            return;
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
          if (captureGeneration !== localCaptureGeneration) return;
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
          .filter((participant) => participant.role === 'PARTICIPANT' && participant.state !== 'LEFT' && participant.state !== 'REMOVED')
          .map((participant) => ({
            id: participant.id,
            label: participant.displayName || participant.userId || participant.id,
          }));

        const currentSelection = selectedDevParticipantId;
        select.innerHTML = options.length
          ? '<option value="">Select a participant</option>' + options.map((option) => '<option value="' + escapeHtml(option.id) + '">' + escapeHtml(option.label) + '</option>').join('')
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
        const isHost = Boolean(state.meeting.status === 'active' && state.currentUserId && state.meeting.hostId === state.currentUserId);
        panel.style.display = isHost ? 'block' : 'none';
        document.getElementById('meetingAccessMode').value = meetingMode;

        if (requestBtn) {
          requestBtn.style.display = isHost || meetingMode !== 'HOST_APPROVAL' || state.admissionStatus === 'WAITING' ? 'none' : 'inline-flex';
        }

        if (modeLabel) {
          modeLabel.textContent = getAccessModeLabel(meetingMode);
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
          return '<li><span>' + escapeHtml(request.displayName || request.userId) + '</span><span style="display:flex; gap:6px;"><button type="button" data-admission-action="approve" data-request-id="' + escapeHtml(request.id) + '" style="padding:4px 8px; border-radius:8px; background:rgba(61,220,151,0.16); color:#dfffee; border:1px solid rgba(61,220,151,0.35);">Approve</button><button type="button" data-admission-action="reject" data-request-id="' + escapeHtml(request.id) + '" style="padding:4px 8px; border-radius:8px; background:rgba(248,113,113,0.12); color:#fdd2d2; border:1px solid rgba(248,113,113,0.35);">Reject</button></span></li>';
        }).join('');

        pendingList.querySelectorAll('[data-admission-action]').forEach((button) => {
          button.addEventListener('click', async () => {
            const action = button.getAttribute('data-admission-action');
            const requestId = button.getAttribute('data-request-id');
            if (!requestId || !state.meetingId) {
              return;
            }

            await runHostAction('/admission/' + encodeURIComponent(requestId) + '/' + action, { userId: state.currentUserId });
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
        const visibleParticipants = state.meeting.participants.filter((participant) => participant.state !== 'LEFT' && participant.state !== 'REMOVED');
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
          const roleLabel = participant.role === 'HOST' ? 'Host' : 'Guest';

          item.innerHTML =
            '<span>' + escapeHtml(displayName) + '</span>' +
            '<span style="display:flex; align-items:center; gap:8px; color:' + participantColor + ';">' +
              '<span class="dot" style="background:' + statusColor + '"></span>' +
              roleLabel +
            '</span>';
          if (state.meeting.status === 'active' && state.currentUserId === state.meeting.hostId && participant.role !== 'HOST' && participant.state === 'JOINED' && participant.userId) {
            const removeButton = document.createElement('button');
            removeButton.textContent = 'Remove';
            removeButton.type = 'button';
            removeButton.dataset.removeUserId = participant.userId;
            removeButton.setAttribute('aria-label', 'Remove ' + participant.displayName);
            removeButton.addEventListener('click', () => {
              if (hostActionPending || !window.confirm('Remove ' + participant.displayName + ' from this meeting?')) return;
              void runHostAction('/remove', { actorUserId: state.currentUserId, targetUserId: participant.userId });
            });
            item.appendChild(removeButton);
          }
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
            '<div class="placeholder">' + escapeHtml(tileLabel) + '</div>' +
            '<div class="meta"><span class="dot"></span><span' + (isLocalTile ? ' id="localStatusLabel"' : '') + '>' + tileStatus + '</span></div>';
          stage.appendChild(tile);
        });

        syncMeetingRoleUi();
        renderLocalState();
        if (activeScreenShareStream) showScreenSharePreview(activeScreenShareStream);
        syncHostActionButtons();
        if (state.route === 'meeting') void refreshMeetingChat();
      }

      async function requestAdmissionForMeeting() {
        await joinMeetingNow();
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
          state.admissionStatus = '';
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
        const userId = state.currentUserId;
        if (!meetingId || !userId) return;
        stopScreenShareCapture();
        stopAllLocalMedia();
        state.currentUserId = '';
        state.admissionStatus = '';
        state.isHost = false;
        state.meeting = null;
        state.meetingId = '';
        syncMeetingRoleUi();
        showScreen('home');
        try {
          const response = await fetch('/api/meetings/' + encodeURIComponent(meetingId) + '/leave', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }),
          });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error('Unable to save leave status.');
        } catch (error) {
          if (state.route === 'home' && !state.meetingId) setError('You left locally, but your leave status could not be saved.');
        }
      }

      async function endMeeting() {
        if (hostActionPending || !state.isHost || !window.confirm('End this meeting for everyone?')) return;
        await runHostAction('/end', { userId: state.currentUserId });
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
          document.getElementById('endedTitle').textContent = 'This meeting has ended.';
          document.getElementById('endedMessage').textContent = 'The room is closed for new joins. Start a new room or ask the host to invite you again.';
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
      document.getElementById('applyAccessModeBtn').addEventListener('click', () => {
        void runHostAction('/access-mode', { actorUserId: state.currentUserId, accessMode: document.getElementById('meetingAccessMode').value });
      });
      document.getElementById('refreshAdmissionsBtn').addEventListener('click', () => {
        void refreshMeetingState();
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
      document.getElementById('chatForm').addEventListener('submit', submitMeetingChat);
      document.getElementById('startRecordingBtn').addEventListener('click', () => { void updateRecording('start'); });
      document.getElementById('stopRecordingBtn').addEventListener('click', () => { void updateRecording('stop'); });
      document.getElementById('leaveMeetingBtn').addEventListener('click', leaveMeeting);
      document.getElementById('endMeetingBtn').addEventListener('click', endMeeting);
      document.getElementById('returnHomeBtn').addEventListener('click', () => {
        stopScreenShareCapture();
        stopAllLocalMedia();
        state.currentUserId = '';
        state.admissionStatus = '';
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
  async fetch(request: Request, env: WorkerEnv = {}): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/ui")) {
      const { session } = await getOrCreateSession(request, env);
      return withSessionCookie(
        new Response(meetingUiHtml(), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        }),
        request,
        session,
      );
    }

    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/session") {
      const { session } = await getOrCreateSession(request, env);
      return withSessionCookie(
        jsonResponse({
          ok: true,
          data: {
            sessionId: session.sessionId,
            userId: session.userId,
            displayName: session.displayName,
          },
        }),
        request,
        session,
      );
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
      const body = await parseJsonBody<{ title?: string; hostUserId?: string; hostDisplayName?: string; displayName?: string; accessMode?: string }>(request);

      if (!body || !body.title) {
        return jsonResponse(
          {
            ok: false,
            error: "Meeting title is required.",
          },
          400,
        );
      }

      const { session } = await getOrCreateSession(request, env, body.displayName || body.hostDisplayName);

      try {
        const meeting = await getMeetingService(env).createMeeting({
          title: body.title,
          hostUserId: session.userId,
          accessMode: body.accessMode,
        });

        return withSessionCookie(
          jsonResponse(
            {
              ok: true,
              data: meeting,
            },
            201,
          ),
          request,
          session,
        );
      } catch (error) {
        return withSessionCookie(
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Unable to create meeting.",
            },
            500,
          ),
          request,
          session,
        );
      }
    }

    const meetingAdmissionRequestMatch = /^\/api\/meetings\/([^/]+)\/admission\/request$/.exec(
      url.pathname,
    );

    if (meetingAdmissionRequestMatch && request.method === "POST") {
      const body = await parseJsonBody<{ userId?: string; displayName?: string }>(request);
      const { session } = await getOrCreateSession(request, env, body?.displayName);

      if (!body || !body.displayName) {
        return withSessionCookie(
          jsonResponse(
            {
              ok: false,
              error: "displayName is required to request meeting admission.",
            },
            400,
          ),
          request,
          session,
        );
      }

      try {
        const requestResult = await getMeetingService(env).requestAdmission(meetingAdmissionRequestMatch[1], {
          userId: session.userId,
          displayName: body.displayName,
        });

        return withSessionCookie(jsonResponse({ ok: true, data: requestResult }), request, session);
      } catch (error) {
        return withSessionCookie(
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Unable to request meeting admission.",
            },
            400,
          ),
          request,
          session,
        );
      }
    }

    const meetingPendingAdmissionsMatch = /^\/api\/meetings\/([^/]+)\/admission\/pending$/.exec(
      url.pathname,
    );

    if (meetingPendingAdmissionsMatch && request.method === "GET") {
      const { session } = await getOrCreateSession(request, env);
      const actorUserId = session.userId;

      try {
        const pending = await getMeetingService(env).listPendingAdmissions(meetingPendingAdmissionsMatch[1], actorUserId);
        return withSessionCookie(jsonResponse({ ok: true, data: pending }), request, session);
      } catch (error) {
        return withSessionCookie(
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Unable to list pending admissions.",
            },
            403,
          ),
          request,
          session,
        );
      }
    }

    const meetingAdmissionDecisionMatch = /^\/api\/meetings\/([^/]+)\/admission\/([^/]+)\/(approve|reject)$/.exec(
      url.pathname,
    );

    if (meetingAdmissionDecisionMatch && request.method === "POST") {
      const body = await parseJsonBody<{ userId?: string }>(request);
      const { session } = await getOrCreateSession(request, env);

      try {
        const service = getMeetingService(env);
        const actorUserId = session.userId;
        const admission =
          meetingAdmissionDecisionMatch[3] === "approve"
            ? await service.approveAdmission(meetingAdmissionDecisionMatch[1], actorUserId, meetingAdmissionDecisionMatch[2])
            : await service.rejectAdmission(meetingAdmissionDecisionMatch[1], actorUserId, meetingAdmissionDecisionMatch[2]);

        return withSessionCookie(jsonResponse({ ok: true, data: admission }), request, session);
      } catch (error) {
        return withSessionCookie(
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Unable to process meeting admission.",
            },
            403,
          ),
          request,
          session,
        );
      }
    }

    const meetingAccessModeMatch = /^\/api\/meetings\/([^/]+)\/access-mode$/.exec(url.pathname);

    if (meetingAccessModeMatch && request.method === "POST") {
      const body = await parseJsonBody<{ actorUserId?: string; accessMode?: string }>(request);
      const { session } = await getOrCreateSession(request, env);

      if (!body || !body.accessMode) {
        return withSessionCookie(
          jsonResponse(
            {
              ok: false,
              error: "accessMode is required to change meeting access.",
            },
            400,
          ),
          request,
          session,
        );
      }

      try {
        const accessMode = await getMeetingService(env).changeAccessMode(
          meetingAccessModeMatch[1],
          session.userId,
          body.accessMode,
        );

        return withSessionCookie(jsonResponse({ ok: true, data: { accessMode } }), request, session);
      } catch (error) {
        return withSessionCookie(
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Unable to change meeting access mode.",
            },
            403,
          ),
          request,
          session,
        );
      }
    }

    if (request.method === "GET" && url.pathname === "/api/meetings/history") {
      const { session } = await getOrCreateSession(request, env);
      try {
        const history = await getMeetingService(env).listMeetingHistory(session.userId);
        return withSessionCookie(jsonResponse({ ok: true, data: history }), request, session);
      } catch (error) {
        return withSessionCookie(
          jsonResponse({ ok: false, error: error instanceof Error ? error.message : "Unable to load meeting history." }, 500),
          request,
          session,
        );
      }
    }

    const meetingRecordingMatch = /^\/api\/meetings\/([^/]+)\/recording(?:\/(start|stop))?$/.exec(url.pathname);

    if (meetingRecordingMatch && request.method === "GET" && !meetingRecordingMatch[2]) {
      const { session } = await getOrCreateSession(request, env);
      try {
        const recordings = await getMeetingService(env).getRecordingMetadata(meetingRecordingMatch[1], session.userId);
        return withSessionCookie(
          jsonResponse({ ok: true, data: recordings.map(toPublicRecordingMetadata) }),
          request,
          session,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to read recording status.";
        return withSessionCookie(jsonResponse({ ok: false, error: message }, message === "Meeting not found." ? 404 : 403), request, session);
      }
    }

    if (meetingRecordingMatch && request.method === "POST" && meetingRecordingMatch[2]) {
      const { session } = await getOrCreateSession(request, env);
      try {
        const service = getMeetingService(env);
        const recording = meetingRecordingMatch[2] === "start"
          ? await service.startRecording(meetingRecordingMatch[1], session.userId)
          : await service.stopRecording(meetingRecordingMatch[1], session.userId);
        return withSessionCookie(jsonResponse({ ok: true, data: toPublicRecordingMetadata(recording) }), request, session);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to update recording status.";
        const status = message === "Meeting not found." ? 404 : message === "Meeting is not active." || message.includes("already active") || message.includes("No active recording") ? 409 : 403;
        return withSessionCookie(jsonResponse({ ok: false, error: message }, status), request, session);
      }
    }

    const meetingChatMatch = /^\/api\/meetings\/([^/]+)\/chat$/.exec(url.pathname);

    if (meetingChatMatch && request.method === "GET") {
      const { session } = await getOrCreateSession(request, env);

      try {
        const messages = await getMeetingService(env).listChatMessages(meetingChatMatch[1], session.userId);
        return withSessionCookie(jsonResponse({ ok: true, data: messages }), request, session);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to read meeting chat.";
        const status = message === "Meeting not found." ? 404 : 403;
        return withSessionCookie(jsonResponse({ ok: false, error: message }, status), request, session);
      }
    }

    if (meetingChatMatch && request.method === "POST") {
      const body = await parseJsonBody<{ content?: string; senderUserId?: string; userId?: string }>(request);
      const { session } = await getOrCreateSession(request, env);

      if (!body || typeof body.content !== "string" || !body.content.trim()) {
        return withSessionCookie(
          jsonResponse({ ok: false, error: "Chat message content is required." }, 400),
          request,
          session,
        );
      }
      if (body.content.length > MAX_CHAT_MESSAGE_LENGTH) {
        return withSessionCookie(
          jsonResponse({ ok: false, error: `Chat messages must be ${MAX_CHAT_MESSAGE_LENGTH} characters or fewer.` }, 400),
          request,
          session,
        );
      }

      try {
        const message = await getMeetingService(env).postChatMessage(
          meetingChatMatch[1],
          session.userId,
          body.content,
        );
        return withSessionCookie(jsonResponse({ ok: true, data: message }, 201), request, session);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to post chat message.";
        const status = message === "Meeting not found." ? 404 : message === "Meeting is not active." ? 409 : 403;
        return withSessionCookie(jsonResponse({ ok: false, error: message }, status), request, session);
      }
    }

    const removalMatch = /^\/api\/meetings\/([^/]+)\/remove$/.exec(url.pathname);
    if (removalMatch && request.method === "POST") {
      const body = await parseJsonBody<{ actorUserId?: string; targetUserId?: string }>(request);
      if (!body || typeof body.actorUserId !== "string" || typeof body.targetUserId !== "string" || !body.actorUserId.trim() || !body.targetUserId.trim()) {
        return jsonResponse({ ok: false, error: "actorUserId and targetUserId are required." }, 400);
      }
      try {
        const meeting = await getMeetingService(env).removeParticipant(removalMatch[1], body.actorUserId, body.targetUserId);
        return jsonResponse({ ok: true, data: meeting });
      } catch (error) {
        return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "Unable to remove participant." }, 403);
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
      const { session } = await getOrCreateSession(request, env, body?.displayName);

      if (!body || !body.displayName) {
        return withSessionCookie(
          jsonResponse(
            {
              ok: false,
              error: "displayName is required to join a meeting.",
            },
            400,
          ),
          request,
          session,
        );
      }

      try {
        const service = getMeetingService(env);
        const meeting = await service.getMeeting(meetingMatch[1]);
        const authenticatedUserId = session.userId;

        if (meeting && meeting.hostId === authenticatedUserId) {
          const participant = await service.joinMeeting(meetingMatch[1], {
            userId: authenticatedUserId,
            displayName: body.displayName,
          });
          return withSessionCookie(jsonResponse({ ok: true, data: participant }), request, session);
        }

        if (meeting && meeting.accessMode === "HOST_APPROVAL") {
          const requestResult = await service.requestAdmission(meetingMatch[1], {
            userId: authenticatedUserId,
            displayName: body.displayName,
          });
          return withSessionCookie(jsonResponse({ ok: true, data: requestResult }), request, session);
        }

        const participant = await service.joinMeeting(meetingMatch[1], {
          userId: authenticatedUserId,
          displayName: body.displayName,
        });

        return withSessionCookie(jsonResponse({ ok: true, data: participant }), request, session);
      } catch (error) {
        return withSessionCookie(
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Unable to join meeting.",
            },
            400,
          ),
          request,
          session,
        );
      }
    }

    if (meetingMatch && request.method === "POST" && meetingMatch[2] === "leave") {
      const { session } = await getOrCreateSession(request, env);

      try {
        const participant = await getMeetingService(env).leaveMeeting(meetingMatch[1], session.userId);

        return participant
          ? withSessionCookie(jsonResponse({ ok: true, data: participant }), request, session)
          : withSessionCookie(jsonResponse({ ok: false, error: "Participant not found." }, 404), request, session);
      } catch (error) {
        return withSessionCookie(
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Unable to leave meeting.",
            },
            400,
          ),
          request,
          session,
        );
      }
    }

    if (meetingMatch && request.method === "POST" && meetingMatch[2] === "end") {
      const { session } = await getOrCreateSession(request, env);

      try {
        const meeting = await getMeetingService(env).endMeeting(meetingMatch[1], session.userId);
        return withSessionCookie(jsonResponse({ ok: true, data: meeting }), request, session);
      } catch (error) {
        return withSessionCookie(
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Unable to end meeting.",
            },
            403,
          ),
          request,
          session,
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
