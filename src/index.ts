import { DurableObject, type DurableObjectState } from "cloudflare:workers";
import { validateRealtimeEnv, type RealtimeEnv } from "./config";
import {
  handleAccountLogin,
  handleAccountLogout,
  handleAccountMe,
  handleAccountProfileUpdate,
  handleAccountRegistration,
  handleForgotPassword,
  handleEmailVerification,
  handleResetPassword,
} from "./account/api";
import type { D1AccountDatabase } from "./account/repository";
import {
  buildRecordingObjectKey,
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
  type RecordingUploadedPart,
  type Meeting,
  type MeetingRepository,
} from "./meeting";
import {
  CloudflareRealtimeConnectionClient,
  CloudflareRealtimeSessionError,
  type RealtimeParticipantMediaState,
  type RealtimePublishedTrack,
  type RealtimeSubscribedTrack,
  type RealtimeTrackOperationResult,
} from "./realtime";

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

type WorkerEnv = Partial<RealtimeEnv> & { SESSION_STORE?: unknown; ACCOUNT_DB?: D1AccountDatabase; DEV_TOOLS_ENABLED?: string };

type RecordingMultipartUpload = {
  uploadId: string;
  uploadPart: (partNumber: number, value: ArrayBuffer) => Promise<{ partNumber: number; etag: string }>;
  complete: (parts: Array<{ partNumber: number; etag: string }>) => Promise<{ size: number }>;
  abort: () => Promise<void>;
};

type PrivateRecordingBucket = {
  createMultipartUpload: (key: string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) => Promise<RecordingMultipartUpload>;
  resumeMultipartUpload: (key: string, uploadId: string) => RecordingMultipartUpload;
};

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
  private readonly sfuMutationLocks = new Map<string, { token: string; expiresAt: number; released: Promise<void>; release: () => void }>();

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
  }

  // One SFU mutation per participant at a time; a lease keeps a crashed holder from blocking forever.
  async acquireSfuMutation(key: string, leaseMs = 25_000): Promise<string> {
    for (;;) {
      const held = this.sfuMutationLocks.get(key);
      if (!held) break;
      const remaining = held.expiresAt - Date.now();
      if (remaining <= 0) {
        this.sfuMutationLocks.delete(key);
        held.release();
        break;
      }
      await Promise.race([held.released, new Promise((resolve) => setTimeout(resolve, remaining))]);
    }
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const token = crypto.randomUUID();
    this.sfuMutationLocks.set(key, { token, expiresAt: Date.now() + leaseMs, released, release });
    return token;
  }

  async releaseSfuMutation(key: string, token: string): Promise<void> {
    const held = this.sfuMutationLocks.get(key);
    if (!held || held.token !== token) return;
    this.sfuMutationLocks.delete(key);
    held.release();
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

  async getSfuParticipantState(userId: string): Promise<RealtimeParticipantMediaState | undefined> {
    return (await this.ctx.storage.get<RealtimeParticipantMediaState>(`sfu:${userId}`)) ?? undefined;
  }

  async saveSfuParticipantState(state: RealtimeParticipantMediaState): Promise<void> {
    await this.ctx.storage.transaction(async (storage: { get: <T>(key: string) => Promise<T | undefined> | T | undefined; put: (key: string, value: unknown) => Promise<void> | void }) => {
      await storage.put(`sfu:${state.userId}`, state);
      const users = (await storage.get<string[]>("sfu-users")) ?? [];
      if (!users.includes(state.userId)) await storage.put("sfu-users", [...users, state.userId]);
    });
  }

  async listSfuParticipantStates(): Promise<RealtimeParticipantMediaState[]> {
    const users: string[] = (await this.ctx.storage.get<string[]>("sfu-users")) ?? [];
    const states: Array<RealtimeParticipantMediaState | undefined> = await Promise.all(users.map((userId: string) => this.getSfuParticipantState(userId)));
    return states.filter((state): state is RealtimeParticipantMediaState => Boolean(state));
  }

  async deleteSfuParticipantState(userId: string): Promise<void> {
    await this.ctx.storage.transaction(async (storage: { get: <T>(key: string) => Promise<T | undefined> | T | undefined; put: (key: string, value: unknown) => Promise<void> | void; delete: (key: string) => Promise<boolean | void> | boolean | void }) => {
      await storage.delete(`sfu:${userId}`);
      const users = (await storage.get<string[]>("sfu-users")) ?? [];
      await storage.put("sfu-users", users.filter((entry) => entry !== userId));
    });
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

  async attachRecordingUpload(recordingId: string, actorUserId: string, uploadId: string): Promise<MeetingRecordingMetadata> {
    return this.ctx.storage.transaction(async (storage: { get: <T>(key: string) => Promise<T | undefined> | T | undefined; put: (key: string, value: unknown) => Promise<void> | void }) => {
      const meeting = await storage.get<Meeting>("meeting");
      const recordings = (await storage.get<MeetingRecordingMetadata[]>("recordings")) ?? [];
      if (!meeting || meeting.hostId !== actorUserId || !meeting.participants.some((participant) => participant.userId === actorUserId && participant.role === "HOST")) {
        throw new Error("Only the meeting host may control recording.");
      }
      const recording = recordings.find((entry) => entry.recordingId === recordingId && entry.status === MeetingRecordingStatus.RECORDING && entry.initiatedByUserId === actorUserId);
      if (!recording) throw new Error("Active recording not found.");
      const updated: MeetingRecordingMetadata = { ...recording, storageUpload: { uploadId, parts: [] } };
      await storage.put("recordings", recordings.map((entry) => entry.recordingId === recordingId ? updated : entry));
      return updated;
    });
  }

  async recordRecordingPart(recordingId: string, actorUserId: string, part: RecordingUploadedPart): Promise<void> {
    await this.ctx.storage.transaction(async (storage: { get: <T>(key: string) => Promise<T | undefined> | T | undefined; put: (key: string, value: unknown) => Promise<void> | void }) => {
      const meeting = await storage.get<Meeting>("meeting");
      const recordings = (await storage.get<MeetingRecordingMetadata[]>("recordings")) ?? [];
      if (!meeting || meeting.hostId !== actorUserId || !meeting.participants.some((participant) => participant.userId === actorUserId && participant.role === "HOST")) {
        throw new Error("Only the meeting host may control recording.");
      }
      const recording = recordings.find((entry) => entry.recordingId === recordingId && entry.status === MeetingRecordingStatus.RECORDING && entry.initiatedByUserId === actorUserId);
      if (!recording?.storageUpload) throw new Error("Active recording upload not found.");
      if (part.partNumber !== recording.storageUpload.parts.length + 1) throw new Error("Recording parts must be uploaded in order.");
      const updated: MeetingRecordingMetadata = {
        ...recording,
        storageUpload: { ...recording.storageUpload, parts: [...recording.storageUpload.parts, part] },
      };
      await storage.put("recordings", recordings.map((entry) => entry.recordingId === recordingId ? updated : entry));
    });
  }

  async finalizeRecording(recordingId: string, actorUserId: string): Promise<MeetingRecordingMetadata> {
    return this.ctx.storage.transaction(async (storage: { get: <T>(key: string) => Promise<T | undefined> | T | undefined; put: (key: string, value: unknown) => Promise<void> | void }) => {
      const meeting = await storage.get<Meeting>("meeting");
      const recordings = (await storage.get<MeetingRecordingMetadata[]>("recordings")) ?? [];
      if (!meeting || meeting.hostId !== actorUserId || !meeting.participants.some((participant) => participant.userId === actorUserId && participant.role === "HOST")) {
        throw new Error("Only the meeting host may control recording.");
      }
      const recording = recordings.find((entry) => entry.recordingId === recordingId && entry.status === MeetingRecordingStatus.RECORDING && entry.initiatedByUserId === actorUserId);
      if (!recording?.storageUpload?.parts.length) throw new Error("Recording has no retained media parts.");
      const updated: MeetingRecordingMetadata = {
        ...recording,
        status: MeetingRecordingStatus.STOPPED,
        stoppedAt: new Date().toISOString(),
        sizeBytes: recording.storageUpload.parts.reduce((total, part) => total + part.size, 0),
        storageUpload: undefined,
      };
      await storage.put("recordings", recordings.map((entry) => entry.recordingId === recordingId ? updated : entry));
      return updated;
    });
  }

  async failRecording(recordingId: string, actorUserId: string, failureCode: "CAPTURE_FAILED" | "STORAGE_FAILED" | "UPLOAD_FAILED"): Promise<MeetingRecordingMetadata> {
    return this.ctx.storage.transaction(async (storage: { get: <T>(key: string) => Promise<T | undefined> | T | undefined; put: (key: string, value: unknown) => Promise<void> | void }) => {
      const meeting = await storage.get<Meeting>("meeting");
      const recordings = (await storage.get<MeetingRecordingMetadata[]>("recordings")) ?? [];
      if (!meeting || meeting.hostId !== actorUserId || !meeting.participants.some((participant) => participant.userId === actorUserId && participant.role === "HOST")) {
        throw new Error("Only the meeting host may control recording.");
      }
      const recording = recordings.find((entry) => entry.recordingId === recordingId && entry.status === MeetingRecordingStatus.RECORDING && entry.initiatedByUserId === actorUserId);
      if (!recording) throw new Error("Active recording not found.");
      const updated: MeetingRecordingMetadata = { ...recording, status: MeetingRecordingStatus.FAILED, stoppedAt: new Date().toISOString(), failureCode };
      await storage.put("recordings", recordings.map((entry) => entry.recordingId === recordingId ? updated : entry));
      return updated;
    });
  }

  async stopRecording(actorUserId: string): Promise<MeetingRecordingMetadata> {
    const active = (await this.getRecordingMetadata()).find((entry) => entry.status === MeetingRecordingStatus.RECORDING);
    if (!active?.recordingId) throw new Error("No active recording to stop.");
    return this.finalizeRecording(active.recordingId, actorUserId);
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

function toPublicRecordingMetadata(recording: MeetingRecordingMetadata): Omit<MeetingRecordingMetadata, "storageRef" | "storageUpload"> {
  const { storageRef: _storageRef, storageUpload: _storageUpload, ...publicMetadata } = recording;
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
  return new MeetingService(resolveMeetingRepository(env), new NullMediaProvider());
}

function getMeetingStateRpc(env: WorkerEnv, meetingId: string): MeetingStateDurableObject {
  const namespace = env.MEETING_STORE as {
    get: (id: unknown) => MeetingStateDurableObject;
    idFromName: (name: string) => unknown;
  } | undefined;
  if (!namespace || typeof namespace.get !== "function" || typeof namespace.idFromName !== "function") {
    throw new Error("MEETING_STORE Durable Object binding is required.");
  }
  return namespace.get(namespace.idFromName(meetingId));
}

function getCloudflareRealtimeClient(env: WorkerEnv): CloudflareRealtimeConnectionClient {
  const validation = validateRealtimeEnv(env);
  if (!validation.ok) throw new Error("Cloudflare Realtime configuration is missing.");
  return new CloudflareRealtimeConnectionClient(env.REALTIME_SFU_APP_ID!, env.REALTIME_SFU_BEARER_TOKEN!);
}

function getPrivateRecordingBucket(env: WorkerEnv): PrivateRecordingBucket {
  const bucket = env.RECORDINGS_BUCKET as PrivateRecordingBucket | undefined;
  if (!bucket || typeof bucket.createMultipartUpload !== "function" || typeof bucket.resumeMultipartUpload !== "function") {
    throw new Error("Private recording storage is unavailable.");
  }
  return bucket;
}

async function getHostRecording(
  meetingId: string,
  actorUserId: string,
  service: MeetingService,
  recordingId?: string,
): Promise<MeetingRecordingMetadata> {
  const meeting = await service.getMeeting(meetingId);
  if (!meeting) throw new Error("Meeting not found.");
  if (meeting.hostId !== actorUserId || !meeting.participants.some((participant) => participant.userId === actorUserId && participant.role === "HOST")) {
    throw new Error("Only the meeting host may control recording.");
  }
  const recordings = await service.getRecordingMetadata(meetingId, actorUserId);
  const recording = recordings.find((entry) => entry.status === MeetingRecordingStatus.RECORDING && entry.initiatedByUserId === actorUserId && (!recordingId || entry.recordingId === recordingId));
  if (!recording) throw new Error("Active recording not found.");
  return recording;
}

async function requireJoinedMediaMember(env: WorkerEnv, meetingId: string, userId: string): Promise<Meeting> {
  const meeting = await getMeetingService(env).getMeeting(meetingId);
  if (!meeting) throw new Error("Meeting not found.");
  if (meeting.status !== MeetingStatus.ACTIVE) throw new Error("Meeting is not active.");
  const participant = meeting.participants.find((entry) => entry.userId === userId);
  if (!participant || participant.state !== ParticipantState.JOINED) {
    throw new Error("A joined meeting participant is required for media transport.");
  }
  return meeting;
}

function validateMediaConnectionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,80}$/.test(value);
}

function validateMediaSessionDescription(value: unknown): value is { type: "offer" | "answer"; sdp: string } {
  return typeof value === "object" && value !== null &&
    ((value as { type?: unknown }).type === "offer" || (value as { type?: unknown }).type === "answer") &&
    typeof (value as { sdp?: unknown }).sdp === "string" &&
    (value as { sdp: string }).sdp.length > 0 &&
    (value as { sdp: string }).sdp.length <= 256_000;
}

function mediaApiErrorStatus(error: unknown): number {
  if (error instanceof CloudflareRealtimeSessionError) return 502;
  const message = error instanceof Error ? error.message : "";
  if (message === "Meeting not found.") return 404;
  if (message === "Meeting is not active.") return 409;
  if (message.includes("joined meeting participant")) return 403;
  return 400;
}

function validateLocalTracks(value: unknown): value is Array<{ trackName: string; mid: string }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return false;
  const names = new Set<string>();
  return value.every((track) => {
    if (typeof track !== "object" || track === null) return false;
    const candidate = track as { trackName?: unknown; mid?: unknown };
    if (typeof candidate.trackName !== "string" || !["microphone", "camera", "screen-video", "screen-audio"].includes(candidate.trackName)) return false;
    if (typeof candidate.mid !== "string" || candidate.mid.length < 1 || candidate.mid.length > 32 || names.has(candidate.trackName)) return false;
    names.add(candidate.trackName);
    return true;
  });
}

async function closeSfuTransport(
  client: CloudflareRealtimeConnectionClient,
  state: RealtimeParticipantMediaState,
): Promise<void> {
  const publishedMids = [...new Set([
    ...state.publishedTracks.map((track) => track.mid),
    ...(state.pendingPublishedTracks ?? []).map((track) => track.mid),
  ])];
  const subscribedMids = [...new Set([
    ...state.subscribedTracks.map((track) => track.mid),
    ...(state.pendingSubscriptions?.tracks.map((track) => track.mid) ?? []),
  ])];
  for (const [sessionId, mids] of [
    [state.publisherSessionId, publishedMids] as const,
    [state.subscriberSessionId, subscribedMids] as const,
  ]) {
    if (!sessionId || !mids.length) continue;
    try {
      await client.closeTracks(sessionId, mids);
    } catch (error) {
      if (!(error instanceof CloudflareRealtimeSessionError) || ![404, 410].includes(error.upstreamStatus)) throw error;
    }
  }
}

function mediaErrorMessage(error: unknown): string {
  if (error instanceof CloudflareRealtimeSessionError) {
    const detail = [
      error.errorCode ? ` errorCode: ${error.errorCode}.` : "",
      error.errorDescription ? ` errorDescription: ${error.errorDescription}` : "",
    ].join("");
    return `Cloudflare Realtime request failed. HTTP status: ${error.upstreamStatus}.${detail}`;
  }
  return error instanceof Error ? error.message : "Unable to update media transport.";
}

function recordingErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "Meeting not found.") return message;
  if (message.includes("Only the meeting host")) return "Only the meeting host may control recording.";
  if (message === "Meeting is not active.") return message;
  if (message === "Recording is already active.") return message;
  if (message === "Active recording not found.") return message;
  if (message === "Recording has no retained media parts.") return "Recording contains no retained media.";
  if (message === "Recording parts must be uploaded in order.") return message;
  if (message === "Invalid recording part number." || message === "Invalid recording part size.") return message;
  return "Recording storage operation failed.";
}

async function cleanupSfuParticipant(env: WorkerEnv, meetingId: string, userId: string): Promise<void> {
  const rpc = getMeetingStateRpc(env, meetingId);
  const state = await rpc.getSfuParticipantState(userId);
  if (!state) return;
  const client = getCloudflareRealtimeClient(env);
  await closeSfuTransport(client, state);
  await rpc.deleteSfuParticipantState(userId);
}

function parseJsonBody<T>(request: Request): Promise<T | null> {
  return request.json().catch(() => null) as Promise<T | null>;
}

function meetingUiHtml(devToolsEnabled = false): string {
  const page = meetingUiTemplate().replace("__DEV_TOOLS_FLAG__", devToolsEnabled ? "true" : "false");
  return devToolsEnabled ? page : page.replace(/<!--DEV_TOOLS_START-->[\s\S]*?<!--DEV_TOOLS_END-->/g, "");
}

function isDevToolsEnabled(request: Request, env: WorkerEnv): boolean {
  if (env.DEV_TOOLS_ENABLED === "true") return true;
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function meetingUiTemplate(): string {
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
      .media-status {
        color: var(--muted);
        font-size: 12px;
      }
      .media-status.error {
        color: #fbbf24;
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
      .registration-shell {
        max-width: 1080px;
        margin: 28px auto 0;
        display: grid;
        grid-template-columns: minmax(260px, 0.78fr) minmax(0, 1.22fr);
        overflow: hidden;
        border: 1px solid #d7e2f0;
        border-radius: 24px;
        background: #f8fbff;
        color: #12213d;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
      }
      .registration-aside {
        padding: 42px 34px;
        background: radial-gradient(circle at 15% 10%, rgba(93, 142, 255, 0.34), transparent 42%), #0b1b3a;
        color: #e8f0ff;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        min-height: 650px;
      }
      .registration-mark {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        color: #ffffff;
        font-size: 18px;
        font-weight: 800;
        letter-spacing: 0.04em;
      }
      .registration-mark::before {
        content: "BT";
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        border: 1px solid rgba(255, 255, 255, 0.4);
        border-radius: 10px;
        background: #3f72e8;
        font-size: 12px;
        letter-spacing: 0.02em;
      }
      .registration-aside h1 {
        max-width: 310px;
        margin: 70px 0 16px;
        color: #ffffff;
        font-size: clamp(30px, 4vw, 46px);
        line-height: 1.05;
      }
      .registration-aside p {
        max-width: 320px;
        color: #b9c9e8;
        line-height: 1.65;
      }
      .registration-note {
        padding-top: 22px;
        border-top: 1px solid rgba(185, 201, 232, 0.22);
        color: #b9c9e8;
        font-size: 12px;
        line-height: 1.5;
      }
      .registration-form-panel {
        padding: 42px 44px;
        background: #f8fbff;
      }
      .registration-form-panel h2 {
        margin-bottom: 8px;
        color: #12213d;
        font-size: 28px;
      }
      .registration-subtitle {
        margin-bottom: 26px;
        color: #5b6b85;
        line-height: 1.55;
      }
      .registration-form-panel .error {
        color: #8f2841;
        background: #fff2f4;
        border-color: #e8afbb;
      }
      .registration-form {
        display: grid;
        gap: 16px;
      }
      .registration-fields {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }
      .registration-field {
        min-width: 0;
      }
      .registration-field-wide {
        grid-column: 1 / -1;
      }
      .registration-form-panel label {
        display: block;
        margin-bottom: 7px;
        color: #263955;
        font-size: 13px;
        font-weight: 700;
      }
      .registration-form-panel input,
      .registration-form-panel select {
        width: 100%;
        min-height: 46px;
        padding: 11px 13px;
        border: 1px solid #c8d5e6;
        border-radius: 10px;
        outline: none;
        background: #ffffff;
        color: #12213d;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
      }
      .registration-form-panel input:focus,
      .registration-form-panel select:focus {
        border-color: #3f72e8;
        box-shadow: 0 0 0 3px rgba(63, 114, 232, 0.18);
      }
      .registration-form-panel input[aria-invalid="true"],
      .registration-form-panel select[aria-invalid="true"] {
        border-color: #c2415d;
      }
      .password-control {
        position: relative;
      }
      .password-control input {
        padding-right: 68px;
      }
      .password-toggle {
        position: absolute;
        right: 8px;
        bottom: 7px;
        min-height: 32px;
        padding: 5px 8px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: #2f5fc4;
        font-size: 12px;
        font-weight: 700;
      }
      .password-toggle:hover { transform: none; background: #edf3ff; }
      .field-error {
        min-height: 17px;
        margin: 5px 0 0;
        color: #a52e4a;
        font-size: 12px;
      }
      .registration-checks {
        display: grid;
        gap: 11px;
        margin-top: 2px;
      }
      .registration-check {
        display: flex !important;
        align-items: flex-start;
        gap: 10px;
        margin: 0 !important;
        color: #4b5c75 !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        line-height: 1.45;
      }
      .registration-check input {
        flex: 0 0 auto;
        width: 18px;
        min-height: 18px;
        margin-top: 1px;
        accent-color: #3f72e8;
      }
      .registration-check a,
      .registration-back,
      .registration-signin a {
        color: #2f5fc4;
        font-weight: 700;
      }
      .registration-submit {
        width: 100%;
        min-height: 48px;
        margin-top: 4px;
        background: #2459c5;
        color: #ffffff;
        font-weight: 800;
      }
      .registration-submit:hover { background: #1d4cab; }
      .registration-submit:disabled { cursor: wait; opacity: 0.65; transform: none; }
      .registration-signin {
        margin: 18px 0 0;
        color: #5b6b85;
        text-align: center;
        font-size: 13px;
      }
      .registration-back {
        display: inline-block;
        margin-top: 18px;
        color: #5b6b85;
        font-size: 13px;
        text-decoration: none;
      }
      .registration-back:hover { color: #2f5fc4; }
      .registration-success {
        padding: 24px;
        border: 1px solid #b9d9ca;
        border-radius: 14px;
        background: #f1fbf5;
        color: #1d5737;
      }
      .registration-success h3 { color: #174b31; }
      .registration-success p { line-height: 1.55; }
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
      @media (max-width: 720px) {
        .app-shell { padding: 16px; }
        .registration-shell { display: block; margin-top: 12px; border-radius: 18px; }
        .registration-aside { min-height: auto; padding: 26px 22px; }
        .registration-aside h1 { margin: 42px 0 12px; font-size: 34px; }
        .registration-note { margin-top: 28px; }
        .registration-form-panel { padding: 28px 22px; }
        .registration-fields { grid-template-columns: 1fr; gap: 12px; }
        .registration-field-wide { grid-column: auto; }
      }
    </style>
  </head>
  <body>
    <div class="app-shell">
      <div class="topbar">
        <div class="brand">BillionTalks</div>
        <div style="display:flex; align-items:center; gap:10px;">
          <!--DEV_TOOLS_START--><button class="dev-toggle" id="toggleDevPanelBtn" type="button">Developer tools</button><!--DEV_TOOLS_END-->
          <div class="status-pill" id="statusPill">Meeting</div>
        </div>
      </div>

      <!--DEV_TOOLS_START--><div class="dev-panel" id="devPanel" aria-label="Developer tools panel">
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
      </div><!--DEV_TOOLS_END-->

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
                <button class="ghost" id="openRegistrationBtn" type="button">Create an account</button>
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

      <section id="registerScreen" class="screen">
        <div class="registration-shell">
          <aside class="registration-aside">
            <div>
              <div class="registration-mark">BillionTalks</div>
              <h1>Make room for better conversations.</h1>
              <p>Create your account to host thoughtful meetings, bring people together, and keep every conversation moving.</p>
            </div>
            <div class="registration-note">Email verification is required after registration. You will not be signed in automatically.</div>
          </aside>
          <div class="registration-form-panel">
            <div id="registrationFormPanel">
              <div class="kicker" style="color:#2f5fc4;">Join BillionTalks</div>
              <h2>Create your BillionTalks account</h2>
              <p class="registration-subtitle">Set up your account in a few steps. Your mobile number helps keep your account details complete.</p>
              <div id="registrationError" class="error" role="alert" aria-live="polite" style="display:none;"></div>
              <form id="registrationForm" class="registration-form" novalidate>
                <div class="registration-fields">
                  <div class="registration-field registration-field-wide">
                    <label for="registrationFullName">Full name</label>
                    <input id="registrationFullName" name="fullName" type="text" autocomplete="name" maxlength="200" required aria-required="true" />
                    <p id="registrationFullNameError" class="field-error" aria-live="polite"></p>
                  </div>
                  <div class="registration-field">
                    <label for="registrationEmail">Email</label>
                    <input id="registrationEmail" name="email" type="email" autocomplete="email" required aria-required="true" />
                    <p id="registrationEmailError" class="field-error" aria-live="polite"></p>
                  </div>
                  <div class="registration-field">
                    <label for="registrationCountry">Country</label>
                    <select id="registrationCountry" name="country" autocomplete="country" required aria-required="true">
                      <option value="">Select country</option>
                    </select>
                    <p id="registrationCountryError" class="field-error" aria-live="polite"></p>
                  </div>
                  <div class="registration-field registration-field-wide">
                    <label for="registrationMobile">Mobile number with country code</label>
                    <input id="registrationMobile" name="mobileNumber" type="tel" autocomplete="tel" inputmode="tel" placeholder="+1 415 555 0100" required aria-required="true" />
                    <p id="registrationMobileError" class="field-error" aria-live="polite"></p>
                  </div>
                  <div class="registration-field">
                    <label for="registrationPassword">Password</label>
                    <div class="password-control">
                      <input id="registrationPassword" name="password" type="password" autocomplete="new-password" minlength="8" required aria-required="true" />
                      <button class="password-toggle" type="button" data-password-target="registrationPassword">Show</button>
                    </div>
                    <p id="registrationPasswordError" class="field-error" aria-live="polite"></p>
                  </div>
                  <div class="registration-field">
                    <label for="registrationConfirmPassword">Confirm password</label>
                    <div class="password-control">
                      <input id="registrationConfirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required aria-required="true" />
                      <button class="password-toggle" type="button" data-password-target="registrationConfirmPassword">Show</button>
                    </div>
                    <p id="registrationConfirmPasswordError" class="field-error" aria-live="polite"></p>
                  </div>
                </div>
                <div class="registration-checks">
                  <label class="registration-check" for="registrationTerms">
                    <input id="registrationTerms" name="terms" type="checkbox" required aria-required="true" />
                    <span>I agree to the <a href="#terms">Terms of Service</a> and <a href="#privacy">Privacy Policy</a>.</span>
                  </label>
                  <p id="registrationTermsError" class="field-error" aria-live="polite"></p>
                  <label class="registration-check" for="registrationMarketing">
                    <input id="registrationMarketing" name="marketingConsent" type="checkbox" />
                    <span>Send me occasional BillionTalks product updates.</span>
                  </label>
                </div>
                <button id="registrationSubmit" class="registration-submit" type="submit">Create account</button>
              </form>
              <p class="registration-signin">Already have an account? <a href="#sign-in" id="registrationSignInLink">Sign in</a></p>
              <a class="registration-back" href="#home" id="backToHomeFromRegistration">Back to meetings</a>
            </div>
            <div id="registrationSuccessPanel" class="registration-success" hidden role="status" aria-live="polite">
              <div class="kicker" style="color:#27784b;">Almost there</div>
              <h3>Check your email to verify your account.</h3>
              <p>We sent a verification message to <strong id="registrationSuccessEmail"></strong>. Follow the link there before signing in.</p>
              <button class="secondary" id="registrationSuccessBack" type="button">Return to meetings</button>
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
                <span id="mediaStatus" class="media-status" aria-live="polite">Media not connected</span>
                <button id="enableRemotePlaybackBtn" type="button" class="ghost" style="display:none;">Enable playback</button>
                <button class="ghost" id="copyMeetingIdBtn">Copy meeting link</button>
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
              <span id="screenShareUnavailableMessage" class="media-status" role="status" style="display:none;">Screen sharing is not supported by this browser or device.</span>
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
        mediaConnectionId: '',
        mediaStatus: 'idle',
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
        register: document.getElementById('registerScreen'),
        prejoin: document.getElementById('prejoinScreen'),
        meeting: document.getElementById('meetingScreen'),
        ended: document.getElementById('endedScreen'),
      };

      const statusPill = document.getElementById('statusPill');
      const errorBanner = document.getElementById('errorBanner');
      let registrationSubmitPending = false;

      const registrationCountryCodes = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');

      function populateRegistrationCountries() {
        const select = document.getElementById('registrationCountry');
        if (!select || select.options.length > 1) return;
        let names;
        try {
          names = new Intl.DisplayNames(['en'], { type: 'region' });
        } catch {
          names = null;
        }
        registrationCountryCodes
          .map((code) => ({ code, name: names?.of(code) || code }))
          .sort((left, right) => left.name.localeCompare(right.name))
          .forEach(({ code, name }) => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = name;
            select.appendChild(option);
          });
      }

      function setRegistrationFieldError(fieldId, message) {
        const field = document.getElementById(fieldId);
        const error = document.getElementById(fieldId + 'Error');
        if (field) field.setAttribute('aria-invalid', message ? 'true' : 'false');
        if (error) error.textContent = message || '';
      }

      function setRegistrationError(message) {
        const error = document.getElementById('registrationError');
        if (!error) return;
        error.textContent = message || '';
        error.style.display = message ? 'block' : 'none';
      }

      function resetRegistrationForm() {
        const form = document.getElementById('registrationForm');
        const formPanel = document.getElementById('registrationFormPanel');
        const successPanel = document.getElementById('registrationSuccessPanel');
        if (form instanceof HTMLFormElement) form.reset();
        if (formPanel) formPanel.hidden = false;
        if (successPanel) successPanel.hidden = true;
        ['registrationFullName', 'registrationEmail', 'registrationCountry', 'registrationMobile', 'registrationPassword', 'registrationConfirmPassword', 'registrationTerms'].forEach((fieldId) => setRegistrationFieldError(fieldId, ''));
        setRegistrationError(null);
        registrationSubmitPending = false;
        const submit = document.getElementById('registrationSubmit');
        if (submit instanceof HTMLButtonElement) {
          submit.disabled = false;
          submit.textContent = 'Create account';
        }
      }

      function validateRegistrationForm() {
        const getValue = (id) => document.getElementById(id)?.value || '';
        const fullName = getValue('registrationFullName').trim();
        const email = getValue('registrationEmail').trim();
        const country = getValue('registrationCountry');
        const mobileNumber = getValue('registrationMobile').trim();
        const password = getValue('registrationPassword');
        const confirmPassword = getValue('registrationConfirmPassword');
        const termsAccepted = document.getElementById('registrationTerms')?.checked === true;
        const marketingConsent = document.getElementById('registrationMarketing')?.checked === true;
        const mobileCompact = mobileNumber.replace(/[\\s().-]/gu, '');
        let valid = true;

        const fieldErrors = {
          registrationFullName: !fullName ? 'Enter your full name.' : '',
          registrationEmail: !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/u.test(email) ? 'Enter a valid email address.' : '',
          registrationCountry: !country ? 'Select your country.' : '',
          registrationMobile: !/^\\+[1-9]\\d{1,14}$/u.test(mobileCompact) ? 'Use an international number with country code.' : '',
          registrationPassword: Array.from(password).length < 8 ? 'Use at least 8 characters.' : '',
          registrationConfirmPassword: password !== confirmPassword ? 'Passwords do not match.' : '',
          registrationTerms: !termsAccepted ? 'Accept the Terms and Privacy Policy to continue.' : '',
        };
        Object.entries(fieldErrors).forEach(([fieldId, message]) => {
          setRegistrationFieldError(fieldId, message);
          if (message) valid = false;
        });
        if (!valid) {
          const firstInvalid = Object.entries(fieldErrors).find(([, message]) => message)?.[0];
          document.getElementById(firstInvalid)?.focus();
          return null;
        }
        return { fullName, email, country, mobileNumber, password, acceptedTerms: true, marketingConsent };
      }

      async function submitRegistration(event) {
        event.preventDefault();
        if (registrationSubmitPending) return;
        setRegistrationError(null);
        const registration = validateRegistrationForm();
        if (!registration) return;
        registrationSubmitPending = true;
        const submit = document.getElementById('registrationSubmit');
        if (submit instanceof HTMLButtonElement) {
          submit.disabled = true;
          submit.textContent = 'Creating account...';
        }
        try {
          const response = await fetch('/api/accounts/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(registration),
          });
          let payload = null;
          try { payload = await response.json(); } catch { /* Use the generic fallback below. */ }
          if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'We could not create your account. Please try again.');
          document.getElementById('registrationFormPanel').hidden = true;
          document.getElementById('registrationSuccessPanel').hidden = false;
          document.getElementById('registrationSuccessEmail').textContent = registration.email;
        } catch (error) {
          setRegistrationError(error instanceof Error ? error.message : 'We could not create your account. Please try again.');
        } finally {
          registrationSubmitPending = false;
          if (submit instanceof HTMLButtonElement && !document.getElementById('registrationFormPanel')?.hidden) {
            submit.disabled = false;
            submit.textContent = 'Create account';
          }
        }
      }

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
      let activeRecordingCapture = null;
      let historyRefreshPending = false;
      let publisherPeerConnection = null;
      let subscriberPeerConnection = null;
      let publisherOperationQueue = Promise.resolve();
      let subscriberOperationQueue = Promise.resolve();
      let mediaRecoveryQueue = Promise.resolve();
      let mediaRecoveryInProgress = false;
      let mediaRecoveryNeedsReconcile = false;
      let publisherRecoveryPending = false;
      let subscriberRecoveryPending = false;
      let publisherRecoveryPromise = null;
      let subscriberRecoveryPromise = null;
      let mediaTransportClosing = false;
      const mediaDisconnectTimers = new Map();
      let remotePlaybackBlocked = false;
      let publishedLocalTracks = new Map();
      let remoteTrackByMid = new Map();
      let remoteStreams = new Map();

      function escapeHtml(value) {
        const span = document.createElement('span');
        span.textContent = String(value || '');
        return span.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
      }

      // Publisher and subscriber requests mutate the same per-participant server record, so they share one chain to avoid lost updates.
      let mediaOperationQueue = Promise.resolve();
      let publishRetryCount = 0;
      const mediaDiagnostics = {
        publishers: {}, discovered: 0, subscribed: 0, lastError: '',
        subscriptionResultCount: 0, ontrackCount: 0, droppedTrackCount: 0, iceTimeoutCount: 0,
        subscriberRecoveryCount: 0, lastPlay: 'none', subscriberMutations: [],
      };
      let subscriberFailureCount = 0;
      let subscriberSessionLabel = 0;
      let queuedSubscriberRefresh = null;
      let subscriberMutationSeq = 0;

      // The upstream session id stays server-side; this label identifies the browser-side subscriber PeerConnection.
      function beginSubscriberMutation(type, peer, pendingOperationId) {
        const entry = {
          seq: ++subscriberMutationSeq, type, session: 'subscriber-' + subscriberSessionLabel,
          startedAt: new Date().toISOString(), endedAt: '', signalingBefore: peer.signalingState, signalingAfter: '',
          pendingOperationId: pendingOperationId || '', httpStatus: 0, errorCode: '', errorDescription: '', error: '',
        };
        mediaDiagnostics.subscriberMutations.push(entry);
        if (mediaDiagnostics.subscriberMutations.length > 50) mediaDiagnostics.subscriberMutations.shift();
        return entry;
      }

      function finishSubscriberMutation(entry, peer, errorMessage) {
        entry.endedAt = new Date().toISOString();
        entry.signalingAfter = peer.signalingState;
        if (!errorMessage) return;
        entry.error = errorMessage;
        const code = /errorCode: ([^.]*)\\./.exec(errorMessage);
        const description = /errorDescription: (.*)$/.exec(errorMessage);
        const upstream = /HTTP status: (\\d+)/.exec(errorMessage);
        if (upstream) entry.httpStatus = Number(upstream[1]);
        if (code) entry.errorCode = code[1];
        if (description) entry.errorDescription = description[1];
      }
      const MAX_SUBSCRIBER_FAILURES = 3;
      const DEV_TOOLS_ENABLED = __DEV_TOOLS_FLAG__;

      function snapshotMediaDiagnostics() {
        const peer = subscriberPeerConnection;
        const videoStates = [];
        let streamTrackCount = 0;
        for (const remote of remoteStreams.values()) {
          streamTrackCount += remote.stream.getTracks().length + remote.screenStream.getTracks().length;
          remote.stream.getVideoTracks().forEach((track) => videoStates.push(track.readyState));
        }
        const videos = Array.from(document.querySelectorAll('#videoStage video.remote-media'));
        return {
          iceGatheringState: peer ? peer.iceGatheringState : 'none',
          iceConnectionState: peer ? peer.iceConnectionState : 'none',
          connectionState: peer ? peer.connectionState : 'none',
          remotePublicationCount: mediaDiagnostics.discovered,
          subscriptionResultCount: mediaDiagnostics.subscriptionResultCount,
          ontrackCount: mediaDiagnostics.ontrackCount,
          droppedTrackCount: mediaDiagnostics.droppedTrackCount,
          iceTimeoutCount: mediaDiagnostics.iceTimeoutCount,
          subscriberRecoveryCount: mediaDiagnostics.subscriberRecoveryCount,
          remoteVideoTrackReadyStates: videoStates,
          mediaStreamTrackCount: streamTrackCount,
          videoSrcObjectAssigned: videos.length > 0 && videos.every((video) => Boolean(video.srcObject)),
          lastPlay: mediaDiagnostics.lastPlay,
          subscriberMutations: mediaDiagnostics.subscriberMutations.map((entry) => ({ ...entry })),
        };
      }
      window.btMediaDiagnostics = snapshotMediaDiagnostics;

      function logMediaDiagnostics(event) {
        const snapshot = snapshotMediaDiagnostics();
        const lastMutation = snapshot.subscriberMutations[snapshot.subscriberMutations.length - 1];
        delete snapshot.subscriberMutations;
        console.info('[billiontalks media]', event, snapshot, lastMutation);
      }

      function isSimulatedMeeting() {
        return state.meetingId === 'btm_dev_1234567890';
      }

      function enqueueMediaOperation(direction, operation) {
        const next = mediaOperationQueue.then(operation, operation);
        mediaOperationQueue = next.catch(() => undefined);
        publisherOperationQueue = mediaOperationQueue;
        subscriberOperationQueue = mediaOperationQueue;
        return next;
      }

      function ensureMediaConnectionId() {
        if (!state.mediaConnectionId) state.mediaConnectionId = crypto.randomUUID();
        return state.mediaConnectionId;
      }

      // With allowPartial, a timeout still resolves when the local description already carries candidates; otherwise it rejects.
      function waitForIceGatheringComplete(peer, options) {
        const allowPartial = Boolean(options && options.allowPartial);
        const timeoutMs = window.btIceGatheringTimeoutMs || 10000;
        if (peer.iceGatheringState === 'complete') return Promise.resolve();
        return new Promise((resolve, reject) => {
          let timeoutId = null;
          const cleanup = () => {
            if (timeoutId !== null) clearTimeout(timeoutId);
            peer.removeEventListener('icegatheringstatechange', check);
          };
          const finish = () => {
            cleanup();
            resolve();
          };
          const check = () => {
            if (peer.iceGatheringState === 'complete') finish();
          };
          peer.addEventListener('icegatheringstatechange', check);
          timeoutId = setTimeout(() => {
            cleanup();
            mediaDiagnostics.iceTimeoutCount += 1;
            const hasCandidates = /a=candidate:/.test(String(peer.localDescription && peer.localDescription.sdp || ''));
            logMediaDiagnostics('ice-gathering-timeout candidates=' + hasCandidates);
            if (allowPartial && hasCandidates) {
              resolve();
              return;
            }
            const timeoutError = new Error('WebRTC ICE candidate gathering timed out.');
            timeoutError.name = 'IceGatheringTimeout';
            reject(timeoutError);
          }, timeoutMs);
        });
      }

      function waitForPeerConnectionConnected(peer, timeoutMs = 15000, label = 'Publisher') {
        if (peer.connectionState === 'connected') return Promise.resolve();
        return new Promise((resolve, reject) => {
          let timeoutId = null;
          const cleanup = () => {
            if (timeoutId !== null) clearTimeout(timeoutId);
            peer.removeEventListener('connectionstatechange', check);
          };
          const check = () => {
            if (peer.connectionState === 'connected') {
              cleanup();
              resolve();
            } else if (['failed', 'closed'].includes(peer.connectionState)) {
              cleanup();
              reject(new Error(label + ' media connection ' + peer.connectionState + ' before becoming ready.'));
            }
          };
          peer.addEventListener('connectionstatechange', check);
          timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error(label + ' media connection did not become ready in time.'));
          }, timeoutMs);
          check();
        });
      }

      function updateMediaStatus(value) {
        state.mediaStatus = value;
        const status = document.getElementById('mediaStatus');
        if (status) status.textContent = remotePlaybackBlocked
          ? 'Remote media playback may require user interaction. Select Enable playback.'
          : value;
      }

      function activePeerConnection(direction) {
        return direction === 'publisher' ? publisherPeerConnection : subscriberPeerConnection;
      }

      function clearMediaDisconnectTimer(direction) {
        const timer = mediaDisconnectTimers.get(direction);
        if (timer !== undefined) window.clearTimeout(timer);
        mediaDisconnectTimers.delete(direction);
      }

      function handleMediaPeerState(direction, peer) {
        const recoveryPending = direction === 'publisher' ? publisherRecoveryPending : subscriberRecoveryPending;
        if (peer !== activePeerConnection(direction) || mediaTransportClosing || recoveryPending) return;
        const connectionState = peer.connectionState;
        const iceState = peer.iceConnectionState;
        if (connectionState === 'failed' || iceState === 'failed') {
          clearMediaDisconnectTimer(direction);
          updateMediaStatus(direction + ' media transport failed; recovering.');
          void requestMediaRecovery(direction, 'failed connection state');
          return;
        }
        if (connectionState === 'closed' || iceState === 'closed') {
          clearMediaDisconnectTimer(direction);
          void requestMediaRecovery(direction, 'unexpected closed connection');
          return;
        }
        if (connectionState === 'connected' || iceState === 'connected' || iceState === 'completed') {
          clearMediaDisconnectTimer(direction);
          updateMediaStatus('Media connected');
          return;
        }
        if (connectionState === 'disconnected' || iceState === 'disconnected') {
          if (mediaDisconnectTimers.has(direction)) return;
          updateMediaStatus(direction + ' media temporarily disconnected; waiting for recovery.');
          const timer = window.setTimeout(() => {
            mediaDisconnectTimers.delete(direction);
            const transportReconnected = peer.connectionState === 'connected' || peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed';
            if (!transportReconnected && peer === activePeerConnection(direction) &&
              (peer.connectionState === 'disconnected' || peer.iceConnectionState === 'disconnected')) {
              void requestMediaRecovery(direction, 'connection remained disconnected');
            }
          }, 2000);
          mediaDisconnectTimers.set(direction, timer);
          return;
        }
      }


      function isStaleSfuSessionError(error) {
        return error instanceof Error && /HTTP status: (?:404|410)\\b/.test(error.message);
      }

      function reconcileMediaAfterRecovery(meetingId, userId) {
        if (meetingId !== state.meetingId || userId !== state.currentUserId || state.route !== 'meeting') return;
        const desiredTrackNames = new Set(currentLocalTrackPublications().map((entry) => entry.trackName));
        const obsoleteTrackNames = Array.from(publishedLocalTracks.keys()).filter((trackName) => !desiredTrackNames.has(trackName));
        const closeObsolete = obsoleteTrackNames.length ? closePublishedLocalTracks(obsoleteTrackNames) : Promise.resolve();
        void closeObsolete.finally(() => {
          void publishCurrentLocalTracks();
          void refreshSfuSubscriptions();
        });
      }

      function requestMediaRecovery(direction, reason) {
        const recoveryPending = direction === 'publisher' ? publisherRecoveryPending : subscriberRecoveryPending;
        const existingRecovery = direction === 'publisher' ? publisherRecoveryPromise : subscriberRecoveryPromise;
        if (recoveryPending) return existingRecovery || Promise.resolve(false);
        if (state.route !== 'meeting' || !state.meetingId || !state.currentUserId || mediaTransportClosing) return Promise.resolve(false);

        if (direction === 'publisher') publisherRecoveryPending = true;
        else subscriberRecoveryPending = true;
        mediaRecoveryInProgress = true;
        const meetingId = state.meetingId;
        const userId = state.currentUserId;
        const connectionId = state.mediaConnectionId;
        updateMediaStatus('Recovering ' + direction + ' media transport: ' + reason);

        const recovery = mediaRecoveryQueue.then(async () => {
          await Promise.all([publisherOperationQueue, subscriberOperationQueue]);
          if (meetingId !== state.meetingId || userId !== state.currentUserId || state.route !== 'meeting' || mediaTransportClosing) return false;
          if (reason === 'connection remained disconnected') {
            const peer = activePeerConnection(direction);
            if (peer && (peer.connectionState === 'connected' || peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed')) return false;
          }
          const response = await fetch('/api/meetings/' + encodeURIComponent(meetingId) + '/media/recover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectionId, direction }),
          });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to recover ' + direction + ' media transport.');

          clearMediaDisconnectTimer(direction);
          if (direction === 'publisher') {
            const previousPeer = publisherPeerConnection;
            publisherPeerConnection = null;
            previousPeer?.close();
            publishedLocalTracks.clear();
          } else {
            const previousPeer = subscriberPeerConnection;
            subscriberPeerConnection = null;
            previousPeer?.close();
            const remotes = Array.from(remoteStreams.entries());
            remoteStreams.clear();
            remoteTrackByMid.clear();
            remotes.forEach(([remoteUserId, remote]) => {
              remote.tracks.clear();
              remote.stream.getTracks().forEach((track) => track.stop());
              remote.screenStream.getTracks().forEach((track) => track.stop());
              removeRemoteMediaElements(remoteUserId);
            });
            remotePlaybackBlocked = false;
            const playbackButton = document.getElementById('enableRemotePlaybackBtn');
            if (playbackButton) playbackButton.style.display = 'none';
          }
          if (direction === 'subscriber') mediaDiagnostics.subscriberRecoveryCount += 1;
          logMediaDiagnostics(direction + '-recovered');
          updateMediaStatus(direction + ' media transport recovered. Reconnecting active media.');
          return true;
        });

        const settled = recovery.catch((error) => {
          updateMediaStatus(error instanceof Error ? error.message : 'Unable to recover media transport.');
          return false;
        }).then((recovered) => {
          if (recovered) mediaRecoveryNeedsReconcile = true;
          if (direction === 'publisher') {
            publisherRecoveryPending = false;
            publisherRecoveryPromise = null;
          } else {
            subscriberRecoveryPending = false;
            subscriberRecoveryPromise = null;
          }
          if (!publisherRecoveryPending && !subscriberRecoveryPending) {
            mediaRecoveryInProgress = false;
            const shouldReconcile = mediaRecoveryNeedsReconcile;
            mediaRecoveryNeedsReconcile = false;
            if (shouldReconcile) window.setTimeout(() => reconcileMediaAfterRecovery(meetingId, userId), 0);
          }
          return recovered;
        });
        mediaRecoveryQueue = settled.then(() => undefined);
        if (direction === 'publisher') publisherRecoveryPromise = settled;
        else subscriberRecoveryPromise = settled;
        return settled;
      }

      function createMediaPeerConnection(direction) {
        if (typeof window.RTCPeerConnection !== 'function') return null;
        const peer = new window.RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] });
        peer.onconnectionstatechange = () => handleMediaPeerState(direction, peer);
        peer.oniceconnectionstatechange = () => handleMediaPeerState(direction, peer);
        if (direction === 'subscriber') {
          subscriberSessionLabel += 1;
          // A closed predecessor must never write tracks into the recovered subscriber's streams.
          peer.ontrack = (event) => {
            if (peer !== subscriberPeerConnection) return;
            handleRemoteTrack(event);
          };
        }
        return peer;
      }

      function ensurePublisherPeerConnection() {
        if (!publisherPeerConnection) {
          publisherPeerConnection = createMediaPeerConnection('publisher');
        } else if (['failed', 'closed'].includes(publisherPeerConnection.connectionState)) {
          void requestMediaRecovery('publisher', 'publisher transport unavailable');
          return null;
        } else if (publisherPeerConnection.connectionState === 'disconnected') {
          return null;
        }
        return publisherPeerConnection;
      }

      function ensureSubscriberPeerConnection() {
        if (!subscriberPeerConnection) {
          subscriberPeerConnection = createMediaPeerConnection('subscriber');
        } else if (['failed', 'closed'].includes(subscriberPeerConnection.connectionState)) {
          void requestMediaRecovery('subscriber', 'subscriber transport unavailable');
          return null;
        } else if (subscriberPeerConnection.connectionState === 'disconnected') {
          return null;
        }
        return subscriberPeerConnection;
      }

      function currentLocalTrackPublications() {
        const tracks = [];
        if (state.localDevice.micEnabled && localMediaState.micStream) {
          const track = localMediaState.micStream.getAudioTracks()[0];
          if (track && track.readyState !== 'ended') tracks.push({ trackName: 'microphone', track });
        }
        if (state.localDevice.cameraEnabled && localMediaState.cameraStream) {
          const track = localMediaState.cameraStream.getVideoTracks()[0];
          if (track && track.readyState !== 'ended') tracks.push({ trackName: 'camera', track });
        }
        if (state.localDevice.screenShareEnabled && activeScreenShareStream) {
          const videoTrack = activeScreenShareStream.getVideoTracks()[0];
          const audioTrack = activeScreenShareStream.getAudioTracks()[0];
          if (videoTrack && videoTrack.readyState !== 'ended') tracks.push({ trackName: 'screen-video', track: videoTrack });
          if (audioTrack && audioTrack.readyState !== 'ended') tracks.push({ trackName: 'screen-audio', track: audioTrack });
        }
        return tracks;
      }

      function publishCurrentLocalTracks() {
        if (mediaRecoveryInProgress || isSimulatedMeeting() || state.route !== 'meeting' || !state.meetingId || !state.currentUserId) return Promise.resolve();
        return enqueueMediaOperation('publisher', async () => {
          if (mediaRecoveryInProgress) return;
          // Snapshot inside the queue so a queued publish never uses a stale view of what is being captured.
          const tracks = currentLocalTrackPublications();
          if (!tracks.length) return;
          const peer = ensurePublisherPeerConnection();
          if (!peer) {
            updateMediaStatus('WebRTC is unavailable in this browser');
            return;
          }
          const additions = tracks.filter((entry) => !publishedLocalTracks.has(entry.trackName));
          if (!additions.length) return;
          const connectionId = ensureMediaConnectionId();
          const added = additions.map((entry) => ({
            ...entry,
            transceiver: peer.addTransceiver(entry.track, { direction: 'sendonly' }),
          }));
          try {
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            await waitForIceGatheringComplete(peer);
            const localDescription = peer.localDescription;
            const response = await fetch('/api/meetings/' + encodeURIComponent(state.meetingId) + '/media/publish', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                connectionId,
                sessionDescription: localDescription,
                tracks: added.map((entry) => ({ trackName: entry.trackName, mid: entry.transceiver.mid })),
              }),
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to publish media.');
            await peer.setRemoteDescription(payload.data.sessionDescription);
            await waitForPeerConnectionConnected(peer);
            const acceptedTrackNames = new Set((payload.data.tracks ?? []).map((track) => track.trackName));
            const accepted = added.filter((entry) => acceptedTrackNames.has(entry.trackName));
            if (!accepted.length) throw new Error('Cloudflare Realtime did not accept any local tracks.');
            const readyResponse = await fetch('/api/meetings/' + encodeURIComponent(state.meetingId) + '/media/publish/ready', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ connectionId, trackNames: accepted.map((entry) => entry.trackName) }),
            });
            const readyPayload = await readyResponse.json();
            if (!readyResponse.ok || !readyPayload.ok) throw new Error(readyPayload.error || 'Unable to confirm published media readiness.');
            accepted.forEach((entry) => publishedLocalTracks.set(entry.trackName, entry));
            publishRetryCount = 0;
            updateMediaStatus('Publishing media');
            void refreshSfuSubscriptions();
          } catch (error) {
            if (peer.signalingState === 'have-local-offer') {
              try { await peer.setLocalDescription({ type: 'rollback' }); } catch { /* peer already closed */ }
            }
            added.forEach((entry) => {
              try { entry.transceiver.stop(); } catch { /* already stopped */ }
            });
            const message = error instanceof Error ? error.message : 'Unable to publish media';
            updateMediaStatus(message);
            if (isStaleSfuSessionError(error) || /Publisher media connection (?:failed|closed)|did not become ready/.test(message)) {
              void requestMediaRecovery('publisher', message);
            } else if (/pending media negotiation/.test(message) && publishRetryCount < 3) {
              // A subscriber negotiation was in flight; finish it, then publish again.
              publishRetryCount += 1;
              void refreshSfuSubscriptions().then(() => publishCurrentLocalTracks());
            }
          }
        });
      }

      function closePublishedLocalTracks(trackNames) {
        if (mediaRecoveryInProgress || !state.mediaConnectionId || !state.meetingId || !trackNames.length) return Promise.resolve();
        return enqueueMediaOperation('publisher', async () => {
          if (mediaRecoveryInProgress) return;
          const closing = trackNames.filter((trackName) => publishedLocalTracks.has(trackName));
          if (!closing.length) return;
          const peer = publisherPeerConnection;
          let offer = null;
          try {
            // Stopping the transceivers and negotiating immediately keeps the browser's and the server's m-line lists identical.
            if (peer && peer.signalingState === 'stable' && peer.connectionState !== 'closed') {
              for (const trackName of closing) {
                try { publishedLocalTracks.get(trackName)?.transceiver.stop(); } catch { /* already stopped */ }
              }
              await peer.setLocalDescription(await peer.createOffer());
              await waitForIceGatheringComplete(peer);
              offer = peer.localDescription;
            }
            const response = await fetch('/api/meetings/' + encodeURIComponent(state.meetingId) + '/media/tracks/close', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ connectionId: state.mediaConnectionId, trackNames: closing, ...(offer ? { sessionDescription: offer } : {}) }),
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to stop published media.');
            if (offer && peer.signalingState === 'have-local-offer') {
              if (payload.data && payload.data.sessionDescription) await peer.setRemoteDescription(payload.data.sessionDescription);
              else await peer.setLocalDescription({ type: 'rollback' });
            }
            for (const trackName of closing) publishedLocalTracks.delete(trackName);
          } catch (error) {
            if (peer && peer.signalingState === 'have-local-offer') {
              try { await peer.setLocalDescription({ type: 'rollback' }); } catch { /* peer already closed */ }
            }
            const message = error instanceof Error ? error.message : 'Unable to stop published media';
            updateMediaStatus(message);
            if (isStaleSfuSessionError(error)) void requestMediaRecovery('publisher', message);
          }
        });
      }

      function removeRemoteMediaElements(userId) {
        const stage = document.getElementById('videoStage');
        const tile = stage && Array.from(stage.querySelectorAll('.tile')).find((entry) => entry.dataset.userId === userId);
        tile?.querySelectorAll('.remote-media, .remote-screen-media').forEach((element) => {
          element.srcObject = null;
          element.remove();
        });
      }

      function handleRemoteTrack(event) {
        mediaDiagnostics.ontrackCount += 1;
        const publication = remoteTrackByMid.get(event.transceiver.mid);
        if (!publication) {
          mediaDiagnostics.droppedTrackCount += 1;
          return;
        }
        let remote = remoteStreams.get(publication.publisherUserId);
        if (!remote) {
          remote = { displayName: publication.publisherDisplayName, stream: new MediaStream(), screenStream: new MediaStream(), tracks: new Map() };
          remoteStreams.set(publication.publisherUserId, remote);
        }
        remote.displayName = publication.publisherDisplayName;
        // Screen content gets its own stream so a <video> never has to choose between camera and screen tracks.
        const targetStream = /^screen-/.test(publication.trackName || '') ? remote.screenStream : remote.stream;
        const previousTrack = remote.tracks.get(publication.publicationKey);
        if (previousTrack === event.track) return;
        for (const [existingKey, existingTrack] of remote.tracks) {
          if (existingTrack === event.track && existingKey !== publication.publicationKey) {
            remote.tracks.delete(existingKey);
          }
        }
        if (previousTrack) targetStream.removeTrack(previousTrack);
        if (!targetStream.getTracks().includes(event.track)) targetStream.addTrack(event.track);
        remote.tracks.set(publication.publicationKey, event.track);
        if (previousTrack && previousTrack.readyState !== 'ended') {
          try { previousTrack.stop(); } catch { /* obsolete remote track */ }
        }
        event.track.addEventListener?.('ended', () => {
          if (remote.tracks.get(publication.publicationKey) !== event.track) return;
          targetStream.removeTrack(event.track);
          remote.tracks.delete(publication.publicationKey);
          if (!remote.tracks.size) {
            if (remoteStreams.get(publication.publisherUserId) === remote) remoteStreams.delete(publication.publisherUserId);
            removeRemoteMediaElements(publication.publisherUserId);
          }
          renderRemoteMediaStreams();
        }, { once: true });
        renderRemoteMediaStreams();
      }

      function renderRemoteMediaStreams() {
        const stage = document.getElementById('videoStage');
        if (!stage) return;
        const joinedUserIds = new Set((state.meeting?.participants ?? [])
          .filter((participant) => participant.state === 'JOINED')
          .map((participant) => participant.userId));
        for (const [userId, remote] of remoteStreams) {
          if (!joinedUserIds.has(userId)) {
            remote.tracks.clear();
            remoteStreams.delete(userId);
            remote.stream.getTracks().forEach((track) => track.stop());
            remote.screenStream.getTracks().forEach((track) => track.stop());
            removeRemoteMediaElements(userId);
            for (const [mid, publication] of remoteTrackByMid) {
              if (publication.publisherUserId === userId) remoteTrackByMid.delete(mid);
            }
          }
        }
        for (const [userId, remote] of remoteStreams) {
          const tile = Array.from(stage.querySelectorAll('.tile')).find((entry) => entry.dataset.userId === userId);
          if (!tile) continue;
          const hasVideo = remote.stream.getVideoTracks().some((track) => track.readyState !== 'ended');
          if (hasVideo) tile.querySelector('audio.remote-media')?.remove();
          else tile.querySelector('video.remote-media')?.remove();
          const selector = hasVideo ? 'video.remote-media' : 'audio.remote-media';
          let element = tile.querySelector(selector);
          if (!element) {
            element = document.createElement(hasVideo ? 'video' : 'audio');
            element.className = 'remote-media';
            element.autoplay = true;
            element.playsInline = true;
            element.muted = false;
            element.style.width = '100%';
            element.style.height = '100%';
            element.style.objectFit = 'cover';
            if (!hasVideo) element.style.display = 'none';
            tile.appendChild(element);
          }
          element.srcObject = remote.stream;
          const screenActive = remote.screenStream.getTracks().some((track) => track.readyState !== 'ended');
          let screenElement = tile.querySelector('video.remote-screen-media');
          if (screenActive && !screenElement) {
            screenElement = document.createElement('video');
            screenElement.className = 'remote-screen-media';
            screenElement.autoplay = true;
            screenElement.playsInline = true;
            screenElement.muted = false;
            screenElement.style.width = '100%';
            screenElement.style.height = '100%';
            screenElement.style.objectFit = 'contain';
            tile.appendChild(screenElement);
          } else if (!screenActive && screenElement) {
            screenElement.srcObject = null;
            screenElement.remove();
            screenElement = null;
          }
          if (screenElement) screenElement.srcObject = remote.screenStream;
          if (hasVideo) element.style.display = screenActive ? 'none' : '';
          const placeholder = tile.querySelector('.placeholder');
          if (placeholder) placeholder.style.display = hasVideo || screenActive ? 'none' : 'block';
          const showPlaybackButton = () => {
            remotePlaybackBlocked = true;
            updateMediaStatus(state.mediaStatus || 'Receiving media');
            const playbackButton = document.getElementById('enableRemotePlaybackBtn');
            if (playbackButton) playbackButton.style.display = 'inline-flex';
          };
          if (screenElement) startRemotePlayback(screenElement, showPlaybackButton);
          startRemotePlayback(element, showPlaybackButton);
        }
        updateRemoteTileDiagnostics();
      }

      // Autoplay policies block unmuted playback; video still renders muted until the user enables audio.
      function startRemotePlayback(element, onBlocked) {
        const markPlaying = () => {
          mediaDiagnostics.lastPlay = 'success';
          element.dataset.playback = element.dataset.autoMuted ? 'muted' : 'playing';
          updateRemoteTileDiagnostics();
        };
        void element.play().then(markPlaying).catch((error) => {
          mediaDiagnostics.lastPlay = 'failure:' + (error && error.name || 'unknown');
          onBlocked();
          if (element.tagName !== 'VIDEO' || element.muted) {
            element.dataset.playback = 'blocked';
            updateRemoteTileDiagnostics();
            return;
          }
          element.muted = true;
          element.dataset.autoMuted = 'true';
          void element.play().then(markPlaying).catch(() => {
            element.dataset.playback = 'blocked';
            updateRemoteTileDiagnostics();
          });
        });
      }

      // Records the first stage at which a remote participant's media is missing, for tests and live debugging.
      function remoteMediaStage(userId) {
        const discovered = mediaDiagnostics.publishers[userId] || [];
        const mapped = Array.from(remoteTrackByMid.values()).filter((publication) => publication.publisherUserId === userId);
        if (!discovered.length && !mapped.length) return 'no-publication';
        if (!mapped.length) return 'no-subscription';
        const remote = remoteStreams.get(userId);
        if (!remote || !remote.tracks.size) return 'no-track';
        const stage = document.getElementById('videoStage');
        const tile = stage && Array.from(stage.querySelectorAll('.tile')).find((entry) => entry.dataset.userId === userId);
        const elements = tile ? Array.from(tile.querySelectorAll('video.remote-media, audio.remote-media, video.remote-screen-media')) : [];
        if (!elements.length || elements.some((entry) => !entry.srcObject)) return 'not-assigned';
        if (elements.some((entry) => entry.dataset.playback === 'blocked' || entry.dataset.playback === 'muted')) return 'playback-blocked';
        return 'playing';
      }

      function updateRemoteTileDiagnostics() {
        const stage = document.getElementById('videoStage');
        if (!stage) return;
        stage.querySelectorAll('.tile').forEach((tile) => {
          const userId = tile.dataset.userId;
          if (!userId || tile.classList.contains('self') || userId === state.currentUserId) return;
          tile.dataset.mediaState = remoteMediaStage(userId);
        });
      }

      async function enableRemotePlayback() {
        const elements = Array.from(document.querySelectorAll('#videoStage .remote-media, #videoStage .remote-screen-media'));
        let playbackFailed = false;
        for (const element of elements) {
          const wasAutoMuted = Boolean(element.dataset.autoMuted);
          if (wasAutoMuted) element.muted = false;
          try {
            await element.play();
            delete element.dataset.autoMuted;
            element.dataset.playback = 'playing';
          } catch {
            if (wasAutoMuted) element.muted = true;
            playbackFailed = true;
          }
        }
        updateRemoteTileDiagnostics();
        if (playbackFailed) return;
        remotePlaybackBlocked = false;
        const playbackButton = document.getElementById('enableRemotePlaybackBtn');
        if (playbackButton) playbackButton.style.display = 'none';
        updateMediaStatus(state.mediaStatus || 'Receiving media');
      }

      function removeRemotePublications(removed) {
        for (const publication of removed) {
          if (remoteTrackByMid.get(publication.mid)?.publicationKey === publication.publicationKey) remoteTrackByMid.delete(publication.mid);
          const remote = remoteStreams.get(publication.publisherUserId);
          const track = remote?.tracks.get(publication.publicationKey);
          if (!remote || !track) continue;
          remote.tracks.delete(publication.publicationKey);
          remote.stream.removeTrack(track);
          remote.screenStream.removeTrack(track);
          try { track.stop(); } catch { /* already ended */ }
          if (!remote.tracks.size) {
            remoteStreams.delete(publication.publisherUserId);
            removeRemoteMediaElements(publication.publisherUserId);
          }
        }
        renderRemoteMediaStreams();
      }

      function refreshSfuSubscriptions() {
        if (mediaRecoveryInProgress || isSimulatedMeeting() || state.route !== 'meeting' || !state.meetingId || !state.currentUserId || !state.mediaConnectionId && typeof window.RTCPeerConnection !== 'function') return Promise.resolve();
        if (queuedSubscriberRefresh) return queuedSubscriberRefresh;
        queuedSubscriberRefresh = enqueueMediaOperation('subscriber', async () => {
          queuedSubscriberRefresh = null;
          if (mediaRecoveryInProgress) return;
          const peer = ensureSubscriberPeerConnection();
          if (!peer) return;
          let mutation = null;
          try {
            mutation = beginSubscriberMutation('subscribe', peer);
            const response = await fetch('/api/meetings/' + encodeURIComponent(state.meetingId) + '/media/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ connectionId: ensureMediaConnectionId() }),
            });
            const payload = await response.json();
            mutation.httpStatus = response.status;
            if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to subscribe to media.');
            const data = payload.data;
            mutation.pendingOperationId = data && data.operationId || '';
            if (data && data.diagnostics) {
              mediaDiagnostics.publishers = data.diagnostics.publishers || {};
              mediaDiagnostics.discovered = data.diagnostics.discovered || 0;
              mediaDiagnostics.subscribed = data.diagnostics.subscribed || 0;
              mediaDiagnostics.lastError = '';
              updateRemoteTileDiagnostics();
            }
            if (!data || !data.sessionDescription || !data.operationId || !Array.isArray(data.tracks)) {
              finishSubscriberMutation(mutation, peer);
              return;
            }
            const removed = Array.isArray(data.removed) ? data.removed : [];
            if (!data.tracks.length && !removed.length) {
              finishSubscriberMutation(mutation, peer);
              return;
            }
            if (!data.tracks.length) mutation.type = 'tracks/close';
            for (const track of data.tracks) remoteTrackByMid.set(track.mid, track);
            mediaDiagnostics.subscriptionResultCount = data.tracks.length;
            if (peer.signalingState !== 'stable') await peer.setLocalDescription({ type: 'rollback' });
            await peer.setRemoteDescription(data.sessionDescription);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            await waitForIceGatheringComplete(peer, { allowPartial: true });
            finishSubscriberMutation(mutation, peer);
            mutation = beginSubscriberMutation('renegotiate', peer, data.operationId);
            const renegotiated = await fetch('/api/meetings/' + encodeURIComponent(state.meetingId) + '/media/renegotiate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                connectionId: state.mediaConnectionId,
                operationId: data.operationId,
                sessionDescription: peer.localDescription,
              }),
            });
            const renegotiatedPayload = await renegotiated.json();
            mutation.httpStatus = renegotiated.status;
            if (!renegotiated.ok || !renegotiatedPayload.ok) throw new Error(renegotiatedPayload.error || 'Unable to complete media negotiation.');
            finishSubscriberMutation(mutation, peer);
            mutation = null;
            if (data.tracks.length) await waitForPeerConnectionConnected(peer, 15000, 'Subscriber');
            subscriberFailureCount = 0;
            if (removed.length) {
              removeRemotePublications(removed);
              void refreshSfuSubscriptions();
            }
            updateMediaStatus('Receiving media');
            updateRemoteTileDiagnostics();
            logMediaDiagnostics('subscriber-negotiated');
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to receive media';
            if (mutation) finishSubscriberMutation(mutation, peer, message);
            mediaDiagnostics.lastError = message;
            updateMediaStatus(message);
            logMediaDiagnostics('subscriber-error ' + message);
            // A 406 means the upstream session may be mid-exchange; the outcome is unknown, so replace the session instead of retrying.
            const unrecoverableNegotiation = (error instanceof Error && error.name === 'IceGatheringTimeout') ||
              /no longer current|Subscriber media connection|HTTP status: 406/.test(message);
            if (isStaleSfuSessionError(error) || unrecoverableNegotiation) {
              subscriberFailureCount += 1;
              if (subscriberFailureCount > MAX_SUBSCRIBER_FAILURES) {
                updateMediaStatus('Remote media could not connect. Check your network connection and rejoin the meeting.');
              } else {
                void requestMediaRecovery('subscriber', message);
              }
            }
          }
        });
        return queuedSubscriberRefresh;
      }

      function closeRealtimeTransports(meetingId) {
        const connectionId = state.mediaConnectionId;
        mediaTransportClosing = true;
        clearMediaDisconnectTimer('publisher');
        clearMediaDisconnectTimer('subscriber');
        const closeRequest = connectionId && meetingId
          ? fetch('/api/meetings/' + encodeURIComponent(meetingId) + '/media/close', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ connectionId }),
            }).catch(() => undefined)
          : Promise.resolve();
        publisherPeerConnection?.close();
        subscriberPeerConnection?.close();
        publisherPeerConnection = null;
        subscriberPeerConnection = null;
        publishedLocalTracks.clear();
        remoteTrackByMid.clear();
        remoteStreams.clear();
        state.mediaConnectionId = '';
        state.mediaStatus = 'idle';
        remotePlaybackBlocked = false;
        const playbackButton = document.getElementById('enableRemotePlaybackBtn');
        if (playbackButton) playbackButton.style.display = 'none';
        return closeRequest.finally(() => { mediaTransportClosing = false; });
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
        void closeRealtimeTransports(state.meetingId);
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
          statusElement.textContent = 'Recording meeting media to private storage.';
        } else if (current && current.status === 'STOPPED') {
          const size = Number.isFinite(current.sizeBytes) ? ' (' + current.sizeBytes + ' bytes)' : '';
          statusElement.textContent = 'Recording saved to private storage' + size + '.';
        } else if (current && current.status === 'FAILED') {
          statusElement.textContent = 'Recording failed' + (current.failureCode ? ' (' + current.failureCode + ')' : '') + '.';
        } else {
          statusElement.textContent = 'Not started.';
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

      function createRecordingCapture(meetingId, recordingId) {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const context = canvas.getContext('2d');
        if (!context || typeof canvas.captureStream !== 'function') throw new Error('This browser cannot capture the meeting stage.');

        const videoStream = canvas.captureStream(15);
        const outputTracks = videoStream.getTracks();
        const audioTracks = [];
        const audioSources = [];
        const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
        const audioInputs = [localMediaState.micStream, activeScreenShareStream, ...Array.from(remoteStreams.values()).flatMap((remote) => [remote.stream, remote.screenStream])];
        const liveAudioTracks = audioInputs.filter(Boolean).flatMap((stream) => stream.getAudioTracks())
          .filter((track) => track.readyState !== 'ended');
        let audioContext = null;
        if (liveAudioTracks.length) {
          if (!AudioContextConstructor) throw new Error('This browser cannot mix meeting audio for recording.');
          audioContext = new AudioContextConstructor();
          const destination = audioContext.createMediaStreamDestination();
          for (const track of liveAudioTracks) {
            const source = audioContext.createMediaStreamSource(new window.MediaStream([track]));
            source.connect(destination);
            audioSources.push(source);
          }
          audioTracks.push(...destination.stream.getAudioTracks());
        }

        const mediaStream = new window.MediaStream([...outputTracks, ...audioTracks]);
        const MediaRecorderConstructor = window.MediaRecorder;
        if (typeof MediaRecorderConstructor !== 'function') throw new Error('MediaRecorder is unavailable in this browser.');
        const preferredType = 'video/webm;codecs=vp8,opus';
        const recorderOptions = MediaRecorderConstructor.isTypeSupported?.(preferredType) ? { mimeType: preferredType } : { mimeType: 'video/webm' };
        const recorder = new MediaRecorderConstructor(mediaStream, recorderOptions);
        const partSize = 5 * 1024 * 1024;
        let pendingBlobs = [];
        let pendingBytes = 0;
        let queuedBytes = 0;
        let partNumber = 0;
        let uploadError = null;
        let fatalErrorReported = false;
        let captureStopped = false;
        let uploadQueue = Promise.resolve();
        let drawTimer = null;
        let resolveStopped;
        let resourcesCleaned = false;
        const stopped = new Promise((resolve) => { resolveStopped = resolve; });

        const cleanupResources = () => {
          if (resourcesCleaned) return;
          resourcesCleaned = true;
          if (drawTimer !== null) window.clearInterval(drawTimer);
          audioSources.forEach((source) => source.disconnect());
          if (audioContext) void audioContext.close();
          mediaStream.getTracks().forEach((track) => track.stop());
        };

        const drawStage = () => {
          context.fillStyle = '#101820';
          context.fillRect(0, 0, canvas.width, canvas.height);
          const tiles = Array.from(document.querySelectorAll('#videoStage .tile'));
          const columns = Math.max(1, Math.ceil(Math.sqrt(tiles.length)));
          const rows = Math.max(1, Math.ceil(tiles.length / columns));
          const tileWidth = canvas.width / columns;
          const tileHeight = canvas.height / rows;
          tiles.forEach((tile, index) => {
            const x = (index % columns) * tileWidth;
            const y = Math.floor(index / columns) * tileHeight;
            const video = tile.querySelector('video');
            if (video && video.readyState >= 2) {
              try { context.drawImage(video, x, y, tileWidth, tileHeight); } catch {}
            }
            context.fillStyle = 'rgba(0, 0, 0, 0.6)';
            context.fillRect(x + 12, y + tileHeight - 42, Math.max(80, tileWidth - 24), 30);
            context.fillStyle = '#ffffff';
            context.font = '16px sans-serif';
            context.fillText(tile.querySelector('.tile-name')?.textContent || tile.dataset.userId || 'Participant', x + 22, y + tileHeight - 22);
          });
        };

        const reportFatalError = (error, failureCode) => {
          if (fatalErrorReported) return;
          fatalErrorReported = true;
          const message = error instanceof Error ? error.message : 'Recording capture failed.';
          const statusElement = document.getElementById('recordingStatus');
          if (statusElement) statusElement.textContent = message;
          void failRecordingOnServer(meetingId, recordingId, failureCode).catch(() => undefined);
          if (recorder.state !== 'inactive') recorder.stop();
        };

        const uploadPart = (blob, isFinal) => {
          const currentPartNumber = ++partNumber;
          queuedBytes += blob.size;
          uploadQueue = uploadQueue.then(async () => {
            if (uploadError) throw uploadError;
            const response = await fetch('/api/meetings/' + encodeURIComponent(meetingId) + '/recording/' + encodeURIComponent(recordingId) + '/parts/' + currentPartNumber, {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream', 'X-Recording-Final-Part': String(isFinal) },
              body: await blob.arrayBuffer(),
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to upload recorded media.');
            queuedBytes -= blob.size;
            if (recorder.state === 'paused' && queuedBytes < 16 * 1024 * 1024) recorder.resume();
          }).catch((error) => {
            uploadError = error instanceof Error ? error : new Error('Unable to upload recorded media.');
            reportFatalError(uploadError, 'UPLOAD_FAILED');
            if (recorder.state === 'recording') recorder.stop();
            throw uploadError;
          });
          uploadQueue.catch(() => undefined);
          if (queuedBytes > 48 * 1024 * 1024 && recorder.state === 'recording') recorder.pause();
        };

        recorder.addEventListener('dataavailable', (event) => {
          if (!event.data?.size || uploadError) return;
          pendingBlobs.push(event.data);
          pendingBytes += event.data.size;
          let buffered = new Blob(pendingBlobs, { type: 'video/webm' });
          while (buffered.size >= partSize) {
            uploadPart(buffered.slice(0, partSize), false);
            buffered = buffered.slice(partSize);
          }
          pendingBlobs = buffered.size ? [buffered] : [];
          pendingBytes = buffered.size;
        });
        recorder.addEventListener('error', (event) => reportFatalError(event.error || new Error('Browser media capture failed.'), 'CAPTURE_FAILED'));
        recorder.addEventListener('stop', () => {
          captureStopped = true;
          resolveStopped();
          if (fatalErrorReported) cleanupResources();
        }, { once: true });

        return {
          async start() {
            if (audioContext?.state === 'suspended') await audioContext.resume();
            drawStage();
            drawTimer = window.setInterval(drawStage, 250);
            recorder.start(1000);
          },
          async stopAndUpload() {
            if (recorder.state !== 'inactive') recorder.stop();
            if (!captureStopped) await stopped;
            if (uploadError) throw uploadError;
            if (pendingBytes) uploadPart(new Blob(pendingBlobs, { type: 'video/webm' }), true);
            if (!partNumber) throw new Error('The browser produced no recording media.');
            await uploadQueue;
          },
          cleanup: cleanupResources,
          recordingId,
        };
      }

      async function failRecordingOnServer(meetingId, recordingId, failureCode) {
        const response = await fetch('/api/meetings/' + encodeURIComponent(meetingId) + '/recording/' + encodeURIComponent(recordingId) + '/fail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ failureCode }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to update recording status.');
        state.recordings = [...state.recordings.filter((recording) => recording.recordingId !== recordingId), payload.data];
        renderRecordingStatus();
      }

      async function updateRecording(action) {
        if (!state.isHost || recordingActionPending || !state.meetingId || state.route !== 'meeting') return;
        const meetingId = state.meetingId;
        let recordingId = '';
        recordingActionPending = true;
        renderRecordingStatus();
        try {
          if (action === 'stop') {
            const capture = activeRecordingCapture;
            const current = state.recordings.find((recording) => recording.status === 'RECORDING');
            recordingId = current?.recordingId || '';
            if (!recordingId) throw new Error('Active recording metadata is unavailable.');
            if (!capture) {
              await failRecordingOnServer(meetingId, recordingId, 'CAPTURE_FAILED');
              throw new Error('This tab no longer has the active recording capture.');
            }
            try {
              await capture.stopAndUpload();
            } catch (error) {
              await failRecordingOnServer(meetingId, recordingId, 'UPLOAD_FAILED');
              throw error;
            } finally {
              capture.cleanup();
              activeRecordingCapture = null;
            }
          }
          const response = await fetch('/api/meetings/' + encodeURIComponent(meetingId) + '/recording/' + action, { method: 'POST' });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to update recording.');
          recordingId = payload.data.recordingId;
          if (meetingId === state.meetingId) {
            const existing = state.recordings.filter((recording) => recording.recordingId !== payload.data.recordingId);
            state.recordings = [...existing, payload.data];
            renderRecordingStatus();
          }
          if (action === 'start') {
            try {
              activeRecordingCapture = createRecordingCapture(meetingId, recordingId);
              await activeRecordingCapture.start();
            } catch (error) {
              activeRecordingCapture?.cleanup();
              activeRecordingCapture = null;
              await failRecordingOnServer(meetingId, recordingId, 'CAPTURE_FAILED');
              throw error;
            }
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
              await refreshSfuSubscriptions();
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
          // Every route into the meeting (direct join, host approval, rejoin) must capture and publish the devices shown as ON.
          acquireDesiredLocalMedia();
          void publishCurrentLocalTracks();
          void refreshMeetingChat();
          void refreshRecordingStatus();
          void refreshSfuSubscriptions();
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
          } else if (name === 'register') {
            statusPill.textContent = 'Create account';
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
        const shareUnavailableMessage = document.getElementById('screenShareUnavailableMessage');
        const localStatusLabel = document.getElementById('localStatusLabel');
        const canShareScreen = Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');

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
          shareControl.disabled = !canShareScreen;
          shareControl.setAttribute('aria-disabled', String(!canShareScreen));
          shareControl.title = canShareScreen ? 'Screen share' : 'Screen sharing is not supported by this browser or device.';
        }
        if (shareUnavailableMessage) {
          shareUnavailableMessage.textContent = 'Screen sharing is not supported by this browser or device.';
          shareUnavailableMessage.style.display = canShareScreen ? 'none' : 'inline-flex';
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
        deviceStopToken.mic += 1;
        void closePublishedLocalTracks(['microphone']);
        Object.assign(localMediaState, stopLocalMediaStream(localMediaState, 'mic'));
        state.localDevice.micEnabled = false;
        renderLocalState();
      }

      function stopLocalCamera() {
        deviceStopToken.camera += 1;
        void closePublishedLocalTracks(['camera']);
        Object.assign(localMediaState, stopLocalMediaStream(localMediaState, 'camera'));
        state.localDevice.cameraEnabled = false;
        renderLocalState();
      }

      let localCaptureGeneration = 0;
      const deviceStopToken = { mic: 0, camera: 0 };

      function stopAllLocalMedia() {
        localCaptureGeneration += 1;
        stopLocalMicrophone();
        stopLocalCamera();
      }

      function acquireDesiredLocalMedia() {
        if (isSimulatedMeeting()) return;
        const local = state.localDevice;
        if (local.micEnabled && local.micAvailable !== false && !localMediaState.micStream && !localMediaState.micRequestInFlight) void toggleMicrophone();
        if (local.cameraEnabled && local.cameraAvailable !== false && !localMediaState.cameraStream && !localMediaState.cameraRequestInFlight) void toggleCamera();
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
        const stopToken = deviceStopToken.mic;
        try {
          localMediaState.micRequestInFlight = true;
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          if (captureGeneration !== localCaptureGeneration || stopToken !== deviceStopToken.mic) {
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
          if (state.route === 'meeting') void publishCurrentLocalTracks();
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
        const stopToken = deviceStopToken.camera;
        try {
          localMediaState.cameraRequestInFlight = true;
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          if (captureGeneration !== localCaptureGeneration || stopToken !== deviceStopToken.camera) {
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
          if (state.route === 'meeting') void publishCurrentLocalTracks();
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
        const selfParticipant = state.meeting?.participants.find((participant) => participant.userId === state.currentUserId);
        const meetingIsHost = Boolean(state.meeting && state.meeting.status === 'active' && state.currentUserId && state.meeting.hostId === state.currentUserId && selfParticipant?.role === 'HOST');

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
        void closePublishedLocalTracks(['screen-video', 'screen-audio']);
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
          setError('Screen sharing is not supported by this browser or device.');
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
          if (state.route === 'meeting') void publishCurrentLocalTracks();

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
        const isHost = Boolean(state.isHost && state.meeting.status === 'active');
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

      function isLocalParticipant(participant) {
        if (participant.userId === 'user-me' || participant.id === 'demo-me') return true;
        if (state.currentUserId && participant.userId) return participant.userId === state.currentUserId;
        return (participant.displayName || '').trim().toLowerCase() === (state.displayName || '').trim().toLowerCase();
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
        syncMeetingRoleUi();
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
          if (state.isHost && state.meeting.status === 'active' && participant.role !== 'HOST' && participant.state === 'JOINED' && participant.userId) {
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
        const localIndex = orderedParticipants.findIndex((participant) => isLocalParticipant(participant));

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
          if (participant.userId) tile.dataset.userId = participant.userId;
          if (isLocalParticipant(participant)) {
            tile.classList.add('self');
          }

          const tileLabel = isLocalParticipant(participant) ? 'You' : participant.displayName;
          const tileStatus = participant.state === 'JOINED' ? 'Joined' : 'Waiting';
          const isLocalTile = isLocalParticipant(participant);

          tile.innerHTML =
            '<div class="placeholder">' + escapeHtml(tileLabel) + '</div>' +
            '<div class="meta"><span class="dot"></span><span' + (isLocalTile ? ' id="localStatusLabel"' : '') + '>' + tileStatus + '</span></div>';
          stage.appendChild(tile);
        });

        renderLocalState();
        if (activeScreenShareStream) showScreenSharePreview(activeScreenShareStream);
        renderRemoteMediaStreams();
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
          void publishCurrentLocalTracks();
          void refreshSfuSubscriptions();
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Unable to join the meeting.');
        }
      }

      async function leaveMeeting() {
        if (activeRecordingCapture) await updateRecording('stop');
        const meetingId = state.meetingId;
        const userId = state.currentUserId;
        if (!meetingId || !userId) return;
        const mediaCleanup = closeRealtimeTransports(meetingId);
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
          await mediaCleanup;
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
        if (activeRecordingCapture) await updateRecording('stop');
        await runHostAction('/end', { userId: state.currentUserId });
      }

      let copyFeedbackTimer = null;

      function copyTextWithSelectionFallback(text) {
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.top = '0';
        field.style.opacity = '0';
        document.body.appendChild(field);
        try {
          field.focus();
          field.select();
          field.setSelectionRange(0, text.length);
          return typeof document.execCommand === 'function' && document.execCommand('copy');
        } catch {
          return false;
        } finally {
          field.remove();
        }
      }

      async function copyMeetingId() {
        if (!state.meetingId) return;
        const invite = new URL('/', window.location.origin);
        invite.searchParams.set('meeting', state.meetingId);
        const link = invite.toString();
        let copied = false;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          try {
            await navigator.clipboard.writeText(link);
            copied = true;
          } catch {
            copied = false;
          }
        }
        if (!copied) copied = copyTextWithSelectionFallback(link);
        const button = document.getElementById('copyMeetingIdBtn');
        const showCopyResult = (label) => {
          if (!button) return;
          button.textContent = label;
          clearTimeout(copyFeedbackTimer);
          copyFeedbackTimer = setTimeout(() => { button.textContent = 'Copy meeting link'; }, 2500);
        };
        if (copied) {
          setError(null);
          showCopyResult('Link copied');
        } else {
          showCopyResult('Copy failed');
          setError('Copy failed. Copy this link manually: ' + link);
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
        if (!DEV_TOOLS_ENABLED) return;
        // Simulated rooms must never replace a real meeting that owns live media.
        if (state.meetingId && !isSimulatedMeeting() && state.currentUserId && ['meeting', 'prejoin'].includes(state.route)) {
          setError('Leave the real meeting before using developer tools.');
          return;
        }
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

      if (DEV_TOOLS_ENABLED) {
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
      }

      document.getElementById('startMeetingBtn').addEventListener('click', () => {
        setError(null);
        showScreen('create');
      });

      document.getElementById('joinMeetingBtn').addEventListener('click', () => {
        setError(null);
        showScreen('join');
      });

      document.getElementById('openRegistrationBtn').addEventListener('click', () => {
        setError(null);
        resetRegistrationForm();
        showScreen('register');
      });
      document.getElementById('registrationForm').addEventListener('submit', (event) => { void submitRegistration(event); });
      document.getElementById('backToHomeFromRegistration').addEventListener('click', (event) => {
        event.preventDefault();
        showScreen('home');
      });
      document.getElementById('registrationSuccessBack').addEventListener('click', () => showScreen('home'));
      document.querySelectorAll('[data-password-target]').forEach((button) => {
        button.addEventListener('click', () => {
          const target = document.getElementById(button.dataset.passwordTarget);
          if (!(target instanceof HTMLInputElement)) return;
          const visible = target.type === 'text';
          target.type = visible ? 'password' : 'text';
          button.textContent = visible ? 'Show' : 'Hide';
        });
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
        if (state.localDevice.micEnabled) {
          stopLocalMicrophone();
          return;
        }
        void toggleMicrophone();
      });

      document.getElementById('toggleCameraBtn').addEventListener('click', () => {
        if (state.localDevice.cameraEnabled) {
          stopLocalCamera();
          return;
        }
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

      document.getElementById('enableRemotePlaybackBtn').addEventListener('click', () => { void enableRemotePlayback(); });
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

      populateRegistrationCountries();
      renderLocalState();
      const sharedMeetingId = new URLSearchParams(window.location.search).get('meeting');
      if (sharedMeetingId) {
        document.getElementById('meetingIdInput').value = sharedMeetingId;
        showScreen('join');
        setTimeout(() => { void resolveMeeting(); }, 0);
      } else {
        showScreen('home');
      }
    </script>
  </body>
</html>`;
}

const routeHandler = {
  async fetch(request: Request, env: WorkerEnv = {}): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/accounts/register") {
      return handleAccountRegistration(request, env.ACCOUNT_DB);
    }
    if (request.method === "POST" && url.pathname === "/api/accounts/login") {
      return handleAccountLogin(request, env.ACCOUNT_DB);
    }
    if (request.method === "POST" && url.pathname === "/api/accounts/forgot-password") {
      return handleForgotPassword(request, env.ACCOUNT_DB);
    }
    if (request.method === "POST" && url.pathname === "/api/accounts/reset-password") {
      return handleResetPassword(request, env.ACCOUNT_DB);
    }
    if (request.method === "GET" && url.pathname === "/api/accounts/me") {
      return handleAccountMe(request, env.ACCOUNT_DB);
    }
    if (request.method === "PATCH" && url.pathname === "/api/accounts/me") {
      return handleAccountProfileUpdate(request, env.ACCOUNT_DB);
    }
    if (request.method === "POST" && url.pathname === "/api/accounts/logout") {
      return handleAccountLogout(request, env.ACCOUNT_DB);
    }
    if (
      request.method === "POST" &&
      (url.pathname === "/api/accounts/verify-email" || url.pathname === "/api/accounts/resend-verification")
    ) {
      return handleEmailVerification(request, env.ACCOUNT_DB);
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/ui")) {
      const { session } = await getOrCreateSession(request, env);
      return withSessionCookie(
        new Response(meetingUiHtml(isDevToolsEnabled(request, env)), {
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

    const mediaPublishMatch = /^\/api\/meetings\/([^/]+)\/media\/publish$/.exec(url.pathname);

    if (mediaPublishMatch && request.method === "POST") {
      const body = await parseJsonBody<{ connectionId?: string; sessionDescription?: unknown; tracks?: unknown }>(request);
      const { session } = await getOrCreateSession(request, env);
      if (!body || !validateMediaConnectionId(body.connectionId) || !validateMediaSessionDescription(body.sessionDescription) || !validateLocalTracks(body.tracks)) {
        return withSessionCookie(jsonResponse({ ok: false, error: "A media connection, offer, and valid local tracks are required." }, 400), request, session);
      }

      try {
        await requireJoinedMediaMember(env, mediaPublishMatch[1], session.userId);
        const rpc = getMeetingStateRpc(env, mediaPublishMatch[1]);
        const client = getCloudflareRealtimeClient(env);
        let state = await rpc.getSfuParticipantState(session.userId);
        let generation = state?.generation ?? 0;
        if (state && state.connectionId !== body.connectionId) {
          await closeSfuTransport(client, state);
          await rpc.deleteSfuParticipantState(session.userId);
          generation = state.generation;
          state = undefined;
        }
        if (!state) {
          state = {
            userId: session.userId,
            connectionId: body.connectionId,
            generation: generation + 1,
            publishedTracks: [],
            subscribedTracks: [],
          };
          await rpc.saveSfuParticipantState(state);
        }
        if (state.pendingSubscriptions) {
          return withSessionCookie(jsonResponse({ ok: false, error: "Finish the pending media negotiation before publishing." }, 409), request, session);
        }

        if (!state.publisherSessionId) {
          const created = await client.createSession();
          state = { ...state, publisherSessionId: created.sessionId };
          await rpc.saveSfuParticipantState(state);
        }
        const tracks = body.tracks as Array<{ trackName: string; mid: string }>;
        const operation = await client.publishTracks(state.publisherSessionId!, body.sessionDescription, tracks.map((track) => ({
          location: "local" as const,
          trackName: track.trackName,
          mid: track.mid,
        })));
        if (!validateMediaSessionDescription(operation.sessionDescription) || operation.sessionDescription.type !== "answer") {
          throw new Error("Cloudflare Realtime did not return a publish answer.");
        }
        const acceptedTracks = tracks.filter((_track, index) => !operation.tracks?.[index]?.errorCode);
        if (!acceptedTracks.length) throw new Error("Cloudflare Realtime did not accept any local tracks.");
        const pendingByName = new Map((state.pendingPublishedTracks ?? []).map((track) => [track.trackName, track]));
        for (const track of acceptedTracks) pendingByName.set(track.trackName, track);
        state = { ...state, pendingPublishedTracks: [...pendingByName.values()] };
        await rpc.saveSfuParticipantState(state);

        return withSessionCookie(jsonResponse({
          ok: true,
          data: { sessionDescription: operation.sessionDescription, tracks: acceptedTracks },
        }), request, session);
      } catch (error) {
        return withSessionCookie(jsonResponse({ ok: false, error: mediaErrorMessage(error) }, mediaApiErrorStatus(error)), request, session);
      }
    }

    const mediaPublishReadyMatch = /^\/api\/meetings\/([^/]+)\/media\/publish\/ready$/.exec(url.pathname);

    if (mediaPublishReadyMatch && request.method === "POST") {
      const body = await parseJsonBody<{ connectionId?: string; trackNames?: string[] }>(request);
      const { session } = await getOrCreateSession(request, env);
      if (!body || !validateMediaConnectionId(body.connectionId) || !Array.isArray(body.trackNames) || body.trackNames.length < 1 ||
        body.trackNames.some((name) => typeof name !== "string" || !["microphone", "camera", "screen-video", "screen-audio"].includes(name)) ||
        new Set(body.trackNames).size !== body.trackNames.length) {
        return withSessionCookie(jsonResponse({ ok: false, error: "A valid connection and published track names are required." }, 400), request, session);
      }
      try {
        await requireJoinedMediaMember(env, mediaPublishReadyMatch[1], session.userId);
        const rpc = getMeetingStateRpc(env, mediaPublishReadyMatch[1]);
        const state = await rpc.getSfuParticipantState(session.userId);
        if (!state || state.connectionId !== body.connectionId || !state.publisherSessionId) {
          throw new Error("Media publisher is no longer current.");
        }
        const pending = state.pendingPublishedTracks ?? [];
        const requestedNames = new Set(body.trackNames);
        const readyTracks = pending.filter((track) => requestedNames.has(track.trackName));
        if (readyTracks.length !== requestedNames.size) throw new Error("Published media tracks are not awaiting readiness.");
        const publishedByName = new Map(state.publishedTracks.map((track) => [track.trackName, track]));
        readyTracks.forEach((track) => publishedByName.set(track.trackName, track));
        await rpc.saveSfuParticipantState({
          ...state,
          publishedTracks: [...publishedByName.values()],
          pendingPublishedTracks: pending.filter((track) => !requestedNames.has(track.trackName)),
        });
        return withSessionCookie(jsonResponse({ ok: true, data: { ready: readyTracks.map((track) => track.trackName) } }), request, session);
      } catch (error) {
        return withSessionCookie(jsonResponse({ ok: false, error: mediaErrorMessage(error) }, mediaApiErrorStatus(error)), request, session);
      }
    }

    const mediaSubscribeMatch = /^\/api\/meetings\/([^/]+)\/media\/subscribe$/.exec(url.pathname);

    if (mediaSubscribeMatch && request.method === "POST") {
      const body = await parseJsonBody<{ connectionId?: string }>(request);
      const { session } = await getOrCreateSession(request, env);
      if (!body || !validateMediaConnectionId(body.connectionId)) {
        return withSessionCookie(jsonResponse({ ok: false, error: "A valid media connection is required." }, 400), request, session);
      }

      try {
        const meeting = await requireJoinedMediaMember(env, mediaSubscribeMatch[1], session.userId);
        const rpc = getMeetingStateRpc(env, mediaSubscribeMatch[1]);
        const client = getCloudflareRealtimeClient(env);
        let states = await rpc.listSfuParticipantStates();
        let ownState = states.find((state) => state.userId === session.userId);
        let generation = ownState?.generation ?? 0;
        if (ownState && ownState.connectionId !== body.connectionId) {
          await closeSfuTransport(client, ownState);
          await rpc.deleteSfuParticipantState(session.userId);
          generation = ownState.generation;
          ownState = undefined;
          states = states.filter((state) => state.userId !== session.userId);
        }
        if (ownState?.pendingSubscriptions) {
          return withSessionCookie(jsonResponse({
            ok: true,
            data: {
              operationId: ownState.pendingSubscriptions.operationId,
              sessionDescription: ownState.pendingSubscriptions.sessionDescription,
              tracks: ownState.pendingSubscriptions.tracks,
              removed: ownState.pendingSubscriptions.removed ?? [],
            },
          }), request, session);
        }

        const joinedUsers = new Map(meeting.participants
          .filter((participant) => participant.state === ParticipantState.JOINED)
          .map((participant) => [participant.userId, participant]));
        const publications = states.flatMap((publisher) => {
          if (publisher.userId === session.userId || !joinedUsers.has(publisher.userId)) return [];
          const member = joinedUsers.get(publisher.userId)!;
          if (!publisher.publisherSessionId) return [];
          return publisher.publishedTracks.map((track) => ({
            key: `${publisher.userId}:${publisher.generation}:${track.trackName}`,
            publisherSessionId: publisher.publisherSessionId!,
            publisherUserId: publisher.userId,
            publisherDisplayName: member.displayName,
            trackName: track.trackName,
          }));
        }).filter((publication, index, all) =>
          all.findIndex((entry) => entry.publisherSessionId === publication.publisherSessionId && entry.trackName === publication.trackName) === index);

        const publishersByUser: Record<string, string[]> = {};
        for (const publication of publications) (publishersByUser[publication.publisherUserId] ??= []).push(publication.trackName);
        const diagnostics = () => ({
          discovered: publications.length,
          subscribed: ownState?.subscribedTracks.length ?? 0,
          publishers: publishersByUser,
        });

        if (!publications.length && !ownState) {
          return withSessionCookie(jsonResponse({ ok: true, data: { operationId: null, sessionDescription: null, tracks: [], diagnostics: diagnostics() } }), request, session);
        }

        if (!ownState) {
          ownState = {
            userId: session.userId,
            connectionId: body.connectionId,
            generation: generation + 1,
            publishedTracks: [],
            subscribedTracks: [],
          };
          await rpc.saveSfuParticipantState(ownState);
        }

        const desiredKeys = new Set(publications.map((publication) => publication.key));
        const staleTracks = ownState.subscribedTracks.filter((track) => !desiredKeys.has(track.publicationKey));
        if (staleTracks.length) {
          if (ownState.subscriberSessionId) {
            // Non-forced close keeps the media server's m-line order in step with the browser: the removal is delivered as an offer the client must answer.
            const closed = await client.closeTracks(ownState.subscriberSessionId, staleTracks.map((track) => track.mid), { force: false });
            if (validateMediaSessionDescription(closed.sessionDescription) && closed.sessionDescription.type === "offer") {
              const operationId = crypto.randomUUID();
              ownState = {
                ...ownState,
                pendingSubscriptions: { operationId, sessionDescription: closed.sessionDescription, tracks: [], removed: staleTracks },
              };
              await rpc.saveSfuParticipantState(ownState);
              return withSessionCookie(jsonResponse({
                ok: true,
                data: { operationId, sessionDescription: closed.sessionDescription, tracks: [], removed: staleTracks },
              }), request, session);
            }
          }
          ownState = {
            ...ownState,
            subscribedTracks: ownState.subscribedTracks.filter((track) => desiredKeys.has(track.publicationKey)),
          };
          await rpc.saveSfuParticipantState(ownState);
        }

        const subscribedKeys = new Set([
          ...ownState.subscribedTracks.map((track) => track.publicationKey),
          ...(ownState.pendingSubscriptions?.tracks.map((track) => track.publicationKey) ?? []),
        ]);
        const newPublications = publications.filter((publication) => !subscribedKeys.has(publication.key));
        if (!newPublications.length) {
          return withSessionCookie(jsonResponse({ ok: true, data: { operationId: null, sessionDescription: null, tracks: [], diagnostics: diagnostics() } }), request, session);
        }

        if (!ownState.subscriberSessionId) {
          const created = await client.createSession();
          ownState = { ...ownState, subscriberSessionId: created.sessionId };
          await rpc.saveSfuParticipantState(ownState);
        }

        const operation = await client.subscribeTracks(ownState.subscriberSessionId!, newPublications.map((publication) => ({
          location: "remote" as const,
          sessionId: publication.publisherSessionId,
          trackName: publication.trackName,
        })));
        if (!validateMediaSessionDescription(operation.sessionDescription) || operation.sessionDescription.type !== "offer") {
          throw new Error("Cloudflare Realtime did not return a subscription offer.");
        }
        const subscriptionResults = operation.tracks ?? [];
        const subscriptions: RealtimeSubscribedTrack[] = newPublications.flatMap((publication, index) => {
          const result = subscriptionResults[index];
          if (result?.errorCode || typeof result?.mid !== "string") return [];
          return [{
            publicationKey: publication.key,
            publisherUserId: publication.publisherUserId,
            publisherDisplayName: publication.publisherDisplayName,
            trackName: publication.trackName,
            mid: result.mid,
          }];
        });
        if (!subscriptions.length) throw new Error("Cloudflare Realtime did not accept any remote tracks.");
        const operationId = crypto.randomUUID();
        ownState = {
          ...ownState,
          pendingSubscriptions: { operationId, sessionDescription: operation.sessionDescription, tracks: subscriptions },
        };
        await rpc.saveSfuParticipantState(ownState);
        return withSessionCookie(jsonResponse({
          ok: true,
          data: { operationId, sessionDescription: operation.sessionDescription, tracks: subscriptions, diagnostics: diagnostics() },
        }), request, session);
      } catch (error) {
        return withSessionCookie(jsonResponse({ ok: false, error: mediaErrorMessage(error) }, mediaApiErrorStatus(error)), request, session);
      }
    }

    const mediaRenegotiateMatch = /^\/api\/meetings\/([^/]+)\/media\/renegotiate$/.exec(url.pathname);

    if (mediaRenegotiateMatch && request.method === "POST") {
      const body = await parseJsonBody<{ connectionId?: string; operationId?: string; sessionDescription?: unknown }>(request);
      const { session } = await getOrCreateSession(request, env);
      if (!body || !validateMediaConnectionId(body.connectionId) || typeof body.operationId !== "string" || !validateMediaSessionDescription(body.sessionDescription) || body.sessionDescription.type !== "answer") {
        return withSessionCookie(jsonResponse({ ok: false, error: "A valid connection, operation, and SDP answer are required." }, 400), request, session);
      }
      try {
        await requireJoinedMediaMember(env, mediaRenegotiateMatch[1], session.userId);
        const rpc = getMeetingStateRpc(env, mediaRenegotiateMatch[1]);
        const state = await rpc.getSfuParticipantState(session.userId);
        if (!state || state.connectionId !== body.connectionId || state.pendingSubscriptions?.operationId !== body.operationId) {
          throw new Error("Media negotiation is no longer current. Reconnect and try again.");
        }
        const client = getCloudflareRealtimeClient(env);
        const removedKeys = new Set((state.pendingSubscriptions.removed ?? []).map((track) => track.publicationKey));
        await client.renegotiate(state.subscriberSessionId!, body.sessionDescription);
        await rpc.saveSfuParticipantState({
          ...state,
          subscribedTracks: [
            ...state.subscribedTracks.filter((track) => !removedKeys.has(track.publicationKey)),
            ...state.pendingSubscriptions.tracks,
          ],
          pendingSubscriptions: undefined,
        });
        return withSessionCookie(jsonResponse({ ok: true, data: { connected: true } }), request, session);
      } catch (error) {
        return withSessionCookie(jsonResponse({ ok: false, error: mediaErrorMessage(error) }, mediaApiErrorStatus(error)), request, session);
      }
    }

    const mediaTrackCloseMatch = /^\/api\/meetings\/([^/]+)\/media\/tracks\/close$/.exec(url.pathname);

    if (mediaTrackCloseMatch && request.method === "POST") {
      const body = await parseJsonBody<{ connectionId?: string; trackNames?: string[]; sessionDescription?: unknown }>(request);
      const { session } = await getOrCreateSession(request, env);
      if (!body || !validateMediaConnectionId(body.connectionId) || !Array.isArray(body.trackNames) || body.trackNames.some((name) => typeof name !== "string") ||
        (body.sessionDescription !== undefined && (!validateMediaSessionDescription(body.sessionDescription) || body.sessionDescription.type !== "offer"))) {
        return withSessionCookie(jsonResponse({ ok: false, error: "A valid connection and track names are required." }, 400), request, session);
      }
      try {
        await requireJoinedMediaMember(env, mediaTrackCloseMatch[1], session.userId);
        const rpc = getMeetingStateRpc(env, mediaTrackCloseMatch[1]);
        const state = await rpc.getSfuParticipantState(session.userId);
        if (!state || state.connectionId !== body.connectionId) throw new Error("Media connection not found.");
        const closing = [
          ...state.publishedTracks,
          ...(state.pendingPublishedTracks ?? []),
        ].filter((track) => body.trackNames!.includes(track.trackName));
        let answer: unknown;
        if (closing.length && state.publisherSessionId) {
          const offer = body.sessionDescription as { type: "offer" | "answer"; sdp: string } | undefined;
          const closed = await getCloudflareRealtimeClient(env).closeTracks(state.publisherSessionId, closing.map((track) => track.mid), offer ? { force: false, sessionDescription: offer } : {});
          if (offer && validateMediaSessionDescription(closed.sessionDescription) && closed.sessionDescription.type === "answer") answer = closed.sessionDescription;
        }
        await rpc.saveSfuParticipantState({
          ...state,
          publishedTracks: state.publishedTracks.filter((track) => !body.trackNames!.includes(track.trackName)),
          pendingPublishedTracks: (state.pendingPublishedTracks ?? []).filter((track) => !body.trackNames!.includes(track.trackName)),
        });
        return withSessionCookie(jsonResponse({ ok: true, data: { closed: closing.map((track) => track.trackName), sessionDescription: answer ?? null } }), request, session);
      } catch (error) {
        return withSessionCookie(jsonResponse({ ok: false, error: mediaErrorMessage(error) }, mediaApiErrorStatus(error)), request, session);
      }
    }

    const mediaRecoverMatch = /^\/api\/meetings\/([^/]+)\/media\/recover$/.exec(url.pathname);

    if (mediaRecoverMatch && request.method === "POST") {
      const body = await parseJsonBody<{ connectionId?: string; direction?: string }>(request);
      const { session } = await getOrCreateSession(request, env);
      if (!body || !validateMediaConnectionId(body.connectionId) || (body.direction !== "publisher" && body.direction !== "subscriber")) {
        return withSessionCookie(jsonResponse({ ok: false, error: "A valid media connection and direction are required." }, 400), request, session);
      }
      try {
        await requireJoinedMediaMember(env, mediaRecoverMatch[1], session.userId);
        const rpc = getMeetingStateRpc(env, mediaRecoverMatch[1]);
        const state = await rpc.getSfuParticipantState(session.userId);
        if (!state) return withSessionCookie(jsonResponse({ ok: true, data: { recovered: true, direction: body.direction } }), request, session);
        if (state.connectionId !== body.connectionId) {
          return withSessionCookie(jsonResponse({ ok: false, error: "Media connection is no longer current." }, 409), request, session);
        }

        const sessionId = body.direction === "publisher" ? state.publisherSessionId : state.subscriberSessionId;
        const trackMids = body.direction === "publisher"
          ? [...state.publishedTracks, ...(state.pendingPublishedTracks ?? [])].map((track) => track.mid)
          : [...state.subscribedTracks, ...(state.pendingSubscriptions?.tracks ?? [])].map((track) => track.mid);
        if (sessionId && trackMids.length) {
          try {
            await getCloudflareRealtimeClient(env).closeTracks(sessionId, [...new Set(trackMids)]);
          } catch (error) {
            // The session is being replaced, so an upstream failure here (including 406) must not block recovery.
            if (!(error instanceof CloudflareRealtimeSessionError)) throw error;
            console.warn("Media recovery close failed", body.direction, error.upstreamStatus, error.errorCode, error.errorDescription);
          }
        }

        const recoveredState: RealtimeParticipantMediaState = body.direction === "publisher"
          ? {
              ...state,
              generation: state.generation + 1,
              publisherSessionId: undefined,
              publishedTracks: [],
              pendingPublishedTracks: [],
            }
          : {
              ...state,
              subscriberSessionId: undefined,
              subscribedTracks: [],
              pendingSubscriptions: undefined,
            };
        await rpc.saveSfuParticipantState(recoveredState);
        return withSessionCookie(jsonResponse({ ok: true, data: { recovered: true, direction: body.direction } }), request, session);
      } catch (error) {
        return withSessionCookie(jsonResponse({ ok: false, error: mediaErrorMessage(error) }, mediaApiErrorStatus(error)), request, session);
      }
    }

    const mediaCloseMatch = /^\/api\/meetings\/([^/]+)\/media\/close$/.exec(url.pathname);

    if (mediaCloseMatch && request.method === "POST") {
      const body = await parseJsonBody<{ connectionId?: string }>(request);
      const { session } = await getOrCreateSession(request, env);
      if (!body || !validateMediaConnectionId(body.connectionId)) {
        return withSessionCookie(jsonResponse({ ok: false, error: "A valid media connection is required." }, 400), request, session);
      }
      try {
        const meeting = await getMeetingService(env).getMeeting(mediaCloseMatch[1]);
        if (!meeting || !meeting.participants.some((participant) => participant.userId === session.userId)) {
          throw new Error("Meeting not found.");
        }
        const rpc = getMeetingStateRpc(env, mediaCloseMatch[1]);
        const state = await rpc.getSfuParticipantState(session.userId);
        if (state && state.connectionId === body.connectionId) {
          await closeSfuTransport(getCloudflareRealtimeClient(env), state);
          await rpc.deleteSfuParticipantState(session.userId);
        }
        return withSessionCookie(jsonResponse({ ok: true, data: { closed: true } }), request, session);
      } catch (error) {
        return withSessionCookie(jsonResponse({ ok: false, error: mediaErrorMessage(error) }, mediaApiErrorStatus(error)), request, session);
      }
    }

    const recordingPartMatch = /^\/api\/meetings\/([^/]+)\/recording\/([^/]+)\/parts\/(\d+)$/.exec(url.pathname);

    if (recordingPartMatch && request.method === "POST") {
      const { session } = await getOrCreateSession(request, env);
      const recordingId = decodeURIComponent(recordingPartMatch[2]);
      const partNumber = Number(recordingPartMatch[3]);
      try {
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) throw new Error("Invalid recording part number.");
        const bytes = await request.arrayBuffer();
        const isFinalPart = request.headers.get("X-Recording-Final-Part") === "true";
        if (bytes.byteLength === 0 || bytes.byteLength > 16 * 1024 * 1024 || (!isFinalPart && bytes.byteLength < 5 * 1024 * 1024)) {
          throw new Error("Invalid recording part size.");
        }
        const service = getMeetingService(env);
        const recording = await getHostRecording(recordingPartMatch[1], session.userId, service, recordingId);
        if (!recording.storageRef?.objectKey || !recording.storageUpload?.uploadId) throw new Error("Recording upload is unavailable.");
        const part = await getPrivateRecordingBucket(env)
          .resumeMultipartUpload(recording.storageRef.objectKey, recording.storageUpload.uploadId)
          .uploadPart(partNumber, bytes);
        await service.recordRecordingPart(recordingPartMatch[1], recordingId, session.userId, {
          partNumber: part.partNumber,
          etag: part.etag,
          size: bytes.byteLength,
        });
        return withSessionCookie(jsonResponse({ ok: true, data: { partNumber, accepted: true } }), request, session);
      } catch (error) {
        try {
          const service = getMeetingService(env);
          const active = await getHostRecording(recordingPartMatch[1], session.userId, service, recordingId);
          if (active.storageRef?.objectKey && active.storageUpload?.uploadId) {
            try { await getPrivateRecordingBucket(env).resumeMultipartUpload(active.storageRef.objectKey, active.storageUpload.uploadId).abort(); } catch { /* best-effort abort */ }
          }
          if (active.recordingId) await service.failRecording(recordingPartMatch[1], active.recordingId, session.userId, "UPLOAD_FAILED");
        } catch { /* never expose storage internals or change authorization outcome */ }
        const message = recordingErrorMessage(error);
        return withSessionCookie(jsonResponse({ ok: false, error: message }, message.includes("host") ? 403 : 400), request, session);
      }
    }

    const recordingFailMatch = /^\/api\/meetings\/([^/]+)\/recording\/([^/]+)\/fail$/.exec(url.pathname);

    if (recordingFailMatch && request.method === "POST") {
      const body = await parseJsonBody<{ failureCode?: string }>(request);
      const { session } = await getOrCreateSession(request, env);
      try {
        const service = getMeetingService(env);
        const recording = await getHostRecording(recordingFailMatch[1], session.userId, service, decodeURIComponent(recordingFailMatch[2]));
        if (recording.storageRef?.objectKey && recording.storageUpload?.uploadId) {
          try {
            await getPrivateRecordingBucket(env).resumeMultipartUpload(recording.storageRef.objectKey, recording.storageUpload.uploadId).abort();
          } catch { /* best-effort abort; failed metadata remains private */ }
        }
        const failureCode = body?.failureCode === "CAPTURE_FAILED" || body?.failureCode === "STORAGE_FAILED" ? body.failureCode : "UPLOAD_FAILED";
        const failed = await service.failRecording(recordingFailMatch[1], recording.recordingId!, session.userId, failureCode);
        return withSessionCookie(jsonResponse({ ok: true, data: toPublicRecordingMetadata(failed) }), request, session);
      } catch (error) {
        const message = recordingErrorMessage(error);
        return withSessionCookie(jsonResponse({ ok: false, error: message }, message.includes("host") ? 403 : 400), request, session);
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
      const service = getMeetingService(env);
      if (meetingRecordingMatch[2] === "start") {
        let recording: MeetingRecordingMetadata | undefined;
        let upload: RecordingMultipartUpload | undefined;
        try {
          recording = await service.startRecording(meetingRecordingMatch[1], session.userId);
          const objectKey = recording.storageRef?.objectKey;
          if (!objectKey || !recording.recordingId) throw new Error("Recording storage metadata is unavailable.");
          upload = await getPrivateRecordingBucket(env).createMultipartUpload(objectKey, {
            httpMetadata: { contentType: "video/webm" },
            customMetadata: { meetingId: meetingRecordingMatch[1], recordingId: recording.recordingId },
          });
          const attached = await service.attachRecordingUpload(meetingRecordingMatch[1], recording.recordingId, session.userId, upload.uploadId);
          return withSessionCookie(jsonResponse({ ok: true, data: toPublicRecordingMetadata(attached) }), request, session);
        } catch (error) {
          if (upload) {
            try { await upload.abort(); } catch { /* best-effort abort */ }
          }
          if (recording?.recordingId) {
            try { await service.failRecording(meetingRecordingMatch[1], recording.recordingId, session.userId, "STORAGE_FAILED"); } catch { /* keep the original failure */ }
          }
          const message = recordingErrorMessage(error);
          const status = message.includes("host") ? 403 : message === "Meeting is not active." || message.includes("already active") ? 409 : 502;
          return withSessionCookie(jsonResponse({ ok: false, error: message }, status), request, session);
        }
      }

      try {
        const recording = await getHostRecording(meetingRecordingMatch[1], session.userId, service);
        if (!recording.recordingId || !recording.storageRef?.objectKey || !recording.storageUpload?.uploadId || !recording.storageUpload.parts.length) {
          throw new Error("Recording contains no retained media parts.");
        }
        const bucket = getPrivateRecordingBucket(env);
        const upload = bucket.resumeMultipartUpload(recording.storageRef.objectKey, recording.storageUpload.uploadId);
        const expectedSize = recording.storageUpload.parts.reduce((total, part) => total + part.size, 0);
        const completed = await upload.complete(recording.storageUpload.parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
        if (completed.size !== expectedSize) throw new Error("Final recording size did not match uploaded media.");
        const finalized = await service.finalizeRecording(meetingRecordingMatch[1], recording.recordingId, session.userId);
        return withSessionCookie(jsonResponse({ ok: true, data: toPublicRecordingMetadata(finalized) }), request, session);
      } catch (error) {
        let message = recordingErrorMessage(error);
        const status = message.includes("host") ? 403 : message === "Meeting not found." ? 404 : 502;
        try {
          const active = await getHostRecording(meetingRecordingMatch[1], session.userId, service);
          if (active.recordingId) {
            if (active.storageRef?.objectKey && active.storageUpload?.uploadId) {
              try { await getPrivateRecordingBucket(env).resumeMultipartUpload(active.storageRef.objectKey, active.storageUpload.uploadId).abort(); } catch { /* best-effort abort */ }
            }
            await service.failRecording(meetingRecordingMatch[1], active.recordingId, session.userId, "STORAGE_FAILED");
          }
        } catch { /* retain generic safe failure response */ }
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
      const { session } = await getOrCreateSession(request, env);
      if (!body || typeof body.targetUserId !== "string" || !body.targetUserId.trim()) {
        return withSessionCookie(jsonResponse({ ok: false, error: "targetUserId is required." }, 400), request, session);
      }
      try {
        const meeting = await getMeetingService(env).removeParticipant(removalMatch[1], session.userId, body.targetUserId);
        await cleanupSfuParticipant(env, removalMatch[1], body.targetUserId);
        return withSessionCookie(jsonResponse({ ok: true, data: meeting }), request, session);
      } catch (error) {
        return withSessionCookie(jsonResponse({ ok: false, error: error instanceof Error ? error.message : "Unable to remove participant." }, 403), request, session);
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
          if (requestResult.status === "APPROVED") {
            const participant = await service.joinMeeting(meetingMatch[1], {
              userId: authenticatedUserId,
              displayName: body.displayName,
            });
            return withSessionCookie(jsonResponse({ ok: true, data: participant }), request, session);
          }
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
        await cleanupSfuParticipant(env, meetingMatch[1], session.userId);
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
        const rpc = getMeetingStateRpc(env, meetingMatch[1]);
        const mediaStates = await rpc.listSfuParticipantStates();
        await Promise.all(mediaStates.map((state) => cleanupSfuParticipant(env, meetingMatch[1], state.userId)));
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

const SFU_MUTATION_ROUTE = /^\/api\/meetings\/([^/]+)\/media\/(?:publish|publish\/ready|subscribe|renegotiate|tracks\/close|recover|close)$/;

export default {
  async fetch(request: Request, env: WorkerEnv = {}): Promise<Response> {
    const route = request.method === "POST" ? SFU_MUTATION_ROUTE.exec(new URL(request.url).pathname) : null;
    const sessionId = route ? getSessionIdFromRequest(request) : null;
    let rpc: MeetingStateDurableObject | undefined;
    let token: string | undefined;
    if (route && sessionId) {
      try {
        rpc = getMeetingStateRpc(env, route[1]);
        token = await rpc.acquireSfuMutation(sessionId);
      } catch (error) {
        console.error("Unable to acquire SFU mutation lock", error);
        return jsonResponse({ ok: false, error: "Media mutation is temporarily unavailable." }, 503);
      }
    }
    try {
      return await routeHandler.fetch(request, env);
    } finally {
      if (rpc && token && sessionId) {
        try {
          await rpc.releaseSfuMutation(sessionId, token);
        } catch (error) {
          console.error("Unable to release SFU mutation lock", error);
        }
      }
    }
  },
};
