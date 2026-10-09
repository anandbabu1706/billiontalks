import { describe, expect, it, vi } from "vitest";

import {
  type MediaProvider,
  DurableMeetingRepository,
  MeetingPermissions,
  MeetingService,
  MeetingStatus,
  InMemoryMeetingRepository,
  ParticipantRole,
  ParticipantState,
} from "../src/meeting";
import app, { MeetingStateDurableObject, resolveMeetingRepository } from "../src/index";

class StubMediaProvider implements MediaProvider {
  public created: Array<{ meetingId: string; participantId: string }> = [];

  async createParticipantMediaConnection(meetingId: string, participantId: string) {
    const mediaConnectionId = `media-${meetingId}-${participantId}`;
    this.created.push({ meetingId, participantId });
    return {
      mediaConnectionId,
      provider: "cloudflare" as const,
      providerSessionId: mediaConnectionId,
    };
  }

  async deleteParticipantMediaConnection(_meetingId: string, _participantId: string): Promise<void> {
    // no-op for tests
  }
}

function getCookieValue(setCookieHeader: string | null, name: string): string | null {
  if (!setCookieHeader) {
    return null;
  }

  const match = setCookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function createSessionNamespace(durableStorage: Map<string, unknown>) {
  return {
    idFromName: (name: string) => name,
    get: () => new MeetingStateDurableObject({
      storage: {
        transaction: async (callback: (storage: any) => Promise<unknown>) => callback({
          get: async <T>(key: string) => durableStorage.get(key) as T | undefined,
          put: async (key: string, value: unknown) => { durableStorage.set(key, value); },
          delete: async (key: string) => durableStorage.delete(key),
        }),
        get: async <T>(key: string) => durableStorage.get(key) as T | undefined,
        put: async (key: string, value: unknown) => { durableStorage.set(key, value); },
        delete: async (key: string) => durableStorage.delete(key),
      },
    } as any, {}),
  };
}

function createDurableObjectNamespace(backingStorage = new Map<string, Map<string, unknown>>()) {
  const instances = new Map<string, MeetingStateDurableObject>();
  return {
    idFromName: (name: string) => name,
    get: (id: string) => {
      const existing = instances.get(id);
      if (existing) return existing;
      let values = backingStorage.get(id);
      if (!values) {
        values = new Map<string, unknown>();
        backingStorage.set(id, values);
      }
      const storage = {
        transaction: async (callback: (transactionStorage: any) => Promise<unknown>) => callback(storage),
        get: async <T>(key: string) => values!.get(key) as T | undefined,
        put: async (key: string, value: unknown) => { values!.set(key, value); },
        delete: async (key: string) => values!.delete(key),
      };
      const instance = new MeetingStateDurableObject({ storage } as any, {});
      instances.set(id, instance);
      return instance;
    },
  };
}

function createRecordingBucketFixture() {
  const uploads = new Map<string, { key: string; parts: Map<number, { partNumber: number; etag: string; size: number }> }>();
  const objects = new Map<string, { size: number; contentType: string }>();
  const makeUpload = (key: string, uploadId: string) => ({
    uploadId,
    uploadPart: async (partNumber: number, value: ArrayBuffer) => {
      const upload = uploads.get(uploadId);
      if (!upload || upload.key !== key) throw new Error("Upload not found.");
      const part = { partNumber, etag: `etag-${partNumber}`, size: value.byteLength };
      upload.parts.set(partNumber, part);
      return part;
    },
    complete: async (parts: Array<{ partNumber: number; etag: string }>) => {
      const upload = uploads.get(uploadId);
      if (!upload || parts.some((part, index) => upload.parts.get(part.partNumber)?.etag !== part.etag || part.partNumber !== index + 1)) {
        throw new Error("Multipart completion validation failed.");
      }
      const size = parts.reduce((total, part) => total + upload.parts.get(part.partNumber)!.size, 0);
      objects.set(key, { size, contentType: "video/webm" });
      uploads.delete(uploadId);
      return { size };
    },
    abort: async () => { uploads.delete(uploadId); },
  });
  const bucket = {
    createMultipartUpload: async (key: string) => {
      const uploadId = crypto.randomUUID();
      uploads.set(uploadId, { key, parts: new Map() });
      return makeUpload(key, uploadId);
    },
    resumeMultipartUpload: (key: string, uploadId: string) => makeUpload(key, uploadId),
  };
  return { bucket, uploads, objects };
}

function createChatApiFixture(namespace = createDurableObjectNamespace()) {
  const recordingBucket = createRecordingBucketFixture();
  const env = {
    MEETING_STORE: namespace as any,
    REALTIME_SFU_APP_ID: "test-sfu-app-id",
    REALTIME_SFU_BEARER_TOKEN: "test-sfu-app-secret",
    RECORDINGS_BUCKET: recordingBucket.bucket as any,
  };
  const rawRequest = (path: string, method = "GET", cookie?: string, body?: BodyInit, contentType = "application/json", extraHeaders?: HeadersInit) => {
    const headers = new Headers(extraHeaders ?? {});
    if (cookie) headers.set("Cookie", cookie);
    if (body !== undefined) headers.set("Content-Type", contentType);
    return app.fetch(new Request(`http://localhost${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    }), env);
  };
  const request = (path: string, method = "GET", cookie?: string, body?: unknown) =>
    rawRequest(path, method, cookie, body === undefined ? undefined : JSON.stringify(body));

  return {
    request,
    rawRequest(path: string, method = "GET", cookie?: string, body?: BodyInit, contentType = "application/json", extraHeaders?: HeadersInit) {
      return rawRequest(path, method, cookie, body, contentType, extraHeaders);
    },
    recordingObjects: recordingBucket.objects,
    async createSession() {
      const response = await request("/api/session", "POST");
      const payload = await response.json();
      const token = getCookieValue(response.headers.get("Set-Cookie"), "bt_session_v0");
      if (!token) throw new Error("Session cookie was not issued.");
      return { userId: payload.data.userId as string, cookie: `bt_session_v0=${token}` };
    },
    async createOpenMeeting(cookie: string, title = "Chat room") {
      const response = await request("/api/meetings", "POST", cookie, { title, accessMode: "OPEN" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      return payload.data as { id: string; hostId: string };
    },
    async createMeeting(cookie: string, title: string, accessMode = "OPEN") {
      const response = await request("/api/meetings", "POST", cookie, { title, accessMode });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      return payload.data as { id: string; hostId: string };
    },
    async uploadRecordingPart(meetingId: string, recordingId: string, cookie: string, bytes: Uint8Array, partNumber = 1, finalPart = true) {
      const body = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(body).set(bytes);
      return rawRequest(
        `/api/meetings/${meetingId}/recording/${recordingId}/parts/${partNumber}`,
        "POST",
        cookie,
        body,
        "application/octet-stream",
        { "X-Recording-Final-Part": String(finalPart) },
      );
    },
  };
}

async function createJoinedChatRoom(namespace = createDurableObjectNamespace()) {
  const api = createChatApiFixture(namespace);
  const host = await api.createSession();
  const meeting = await api.createOpenMeeting(host.cookie);
  const participant = await api.createSession();
  const joinResponse = await api.request(`/api/meetings/${meeting.id}/join`, "POST", participant.cookie, {
    userId: "untrusted-client-user",
    displayName: "Guest",
  });
  if (!joinResponse.ok) throw new Error("Unable to join the chat test meeting.");
  return { api, host, meeting, participant };
}

function createSfuFetchMock() {
  const calls: Array<{ url: string; method: string; headers: Headers; body: any }> = [];
  let sessionNumber = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, headers: new Headers(init?.headers), body });

    if (url.endsWith("/sessions/new")) {
      sessionNumber += 1;
      return Response.json({ sessionId: `sfu-session-${sessionNumber}-secretish` }, { status: 201 });
    }
    if (url.endsWith("/tracks/new") && body?.tracks?.[0]?.location === "remote") {
      return Response.json({
        sessionDescription: { type: "offer", sdp: "sfu-subscribe-offer" },
        tracks: body.tracks.map((_track: unknown, index: number) => ({ mid: `remote-${index}`, status: "active" })),
        requiresImmediateRenegotiation: true,
      });
    }
    if (url.endsWith("/tracks/new")) {
      return Response.json({
        sessionDescription: { type: "answer", sdp: "sfu-publish-answer" },
        tracks: body.tracks.map((track: { mid: string; trackName: string }) => ({ mid: track.mid, trackName: track.trackName, status: "active" })),
      });
    }
    if (url.endsWith("/tracks/close")) {
      const closed = body.tracks.map((track: { mid: string }) => ({ mid: track.mid, status: "closed" }));
      if (body.force === false && body.sessionDescription) return Response.json({ sessionDescription: { type: "answer", sdp: "sfu-close-answer" }, tracks: closed });
      if (body.force === false) return Response.json({ sessionDescription: { type: "offer", sdp: "sfu-close-offer" }, requiresImmediateRenegotiation: true, tracks: closed });
      return Response.json({ tracks: closed });
    }
    if (url.endsWith("/renegotiate")) return Response.json({ ok: true });
    return Response.json({ ok: true });
  });
  return { fetcher, calls };
}

function makeRequestWithSession(url: string, init: RequestInit = {}, sessionCookie: string | null): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (sessionCookie) {
    headers.set("Cookie", sessionCookie);
  }

  return app.fetch(new Request(`http://localhost${url}`, { ...init, headers }), {
    MEETING_STORE: new InMemoryMeetingRepository() as any,
  });
}

describe("MeetingService lifecycle", () => {
  it("preserves cookie-backed identity across runtime re-instantiation and refreshes session expiry", async () => {
    const durableStorage = new Map<string, unknown>();
    const sessionResponse = await app.fetch(new Request("http://localhost/api/session", { method: "POST" }), {
      SESSION_STORE: createSessionNamespace(durableStorage),
    });
    const payload = await sessionResponse.json();
    const cookieValue = getCookieValue(sessionResponse.headers.get("Set-Cookie"), "bt_session_v0");
    const cookieHeader = sessionResponse.headers.get("Set-Cookie") ?? "";
    const storedSessionKey = `v0-session:${cookieValue}`;
    const firstStoredSession = durableStorage.get(storedSessionKey) as { lastSeenAt: string };

    expect(payload.ok).toBe(true);
    expect(cookieValue).toBeTruthy();
    expect(payload.data.userId).toMatch(/^session_/);
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("Max-Age=604800");

    durableStorage.set(storedSessionKey, {
      ...(durableStorage.get(storedSessionKey) as object),
      lastSeenAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const repeatResponse = await app.fetch(new Request("http://localhost/api/session", {
      method: "POST",
      headers: { Cookie: `bt_session_v0=${cookieValue}` },
    }), {
      SESSION_STORE: createSessionNamespace(durableStorage),
    });
    const repeatPayload = await repeatResponse.json();
    const refreshedSession = durableStorage.get(storedSessionKey) as { lastSeenAt: string };

    expect(repeatPayload.ok).toBe(true);
    expect(repeatPayload.data.userId).toBe(payload.data.userId);
    expect(repeatPayload.data.sessionId).toBe(payload.data.sessionId);
    expect(Date.parse(refreshedSession.lastSeenAt)).toBeGreaterThan(Date.parse(firstStoredSession.lastSeenAt));

    durableStorage.set(storedSessionKey, {
      ...(durableStorage.get(storedSessionKey) as object),
      lastSeenAt: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000) - 1).toISOString(),
    });
    const expiredResponse = await app.fetch(new Request("http://localhost/api/session", {
      method: "POST",
      headers: { Cookie: `bt_session_v0=${cookieValue}` },
    }), {
      SESSION_STORE: createSessionNamespace(durableStorage),
    });
    const expiredPayload = await expiredResponse.json();

    expect(expiredPayload.data.userId).not.toBe(payload.data.userId);
    expect(expiredPayload.data.sessionId).not.toBe(payload.data.sessionId);
  });

  it("rejects host and participant spoofing when a session-backed identity is present", async () => {
    const repository = new InMemoryMeetingRepository();
    const durableStorage = new Map<string, unknown>();
    const makeEnv = () => ({
      MEETING_STORE: repository as any,
      SESSION_STORE: createSessionNamespace(durableStorage),
    });

    const hostSessionResponse = await app.fetch(new Request("http://localhost/api/session", { method: "POST" }), {
      ...makeEnv(),
    });
    const hostCookie = getCookieValue(hostSessionResponse.headers.get("Set-Cookie"), "bt_session_v0");
    const hostSession = await hostSessionResponse.json();

    const createMeetingResponse = await app.fetch(new Request("http://localhost/api/meetings", {
      method: "POST",
      headers: { Cookie: `bt_session_v0=${hostCookie}` },
      body: JSON.stringify({ title: "Secure room", accessMode: "OPEN" }),
    }), {
      ...makeEnv(),
    });
    const createdMeeting = await createMeetingResponse.json();

    expect(createMeetingResponse.status).toBe(201);
    expect(createdMeeting.data.hostId).toBe(hostSession.data.userId);

    const guestSessionResponse = await app.fetch(new Request("http://localhost/api/session", { method: "POST" }), {
      ...makeEnv(),
    });
    const guestCookie = getCookieValue(guestSessionResponse.headers.get("Set-Cookie"), "bt_session_v0");
    const guestUser = (await guestSessionResponse.json()).data.userId;

    const spoofedAccessResponse = await app.fetch(new Request(`http://localhost/api/meetings/${createdMeeting.data.id}/access-mode`, {
      method: "POST",
      headers: { Cookie: `bt_session_v0=${guestCookie}` },
      body: JSON.stringify({ actorUserId: "spoofed-host", accessMode: "OPEN" }),
    }), {
      ...makeEnv(),
    });

    expect(spoofedAccessResponse.status).toBe(403);

    const joinResponse = await app.fetch(new Request(`http://localhost/api/meetings/${createdMeeting.data.id}/join`, {
      method: "POST",
      headers: { Cookie: `bt_session_v0=${guestCookie}` },
      body: JSON.stringify({ userId: hostSession.data.userId, displayName: "Host impersonator" }),
    }), {
      ...makeEnv(),
    });
    const joinPayload = await joinResponse.json();

    expect(joinResponse.status).toBe(200);
    expect(joinPayload.data.userId).toBe(guestUser);
    expect(joinPayload.data.displayName).toBe("Host impersonator");
    expect(joinPayload.data.userId).not.toBe(hostSession.data.userId);
  });

  it("keeps a second session waiting in HOST_APPROVAL, exposes the request to the host, and admits it as a participant only after approval", async () => {
    const api = createChatApiFixture();
    const host = await api.createSession();
    const guest = await api.createSession();
    const meeting = await api.createMeeting(host.cookie, "Approval role regression", "HOST_APPROVAL");

    const guestJoin = await api.request(`/api/meetings/${meeting.id}/join`, "POST", guest.cookie, {
      userId: host.userId,
      displayName: "Parti2",
    });
    const waitingPayload = await guestJoin.json();

    expect(guestJoin.status).toBe(200);
    expect(waitingPayload.data.status).toBe("WAITING");
    expect(waitingPayload.data.userId).toBe(guest.userId);
    expect(waitingPayload.data.userId).not.toBe(host.userId);

    const beforeApproval = await api.request(`/api/meetings/${meeting.id}`);
    const beforePayload = await beforeApproval.json();
    expect(beforePayload.data.participants.map((entry: { userId: string }) => entry.userId)).toEqual([host.userId]);

    const guestEnd = await api.request(`/api/meetings/${meeting.id}/end`, "POST", guest.cookie);
    const guestAccessChange = await api.request(`/api/meetings/${meeting.id}/access-mode`, "POST", guest.cookie, {
      actorUserId: host.userId,
      accessMode: "OPEN",
    });
    const guestPendingList = await api.request(`/api/meetings/${meeting.id}/admission/pending`, "GET", guest.cookie);
    const guestApproval = await api.request(`/api/meetings/${meeting.id}/admission/${waitingPayload.data.id}/approve`, "POST", guest.cookie);
    const guestRemoval = await api.request(`/api/meetings/${meeting.id}/remove`, "POST", guest.cookie, {
      actorUserId: host.userId,
      targetUserId: host.userId,
    });
    expect(guestEnd.status).toBe(403);
    expect(guestAccessChange.status).toBe(403);
    expect(guestPendingList.status).toBe(403);
    expect(guestApproval.status).toBe(403);
    expect(guestRemoval.status).toBe(403);

    const pendingResponse = await api.request(`/api/meetings/${meeting.id}/admission/pending`, "GET", host.cookie);
    const pendingPayload = await pendingResponse.json();
    expect(pendingPayload.data).toHaveLength(1);
    expect(pendingPayload.data[0].userId).toBe(guest.userId);

    const approved = await api.request(`/api/meetings/${meeting.id}/admission/${waitingPayload.data.id}/approve`, "POST", host.cookie);
    expect(approved.status).toBe(200);
    const guestRejoin = await api.request(`/api/meetings/${meeting.id}/join`, "POST", guest.cookie, {
      userId: host.userId,
      displayName: "Parti2",
    });
    const joinedPayload = await guestRejoin.json();
    expect(guestRejoin.status).toBe(200);
    expect(joinedPayload.data).toMatchObject({
      userId: guest.userId,
      role: ParticipantRole.PARTICIPANT,
      state: ParticipantState.JOINED,
    });
    expect(joinedPayload.data.userId).not.toBe(host.userId);
  });

  it("keeps direct OPEN-mode joins as participants even when the body claims host identity", async () => {
    const api = createChatApiFixture();
    const host = await api.createSession();
    const guest = await api.createSession();
    const meeting = await api.createOpenMeeting(host.cookie, "Open role regression");
    const response = await api.request(`/api/meetings/${meeting.id}/join`, "POST", guest.cookie, {
      userId: host.userId,
      displayName: "Open Guest",
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      userId: guest.userId,
      role: ParticipantRole.PARTICIPANT,
      state: ParticipantState.JOINED,
    });
  });

  it("allows the host to post chat messages", async () => {
    const { api, host, meeting } = await createJoinedChatRoom();
    const response = await api.request(`/api/meetings/${meeting.id}/chat`, "POST", host.cookie, { content: "Host message" });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({
      meetingId: meeting.id,
      senderUserId: host.userId,
      senderDisplayName: "Host",
      content: "Host message",
      sequence: 1,
    });
  });

  it("allows a joined participant to post chat messages", async () => {
    const { api, participant, meeting } = await createJoinedChatRoom();
    const response = await api.request(`/api/meetings/${meeting.id}/chat`, "POST", participant.cookie, { content: "Guest message" });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.senderUserId).toBe(participant.userId);
    expect(payload.data.senderDisplayName).toBe("Guest");
    expect(payload.data.content).toBe("Guest message");
  });

  it("ignores client-supplied chat sender identities", async () => {
    const { api, host, participant, meeting } = await createJoinedChatRoom();
    const response = await api.request(`/api/meetings/${meeting.id}/chat`, "POST", participant.cookie, {
      content: "Not the host",
      senderUserId: host.userId,
      userId: host.userId,
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.senderUserId).toBe(participant.userId);
    expect(payload.data.senderUserId).not.toBe(host.userId);
  });

  it("preserves ordered chat history across Worker and Durable Object re-instantiation", async () => {
    const backingStorage = new Map<string, Map<string, unknown>>();
    const api = createChatApiFixture(createDurableObjectNamespace(backingStorage));
    const host = await api.createSession();
    const meeting = await api.createOpenMeeting(host.cookie);
    await api.request(`/api/meetings/${meeting.id}/chat`, "POST", host.cookie, { content: "First" });
    await api.request(`/api/meetings/${meeting.id}/chat`, "POST", host.cookie, { content: "Second" });

    const restartedApi = createChatApiFixture(createDurableObjectNamespace(backingStorage));
    const response = await restartedApi.request(`/api/meetings/${meeting.id}/chat`, "GET", host.cookie);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.map((message: { content: string }) => message.content)).toEqual(["First", "Second"]);
    expect(payload.data.map((message: { sequence: number }) => message.sequence)).toEqual([1, 2]);
    expect(Date.parse(payload.data[1].createdAt)).toBeGreaterThan(Date.parse(payload.data[0].createdAt));
  });

  it("returns prior chat history to a participant who reconnects", async () => {
    const { api, participant, meeting } = await createJoinedChatRoom();
    await api.request(`/api/meetings/${meeting.id}/chat`, "POST", participant.cookie, { content: "Before reconnect" });
    await api.request(`/api/meetings/${meeting.id}/leave`, "POST", participant.cookie);
    const rejoinResponse = await api.request(`/api/meetings/${meeting.id}/join`, "POST", participant.cookie, { displayName: "Guest again" });
    expect(rejoinResponse.status).toBe(200);

    const historyResponse = await api.request(`/api/meetings/${meeting.id}/chat`, "GET", participant.cookie);
    const payload = await historyResponse.json();
    expect(historyResponse.status).toBe(200);
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].content).toBe("Before reconnect");
  });

  it("rejects new chat messages after the meeting ends", async () => {
    const { api, host, meeting } = await createJoinedChatRoom();
    await api.request(`/api/meetings/${meeting.id}/end`, "POST", host.cookie);

    const response = await api.request(`/api/meetings/${meeting.id}/chat`, "POST", host.cookie, { content: "Too late" });
    expect(response.status).toBe(409);
  });

  it("prevents a removed participant from posting in meeting chat", async () => {
    const { api, host, participant, meeting } = await createJoinedChatRoom();
    const removeResponse = await api.request(`/api/meetings/${meeting.id}/remove`, "POST", host.cookie, {
      actorUserId: host.userId,
      targetUserId: participant.userId,
    });
    expect(removeResponse.status).toBe(200);

    const response = await api.request(`/api/meetings/${meeting.id}/chat`, "POST", participant.cookie, { content: "Still here" });
    expect(response.status).toBe(403);
  });

  it("keeps chat histories isolated between meetings", async () => {
    const api = createChatApiFixture();
    const host = await api.createSession();
    const firstMeeting = await api.createOpenMeeting(host.cookie, "First chat room");
    const secondMeeting = await api.createOpenMeeting(host.cookie, "Second chat room");
    await api.request(`/api/meetings/${firstMeeting.id}/chat`, "POST", host.cookie, { content: "Only in the first room" });

    const firstHistory = await api.request(`/api/meetings/${firstMeeting.id}/chat`, "GET", host.cookie);
    const secondHistory = await api.request(`/api/meetings/${secondMeeting.id}/chat`, "GET", host.cookie);

    expect((await firstHistory.json()).data).toHaveLength(1);
    expect((await secondHistory.json()).data).toEqual([]);
  });

  it("allows the authenticated host to start recording and hides the R2 object key", async () => {
    const backingStorage = new Map<string, Map<string, unknown>>();
    const api = createChatApiFixture(createDurableObjectNamespace(backingStorage));
    const host = await api.createSession();
    const meeting = await api.createOpenMeeting(host.cookie, "Recording room");
    const response = await api.request(`/api/meetings/${meeting.id}/recording/start`, "POST", host.cookie);
    const payload = await response.json();
    const stored = backingStorage.get(meeting.id)?.get("recordings") as Array<{ storageRef: { objectKey: string } }>;

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      meetingId: meeting.id,
      status: "RECORDING",
      initiatedByUserId: host.userId,
    });
    expect(payload.data.recordingId).toBeTruthy();
    expect(payload.data.startedAt).toBeTruthy();
    expect(payload.data).not.toHaveProperty("storageRef");
    expect(JSON.stringify(payload)).not.toContain("objectKey");
    expect(stored[1].storageRef.objectKey).toContain(`recordings/${encodeURIComponent(meeting.id)}/`);
  });

  it("prevents a non-host from starting or stopping recording", async () => {
    const { api, host, participant, meeting } = await createJoinedChatRoom();
    const participantStart = await api.request(`/api/meetings/${meeting.id}/recording/start`, "POST", participant.cookie);
    expect(participantStart.status).toBe(403);

    await api.request(`/api/meetings/${meeting.id}/recording/start`, "POST", host.cookie);
    const participantStop = await api.request(`/api/meetings/${meeting.id}/recording/stop`, "POST", participant.cookie);
    expect(participantStop.status).toBe(403);
  });

  it("rejects a duplicate recording start while one is active", async () => {
    const { api, host, meeting } = await createJoinedChatRoom();
    const first = await api.request(`/api/meetings/${meeting.id}/recording/start`, "POST", host.cookie);
    const firstPayload = await first.json();
    const duplicate = await api.request(`/api/meetings/${meeting.id}/recording/start`, "POST", host.cookie);
    const duplicatePayload = await duplicate.json();

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(409);
    expect(duplicatePayload.error).toContain("already active");
    expect(firstPayload.data.recordingId).toBeTruthy();
  });

  it("persists final recording metadata when the host stops recording", async () => {
    const backingStorage = new Map<string, Map<string, unknown>>();
    const api = createChatApiFixture(createDurableObjectNamespace(backingStorage));
    const host = await api.createSession();
    const meeting = await api.createOpenMeeting(host.cookie, "Recording stop room");
    const started = await api.request(`/api/meetings/${meeting.id}/recording/start`, "POST", host.cookie);
    const startedPayload = await started.json();
    const partResponse = await api.uploadRecordingPart(meeting.id, startedPayload.data.recordingId, host.cookie, new Uint8Array([1, 2, 3, 4]));
    expect(partResponse.status).toBe(200);
    const stopped = await api.request(`/api/meetings/${meeting.id}/recording/stop`, "POST", host.cookie);
    const stoppedPayload = await stopped.json();
    const stored = backingStorage.get(meeting.id)?.get("recordings") as Array<Record<string, unknown>>;

    expect(stopped.status).toBe(200);
    expect(stoppedPayload.data).toMatchObject({
      recordingId: startedPayload.data.recordingId,
      meetingId: meeting.id,
      initiatedByUserId: host.userId,
      status: "STOPPED",
      sizeBytes: 4,
    });
    expect(stoppedPayload.data.stoppedAt).toBeTruthy();
    expect(stoppedPayload.data).not.toHaveProperty("storageRef");
    const internalRecording = stored[1] as { storageRef: { objectKey: string } };
    expect(api.recordingObjects.get(internalRecording.storageRef.objectKey)).toEqual({ size: 4, contentType: "video/webm" });
    expect(stored[1]).toMatchObject({ recordingId: startedPayload.data.recordingId, status: "STOPPED" });
  });

  it("marks recording FAILED and aborts private multipart state when the host reports capture failure", async () => {
    const api = createChatApiFixture();
    const host = await api.createSession();
    const meeting = await api.createOpenMeeting(host.cookie, "Capture failure room");
    const started = await api.request(`/api/meetings/${meeting.id}/recording/start`, "POST", host.cookie);
    const recording = (await started.json()).data;
    const failed = await api.request(`/api/meetings/${meeting.id}/recording/${recording.recordingId}/fail`, "POST", host.cookie, { failureCode: "CAPTURE_FAILED" });
    const failedPayload = await failed.json();

    expect(failed.status).toBe(200);
    expect(failedPayload.data).toMatchObject({ status: "FAILED", failureCode: "CAPTURE_FAILED" });
    expect(failedPayload.data).not.toHaveProperty("storageRef");
  });

  it("rejects starting a recording after the meeting has ended", async () => {
    const { api, host, meeting } = await createJoinedChatRoom();
    await api.request(`/api/meetings/${meeting.id}/end`, "POST", host.cookie);
    const response = await api.request(`/api/meetings/${meeting.id}/recording/start`, "POST", host.cookie);

    expect(response.status).toBe(409);
  });

  it("recovers recording metadata after runtime re-instantiation without exposing storage URLs", async () => {
    const backingStorage = new Map<string, Map<string, unknown>>();
    const api = createChatApiFixture(createDurableObjectNamespace(backingStorage));
    const host = await api.createSession();
    const meeting = await api.createOpenMeeting(host.cookie, "Restart recording room");
    const started = await api.request(`/api/meetings/${meeting.id}/recording/start`, "POST", host.cookie);
    const startedPayload = await started.json();

    const restartedApi = createChatApiFixture(createDurableObjectNamespace(backingStorage));
    const statusResponse = await restartedApi.request(`/api/meetings/${meeting.id}/recording`, "GET", host.cookie);
    const statusPayload = await statusResponse.json();

    expect(statusResponse.status).toBe(200);
    expect(statusPayload.data).toHaveLength(2);
    expect(statusPayload.data[1]).toMatchObject({ recordingId: startedPayload.data.recordingId, status: "RECORDING" });
    expect(JSON.stringify(statusPayload)).not.toMatch(/https?:\/\/|objectKey|storageRef/);
  });

  it("keeps recording metadata isolated between meetings", async () => {
    const api = createChatApiFixture();
    const host = await api.createSession();
    const firstMeeting = await api.createOpenMeeting(host.cookie, "First recording room");
    const secondMeeting = await api.createOpenMeeting(host.cookie, "Second recording room");
    await api.request(`/api/meetings/${firstMeeting.id}/recording/start`, "POST", host.cookie);

    const firstStatus = await api.request(`/api/meetings/${firstMeeting.id}/recording`, "GET", host.cookie);
    const secondStatus = await api.request(`/api/meetings/${secondMeeting.id}/recording`, "GET", host.cookie);

    expect((await firstStatus.json()).data.map((entry: { status: string }) => entry.status)).toEqual(["NOT_STARTED", "RECORDING"]);
    expect((await secondStatus.json()).data.map((entry: { status: string }) => entry.status)).toEqual(["NOT_STARTED"]);
  });

  it("lists a meeting for its host with role, status, and creation time", async () => {
    const api = createChatApiFixture();
    const host = await api.createSession();
    const meeting = await api.createOpenMeeting(host.cookie, "Host history room");
    const response = await api.request("/api/meetings/history", "GET", host.cookie);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toContainEqual(expect.objectContaining({
      meetingId: meeting.id,
      title: "Host history room",
      status: "active",
      participantRole: "HOST",
      latestRecordingStatus: "NOT_STARTED",
    }));
    expect(payload.data[0].createdAt).toBeTruthy();
  });

  it("lists a meeting for a participant after they join", async () => {
    const { api, participant, meeting } = await createJoinedChatRoom();
    const response = await api.request("/api/meetings/history", "GET", participant.cookie);
    const payload = await response.json();

    expect(payload.data).toContainEqual(expect.objectContaining({
      meetingId: meeting.id,
      participantRole: "PARTICIPANT",
      status: "active",
    }));
  });

  it("does not show another user's meeting even if a userId is supplied by the client", async () => {
    const api = createChatApiFixture();
    const host = await api.createSession();
    const meeting = await api.createOpenMeeting(host.cookie, "Private history room");
    const unrelated = await api.createSession();
    const response = await api.request(`/api/meetings/history?userId=${encodeURIComponent(host.userId)}`, "GET", unrelated.cookie);
    const payload = await response.json();

    expect(payload.data).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain(meeting.id);
  });

  it("keeps ended meetings visible and includes their end time", async () => {
    const api = createChatApiFixture();
    const host = await api.createSession();
    const meeting = await api.createOpenMeeting(host.cookie, "Ended history room");
    await api.request(`/api/meetings/${meeting.id}/end`, "POST", host.cookie);

    const response = await api.request("/api/meetings/history", "GET", host.cookie);
    const payload = await response.json();
    const historyEntry = payload.data.find((entry: { meetingId: string }) => entry.meetingId === meeting.id);

    expect(historyEntry).toMatchObject({ meetingId: meeting.id, status: "ended", participantRole: "HOST" });
    expect(historyEntry.endedAt).toBeTruthy();
  });

  it("preserves meeting history across Worker and Durable Object re-instantiation", async () => {
    const backingStorage = new Map<string, Map<string, unknown>>();
    const api = createChatApiFixture(createDurableObjectNamespace(backingStorage));
    const host = await api.createSession();
    const meeting = await api.createOpenMeeting(host.cookie, "Restarted history room");
    await api.request(`/api/meetings/${meeting.id}/end`, "POST", host.cookie);

    const restartedApi = createChatApiFixture(createDurableObjectNamespace(backingStorage));
    const response = await restartedApi.request("/api/meetings/history", "GET", host.cookie);
    const payload = await response.json();

    expect(payload.data).toContainEqual(expect.objectContaining({
      meetingId: meeting.id,
      title: "Restarted history room",
      status: "ended",
      participantRole: "HOST",
    }));
  });

  it("includes latest recording lifecycle status without exposing its storage reference", async () => {
    const api = createChatApiFixture();
    const host = await api.createSession();
    const meeting = await api.createOpenMeeting(host.cookie, "Recording history room");
    await api.request(`/api/meetings/${meeting.id}/recording/start`, "POST", host.cookie);

    const response = await api.request("/api/meetings/history", "GET", host.cookie);
    const payload = await response.json();
    const historyEntry = payload.data.find((entry: { meetingId: string }) => entry.meetingId === meeting.id);

    expect(historyEntry.latestRecordingStatus).toBe("RECORDING");
    expect(JSON.stringify(payload)).not.toMatch(/storageRef|objectKey|https?:\/\//);
  });

  it("does not add rejected or never-admitted users to meeting history", async () => {
    const api = createChatApiFixture();
    const host = await api.createSession();
    const guest = await api.createSession();
    const meeting = await api.createMeeting(host.cookie, "Approval history room", "HOST_APPROVAL");
    const admissionResponse = await api.request(`/api/meetings/${meeting.id}/admission/request`, "POST", guest.cookie, { displayName: "Waiting Guest" });
    const admission = (await admissionResponse.json()).data;
    const rejectResponse = await api.request(`/api/meetings/${meeting.id}/admission/${admission.id}/reject`, "POST", host.cookie);
    expect(rejectResponse.status).toBe(200);

    const response = await api.request("/api/meetings/history", "GET", guest.cookie);
    expect((await response.json()).data).toEqual([]);
  });

  it("keeps meeting histories isolated across users", async () => {
    const api = createChatApiFixture();
    const host = await api.createSession();
    const participant = await api.createSession();
    const unrelated = await api.createSession();
    const meeting = await api.createOpenMeeting(host.cookie, "User history isolation");
    await api.request(`/api/meetings/${meeting.id}/join`, "POST", participant.cookie, { displayName: "History Guest" });

    const hostHistory = await api.request("/api/meetings/history", "GET", host.cookie);
    const participantHistory = await api.request("/api/meetings/history", "GET", participant.cookie);
    const unrelatedHistory = await api.request("/api/meetings/history", "GET", unrelated.cookie);

    expect((await hostHistory.json()).data.map((entry: { meetingId: string }) => entry.meetingId)).toContain(meeting.id);
    expect((await participantHistory.json()).data.map((entry: { meetingId: string }) => entry.meetingId)).toContain(meeting.id);
    expect((await unrelatedHistory.json()).data).toEqual([]);
  });

  it("creates the SFU session and publishes local tracks through server-side requests only", async () => {
    const api = createChatApiFixture();
    const host = await api.createSession();
    const meeting = await api.createOpenMeeting(host.cookie, "SFU publish room");
    const calls: Array<{ url: string; method: string; headers: Headers; body: unknown }> = [];
    const sfuFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, headers: new Headers(init?.headers), body });

      if (url.endsWith("/sessions/new")) return Response.json({ sessionId: "private-sfu-session-id" }, { status: 201 });
      return Response.json({
        sessionDescription: { type: "answer", sdp: "sfu-answer-sdp" },
        tracks: [{ mid: "0", trackName: "microphone" }, { mid: "1", trackName: "camera" }],
      });
    });
    vi.stubGlobal("fetch", sfuFetch);

    try {
      const response = await api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", host.cookie, {
        connectionId: "connection-test-123",
        sessionDescription: { type: "offer", sdp: "browser-offer-sdp" },
        tracks: [
          { trackName: "microphone", mid: "0" },
          { trackName: "camera", mid: "1" },
        ],
        userId: "spoofed-user",
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.data.sessionDescription).toEqual({ type: "answer", sdp: "sfu-answer-sdp" });
      expect(payload.data.tracks).toHaveLength(2);
      expect(payload.data.publisherDiagnostics).toMatchObject({
        participantId: expect.any(String),
        publisherSessionPresent: true,
        publishedTracks: [],
        pendingPublishedTracks: [
          { trackName: "microphone", mid: "0" },
          { trackName: "camera", mid: "1" },
        ],
      });
      expect(JSON.stringify(payload)).not.toContain("private-sfu-session-id");
      expect(JSON.stringify(payload)).not.toContain("test-sfu-app-secret");
      expect(calls.map((call) => [call.method, call.url])).toEqual([
        ["POST", "https://rtc.live.cloudflare.com/v1/apps/test-sfu-app-id/sessions/new"],
        ["POST", "https://rtc.live.cloudflare.com/v1/apps/test-sfu-app-id/sessions/private-sfu-session-id/tracks/new"],
      ]);
      expect(calls.every((call) => call.headers.get("Authorization") === "Bearer test-sfu-app-secret")).toBe(true);
      expect(calls[1].body).toMatchObject({
        sessionDescription: { type: "offer", sdp: "browser-offer-sdp" },
        tracks: [
          { location: "local", mid: "0", trackName: "microphone" },
          { location: "local", mid: "1", trackName: "camera" },
        ],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("invalidates a disconnected publisher session on 410 and preserves subscriber state", async () => {
    const namespace = createDurableObjectNamespace();
    const { api, host, meeting } = await createJoinedChatRoom(namespace);
    const sfu = createSfuFetchMock();
    const attemptedPublishUrls: string[] = [];
    let failStalePublisher = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/tracks/new") && String(init?.body).includes('"location":"local"')) {
        attemptedPublishUrls.push(url);
        if (failStalePublisher && url.includes("/sessions/sfu-session-1-secretish/")) {
          failStalePublisher = false;
          return Response.json({
            errorCode: "session_error",
            errorDescription: "Session appears to be disconnected. Please check if the PeerConnection is connected.",
          }, { status: 410 });
        }
      }
      return sfu.fetcher(input, init);
    }));

    try {
      const initial = await api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", host.cookie, {
        connectionId: "publisher-liveness-connection",
        sessionDescription: { type: "offer", sdp: "initial-offer" },
        tracks: [{ trackName: "camera", mid: "0" }],
      });
      expect(initial.status).toBe(200);
      expect((await initial.json()).data.publisherGeneration).toBe(1);

      const ready = await api.request(`/api/meetings/${meeting.id}/media/publish/ready`, "POST", host.cookie, {
        connectionId: "publisher-liveness-connection",
        trackNames: ["camera"],
      });
      expect(ready.status).toBe(200);
      failStalePublisher = true;

      const rpc = namespace.get(meeting.id);
      const current = (await rpc.getSfuParticipantState(host.userId))!;
      await rpc.saveSfuParticipantState({
        ...current,
        subscriberSessionId: "subscriber-session-retained",
        subscribedTracks: [{
          publicationKey: "remote-user:1:camera",
          publisherUserId: "remote-user",
          publisherDisplayName: "Remote",
          trackName: "camera",
          mid: "remote-0",
        }],
      });

      const failed = await api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", host.cookie, {
        connectionId: "publisher-liveness-connection",
        sessionDescription: { type: "offer", sdp: "disconnected-publisher-offer" },
        tracks: [{ trackName: "microphone", mid: "1" }],
      });
      const failurePayload = await failed.json();
      expect(failed.status).toBe(410);
      expect(failurePayload).toMatchObject({
        ok: false,
        upstreamStatus: 410,
        errorCode: "session_error",
        errorDescription: "Session appears to be disconnected. Please check if the PeerConnection is connected.",
      });

      const invalidated = (await rpc.getSfuParticipantState(host.userId))!;
      expect(invalidated.publisherSessionId).toBeUndefined();
      expect(invalidated.generation).toBe(2);
      expect(invalidated.publishedTracks).toEqual([]);
      expect(invalidated.pendingPublishedTracks).toEqual([]);
      expect(invalidated.subscriberSessionId).toBe("subscriber-session-retained");
      expect(invalidated.subscribedTracks).toEqual([expect.objectContaining({ mid: "remote-0", trackName: "camera" })]);

      const retried = await api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", host.cookie, {
        connectionId: "publisher-liveness-connection",
        sessionDescription: { type: "offer", sdp: "fresh-publisher-offer" },
        tracks: [{ trackName: "microphone", mid: "0" }],
      });
      expect(retried.status).toBe(200);
      expect((await retried.json()).data.publisherGeneration).toBe(2);
      expect(attemptedPublishUrls).toHaveLength(3);
      expect(attemptedPublishUrls[1]).toContain("/sessions/sfu-session-1-secretish/");
      expect(attemptedPublishUrls[2]).toContain("/sessions/sfu-session-2-secretish/");
      expect((await rpc.getSfuParticipantState(host.userId))?.subscriberSessionId).toBe("subscriber-session-retained");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("subscribes joined participants to remote publications and completes the returned SDP offer", async () => {
    const { api, host, participant, meeting } = await createJoinedChatRoom();
    const sfu = createSfuFetchMock();
    vi.stubGlobal("fetch", sfu.fetcher);
    try {
      const publish = await api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", host.cookie, {
        connectionId: "publisher-connection-1",
        sessionDescription: { type: "offer", sdp: "publisher-offer" },
        tracks: [{ trackName: "camera", mid: "0" }, { trackName: "microphone", mid: "1" }],
      });
      expect(publish.status).toBe(200);

      const pendingSubscribe = await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", participant.cookie, { connectionId: "subscriber-connection-1" });
      expect((await pendingSubscribe.json()).data.tracks).toEqual([]);
      expect(sfu.calls.filter((call) => call.url.endsWith("/tracks/new") && call.body.tracks?.[0]?.location === "remote")).toHaveLength(0);

      const ready = await api.request(`/api/meetings/${meeting.id}/media/publish/ready`, "POST", host.cookie, {
        connectionId: "publisher-connection-1",
        trackNames: ["camera", "microphone"],
      });
      expect(ready.status).toBe(200);

      const subscribe = await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", participant.cookie, { connectionId: "subscriber-connection-1" });
      const subscribePayload = await subscribe.json();
      expect(subscribe.status).toBe(200);
      expect(subscribePayload.data.sessionDescription).toEqual({ type: "offer", sdp: "sfu-subscribe-offer" });
      expect(subscribePayload.data.tracks).toEqual([
        expect.objectContaining({ publisherUserId: host.userId, trackName: "camera", mid: "remote-0" }),
        expect.objectContaining({ publisherUserId: host.userId, trackName: "microphone", mid: "remote-1" }),
      ]);
      expect(JSON.stringify(subscribePayload)).not.toContain("sfu-session-");

      const answer = await api.request(`/api/meetings/${meeting.id}/media/renegotiate`, "POST", participant.cookie, {
        connectionId: "subscriber-connection-1",
        operationId: subscribePayload.data.operationId,
        sessionDescription: { type: "answer", sdp: "subscriber-answer" },
      });
      expect(answer.status).toBe(200);
      expect(sfu.calls.some((call) => call.url.endsWith("/renegotiate") && call.body.sessionDescription.sdp === "subscriber-answer")).toBe(true);
      const remoteCreate = sfu.calls.find((call) => call.url.endsWith("/tracks/new") && call.body.tracks?.[0]?.location === "remote");
      expect(remoteCreate?.body.tracks).toEqual([
        { location: "remote", sessionId: "sfu-session-1-secretish", trackName: "camera" },
        { location: "remote", sessionId: "sfu-session-1-secretish", trackName: "microphone" },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("recovers only the publisher transport and republishes active tracks without duplicating membership", async () => {
    const { api, host, participant, meeting } = await createJoinedChatRoom();
    const sfu = createSfuFetchMock();
    vi.stubGlobal("fetch", sfu.fetcher);
    try {
      const publish = async (cookie: string, connectionId: string, sdp: string, tracks: Array<{ trackName: string; mid: string }>) => {
        const response = await api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", cookie, {
          connectionId,
          sessionDescription: { type: "offer", sdp },
          tracks,
        });
        expect(response.status).toBe(200);
      };
      const ready = (cookie: string, connectionId: string, trackNames: string[]) => api.request(`/api/meetings/${meeting.id}/media/publish/ready`, "POST", cookie, { connectionId, trackNames });

      await publish(participant.cookie, "participant-publisher-recovery", "participant-mic-offer", [{ trackName: "microphone", mid: "0" }]);
      expect((await ready(participant.cookie, "participant-publisher-recovery", ["microphone"])).status).toBe(200);
      await publish(host.cookie, "host-publisher-recovery", "host-initial-offer", [
        { trackName: "camera", mid: "0" },
        { trackName: "microphone", mid: "1" },
      ]);
      expect((await ready(host.cookie, "host-publisher-recovery", ["camera", "microphone"])).status).toBe(200);

      const hostSubscribe = await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", host.cookie, { connectionId: "host-publisher-recovery" });
      const hostSubscribePayload = await hostSubscribe.json();
      expect(hostSubscribe.status).toBe(200);
      expect((await api.request(`/api/meetings/${meeting.id}/media/renegotiate`, "POST", host.cookie, {
        connectionId: "host-publisher-recovery",
        operationId: hostSubscribePayload.data.operationId,
        sessionDescription: { type: "answer", sdp: "host-subscriber-answer" },
      })).status).toBe(200);

      const recovered = await api.request(`/api/meetings/${meeting.id}/media/recover`, "POST", host.cookie, {
        connectionId: "host-publisher-recovery",
        direction: "publisher",
      });
      expect(recovered.status).toBe(200);
      expect(sfu.calls.some((call) => call.url.endsWith("/sessions/sfu-session-2-secretish/tracks/close") && call.body.tracks.map((track: { mid: string }) => track.mid).sort().join(",") === "0,1")).toBe(true);

      const unchangedSubscriber = await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", host.cookie, { connectionId: "host-publisher-recovery" });
      expect((await unchangedSubscriber.json()).data.tracks).toEqual([]);
      expect(sfu.calls.filter((call) => call.url.endsWith("/sessions/new"))).toHaveLength(3);

      await publish(host.cookie, "host-publisher-recovery", "host-republished-offer", [
        { trackName: "camera", mid: "2" },
        { trackName: "microphone", mid: "3" },
      ]);
      expect((await ready(host.cookie, "host-publisher-recovery", ["camera", "microphone"])).status).toBe(200);
      const participantSubscribe = await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", participant.cookie, { connectionId: "participant-new-subscriber" });
      const participantPayload = await participantSubscribe.json();
      expect(participantPayload.data.tracks.map((track: { trackName: string }) => track.trackName)).toEqual(["camera", "microphone"]);
      const republishedRemoteCreate = sfu.calls.find((call) => call.url.endsWith("/sessions/sfu-session-5-secretish/tracks/new"));
      expect(republishedRemoteCreate?.body.tracks).toEqual([
        { location: "remote", sessionId: "sfu-session-4-secretish", trackName: "camera" },
        { location: "remote", sessionId: "sfu-session-4-secretish", trackName: "microphone" },
      ]);

      const meetingResponse = await api.request(`/api/meetings/${meeting.id}`);
      const meetingPayload = await meetingResponse.json();
      expect(meetingPayload.data.participants.filter((entry: { userId: string }) => entry.userId === host.userId)).toHaveLength(1);
      expect(meetingPayload.data.participants.filter((entry: { userId: string }) => entry.userId === participant.userId)).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("recovers only the subscriber transport while preserving the publisher session and membership", async () => {
    const { api, host, participant, meeting } = await createJoinedChatRoom();
    const sfu = createSfuFetchMock();
    vi.stubGlobal("fetch", sfu.fetcher);
    try {
      const publish = await api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", host.cookie, {
        connectionId: "host-subscriber-recovery",
        sessionDescription: { type: "offer", sdp: "host-publisher-offer" },
        tracks: [{ trackName: "microphone", mid: "0" }],
      });
      expect(publish.status).toBe(200);
      expect((await api.request(`/api/meetings/${meeting.id}/media/publish/ready`, "POST", host.cookie, {
        connectionId: "host-subscriber-recovery",
        trackNames: ["microphone"],
      })).status).toBe(200);

      const subscribe = async () => api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", participant.cookie, { connectionId: "participant-subscriber-recovery" });
      const firstSubscribe = await subscribe();
      const firstPayload = await firstSubscribe.json();
      expect(firstPayload.data.tracks).toEqual([
        expect.objectContaining({ publisherUserId: host.userId, trackName: "microphone", mid: "remote-0" }),
      ]);
      expect((await api.request(`/api/meetings/${meeting.id}/media/renegotiate`, "POST", participant.cookie, {
        connectionId: "participant-subscriber-recovery",
        operationId: firstPayload.data.operationId,
        sessionDescription: { type: "answer", sdp: "participant-first-answer" },
      })).status).toBe(200);

      const recovered = await api.request(`/api/meetings/${meeting.id}/media/recover`, "POST", participant.cookie, {
        connectionId: "participant-subscriber-recovery",
        direction: "subscriber",
      });
      expect(recovered.status).toBe(200);
      expect(sfu.calls.some((call) => call.url.endsWith("/sessions/sfu-session-2-secretish/tracks/close") && call.body.tracks[0].mid === "remote-0")).toBe(true);

      const afterRecovery = await subscribe();
      const afterPayload = await afterRecovery.json();
      expect(afterPayload.data.tracks).toEqual([
        expect.objectContaining({ publisherUserId: host.userId, trackName: "microphone", mid: "remote-0" }),
      ]);
      const recreatedSubscriberCall = sfu.calls.find((call) => call.url.endsWith("/sessions/sfu-session-3-secretish/tracks/new"));
      expect(recreatedSubscriberCall?.body.tracks).toEqual([
        { location: "remote", sessionId: "sfu-session-1-secretish", trackName: "microphone" },
      ]);

      const meetingPayload = await (await api.request(`/api/meetings/${meeting.id}`)).json();
      expect(meetingPayload.data.participants.filter((entry: { userId: string }) => entry.userId === participant.userId)).toHaveLength(1);
      expect(meetingPayload.data.participants.filter((entry: { userId: string }) => entry.userId === host.userId)).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe("subscriber session mutation ordering", () => {
    async function roomWithHostMedia() {
      const namespace = createDurableObjectNamespace();
      const room = await createJoinedChatRoom(namespace);
      const sfu = createSfuFetchMock();
      vi.stubGlobal("fetch", sfu.fetcher);
      const publish = await room.api.request(`/api/meetings/${room.meeting.id}/media/publish`, "POST", room.host.cookie, {
        connectionId: "host-publisher-connection",
        sessionDescription: { type: "offer", sdp: "publisher-offer" },
        tracks: [{ trackName: "camera", mid: "0" }, { trackName: "microphone", mid: "1" }],
      });
      expect(publish.status).toBe(200);
      expect((await room.api.request(`/api/meetings/${room.meeting.id}/media/publish/ready`, "POST", room.host.cookie, {
        connectionId: "host-publisher-connection",
        trackNames: ["camera", "microphone"],
      })).status).toBe(200);
      const subscribe = () => room.api.request(`/api/meetings/${room.meeting.id}/media/subscribe`, "POST", room.participant.cookie, { connectionId: "participant-subscriber-connection" });
      const renegotiate = (operationId: string) => room.api.request(`/api/meetings/${room.meeting.id}/media/renegotiate`, "POST", room.participant.cookie, {
        connectionId: "participant-subscriber-connection",
        operationId,
        sessionDescription: { type: "answer", sdp: "subscriber-answer" },
      });
      const recover = () => room.api.request(`/api/meetings/${room.meeting.id}/media/recover`, "POST", room.participant.cookie, {
        connectionId: "participant-subscriber-connection",
        direction: "subscriber",
      });
      return { ...room, namespace, sfu, subscribe, renegotiate, recover };
    }
    const remoteCreates = (calls: Array<{ url: string; body: any }>) => calls.filter((call) => call.url.endsWith("/tracks/new") && call.body?.tracks?.[0]?.location === "remote");
    const upstreamError = (status: number, errorCode: string, errorDescription: string) => Response.json({ errorCode, errorDescription }, { status });

    it("never lets simultaneous subscribe requests reach one Cloudflare session together", async () => {
      const { sfu, subscribe } = await roomWithHostMedia();
      let inFlight = 0;
      let maxInFlight = 0;
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const isMutation = url.endsWith("/tracks/new") || url.endsWith("/renegotiate") || url.endsWith("/tracks/close");
        if (isMutation) { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); }
        try {
          if (isMutation) await new Promise((resolve) => setTimeout(resolve, 20));
          return await sfu.fetcher(input, init);
        } finally {
          if (isMutation) inFlight -= 1;
        }
      }));
      try {
        const [first, second] = await Promise.all([subscribe(), subscribe()]);
        const firstPayload = await first.json();
        const secondPayload = await second.json();
        expect(maxInFlight).toBe(1);
        expect(remoteCreates(sfu.calls)).toHaveLength(1);
        expect(secondPayload.data.operationId).toBe(firstPayload.data.operationId);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("fails closed when the participant media lock cannot be acquired", async () => {
      const baseNamespace = createDurableObjectNamespace();
      const namespace = {
        idFromName: baseNamespace.idFromName,
        get: (id: string) => new Proxy(baseNamespace.get(id), {
          get(target, property, receiver) {
            if (property === "acquireSfuMutation") return async () => { throw new Error("lock unavailable"); };
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      };
      const { api, participant, meeting } = await createJoinedChatRoom(namespace);
      const response = await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", participant.cookie, {
        connectionId: "participant-subscriber-connection",
      });
      expect(response.status).toBe(503);
      expect((await response.json()).error).toBe("Media mutation is temporarily unavailable.");
    });

    it("deduplicates publication locators before subscribing", async () => {
      const { sfu, subscribe, namespace, meeting, host } = await roomWithHostMedia();
      vi.stubGlobal("fetch", sfu.fetcher);
      try {
        const rpc = namespace.get(meeting.id);
        const hostState = (await rpc.getSfuParticipantState(host.userId))!;
        await rpc.saveSfuParticipantState({ ...hostState, publishedTracks: [...hostState.publishedTracks, ...hostState.publishedTracks] });
        const payload = await (await subscribe()).json();
        expect(payload.data.tracks.map((track: { trackName: string }) => track.trackName)).toEqual(["camera", "microphone"]);
        expect(remoteCreates(sfu.calls)[0].body.tracks).toHaveLength(2);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("reports Cloudflare errorCode and errorDescription for a 406 from tracks/new without saving a pending operation", async () => {
      const { sfu, subscribe } = await roomWithHostMedia();
      let failed = false;
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (!failed && url.endsWith("/tracks/new") && String(init?.body).includes('"remote"')) {
          failed = true;
          return upstreamError(406, "negotiation_in_progress", "Previous exchange incomplete");
        }
        return sfu.fetcher(input, init);
      }));
      try {
        const response = await subscribe();
        const payload = await response.json();
        expect(response.status).toBe(502);
        expect(payload.error).toContain("HTTP status: 406");
        expect(payload.error).toContain("errorCode: negotiation_in_progress");
        expect(payload.error).toContain("errorDescription: Previous exchange incomplete");
        const retry = await (await subscribe()).json();
        expect(retry.data.tracks).toHaveLength(2);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("replaces the subscriber session once after a 406 from renegotiate and does not duplicate tracks", async () => {
      const { sfu, subscribe, renegotiate, recover } = await roomWithHostMedia();
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        const firstSubscriberSession = "sfu-session-2-secretish";
        if (url.includes(firstSubscriberSession) && (url.endsWith("/renegotiate") || url.endsWith("/tracks/close"))) {
          sfu.calls.push({ url, method: "PUT", headers: new Headers(), body });
          return upstreamError(406, "negotiation_in_progress", "Previous exchange incomplete");
        }
        return sfu.fetcher(input, init);
      }));
      try {
        const first = await (await subscribe()).json();
        const failedRenegotiation = await renegotiate(first.data.operationId);
        expect(failedRenegotiation.status).toBe(502);
        expect((await failedRenegotiation.json()).error).toContain("errorCode: negotiation_in_progress");

        // Uncertain outcome: the old session cannot even be closed, yet recovery must still succeed.
        expect((await recover()).status).toBe(200);
        const replacement = await (await subscribe()).json();
        expect(replacement.data.tracks.map((track: { trackName: string }) => track.trackName)).toEqual(["camera", "microphone"]);
        expect((await renegotiate(replacement.data.operationId)).status).toBe(200);

        const afterReplacement = await (await subscribe()).json();
        expect(afterReplacement.data.tracks).toEqual([]);
        const creates = remoteCreates(sfu.calls);
        expect(creates).toHaveLength(2);
        expect(creates[1].url).toContain("sfu-session-3-secretish");
        expect(creates[1].body.tracks).toHaveLength(2);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("allows a participant microphone publication to be discovered and subscribed by the host", async () => {
    const { api, host, participant, meeting } = await createJoinedChatRoom();
    const sfu = createSfuFetchMock();
    vi.stubGlobal("fetch", sfu.fetcher);
    try {
      const publish = await api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", participant.cookie, {
        connectionId: "participant-mic-connection",
        sessionDescription: { type: "offer", sdp: "participant-mic-offer" },
        tracks: [{ trackName: "microphone", mid: "0" }],
      });
      expect(publish.status).toBe(200);
      const ready = await api.request(`/api/meetings/${meeting.id}/media/publish/ready`, "POST", participant.cookie, {
        connectionId: "participant-mic-connection",
        trackNames: ["microphone"],
      });
      expect(ready.status).toBe(200);

      const discovery = await api.request(`/api/meetings/${meeting.id}/media/publications`, "GET", host.cookie);
      const discoveryPayload = await discovery.json();
      expect(discovery.status).toBe(200);
      expect(discoveryPayload.data.publications).toEqual([
        { participantId: expect.any(String), generation: 1, trackName: "microphone", mid: "0" },
      ]);
      expect(discoveryPayload.data.diagnostics).toMatchObject({
        subscriberParticipantId: expect.any(String),
        desiredPublicationCount: 1,
        participants: [
          expect.objectContaining({ userId: host.userId, exclusionReason: "local-participant" }),
          expect.objectContaining({
            userId: participant.userId,
            publisherSessionPresent: true,
            publishedTracks: [{ trackName: "microphone", mid: "0", included: true, reason: "included" }],
          }),
        ],
      });
      expect(JSON.stringify(discoveryPayload)).not.toContain("sfu-session-1-secretish");
      expect(JSON.stringify(discoveryPayload)).not.toContain("test-sfu-app-secret");

      const subscribe = await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", host.cookie, { connectionId: "host-mic-subscriber" });
      const payload = await subscribe.json();
      expect(subscribe.status).toBe(200);
      expect(payload.data.tracks).toEqual([
        expect.objectContaining({ publisherUserId: participant.userId, trackName: "microphone", mid: "remote-0" }),
      ]);
      expect(payload.data.diagnostics).toMatchObject({
        subscriberParticipantId: expect.any(String),
        desiredPublicationCount: 1,
        participants: expect.arrayContaining([
          expect.objectContaining({ userId: host.userId, exclusionReason: "local-participant" }),
          expect.objectContaining({ userId: participant.userId, publisherSessionPresent: true }),
        ]),
      });
      const remoteCreate = sfu.calls.find((call) => call.url.endsWith("/tracks/new") && call.body.tracks?.[0]?.location === "remote");
      expect(remoteCreate?.body.tracks).toEqual([
        { location: "remote", sessionId: "sfu-session-1-secretish", trackName: "microphone" },
      ]);
      const answer = await api.request(`/api/meetings/${meeting.id}/media/renegotiate`, "POST", host.cookie, {
        connectionId: "host-mic-subscriber",
        operationId: payload.data.operationId,
        sessionDescription: { type: "answer", sdp: "host-mic-answer" },
      });
      expect(answer.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("discovers exactly each other participant's camera and microphone when display names match", async () => {
    const { api, host, participant, meeting } = await createJoinedChatRoom();
    const initialSnapshot = await (await api.request(`/api/meetings/${meeting.id}`, "GET", host.cookie)).json();
    const hostName = initialSnapshot.data.participants.find((entry: { userId: string }) => entry.userId === host.userId).displayName;
    await api.request(`/api/meetings/${meeting.id}/join`, "POST", participant.cookie, {
      userId: "untrusted-client-user",
      displayName: hostName,
    });
    const sfu = createSfuFetchMock();
    vi.stubGlobal("fetch", sfu.fetcher);

    try {
      const publishTracks = [
        { trackName: "microphone", mid: "0" },
        { trackName: "camera", mid: "1" },
      ];
      const publish = async (cookie: string, connectionId: string) => api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", cookie, {
        connectionId,
        sessionDescription: { type: "offer", sdp: `${connectionId}-offer` },
        tracks: publishTracks,
      });
      const ready = async (cookie: string, connectionId: string) => api.request(`/api/meetings/${meeting.id}/media/publish/ready`, "POST", cookie, {
        connectionId,
        trackNames: ["microphone", "camera"],
      });
      expect((await publish(host.cookie, "host-shared-media-connection")).status).toBe(200);
      expect((await ready(host.cookie, "host-shared-media-connection")).status).toBe(200);
      expect((await publish(participant.cookie, "guest-shared-media-connection")).status).toBe(200);
      expect((await ready(participant.cookie, "guest-shared-media-connection")).status).toBe(200);

      const hostSubscribe = await (await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", host.cookie, {
        connectionId: "host-shared-media-connection",
      })).json();
      expect(hostSubscribe.data.tracks).toHaveLength(2);
      expect(hostSubscribe.data.tracks.map((track: { publisherUserId: string; trackName: string }) => [track.publisherUserId, track.trackName]))
        .toEqual(expect.arrayContaining([[participant.userId, "microphone"], [participant.userId, "camera"]]));
      expect(hostSubscribe.data.diagnostics.subscriberParticipantId).not.toBe(host.userId);
      expect(hostSubscribe.data.diagnostics.participants.find((entry: { userId: string }) => entry.userId === participant.userId).participantId)
        .not.toBe(participant.userId);
      expect(hostSubscribe.data.diagnostics.participants.find((entry: { userId: string }) => entry.userId === host.userId).exclusionReason)
        .toBe("local-participant");

      const guestSubscribe = await (await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", participant.cookie, {
        connectionId: "guest-shared-media-connection",
      })).json();
      expect(guestSubscribe.data.tracks).toHaveLength(2);
      expect(guestSubscribe.data.tracks.map((track: { publisherUserId: string; trackName: string }) => [track.publisherUserId, track.trackName]))
        .toEqual(expect.arrayContaining([[host.userId, "microphone"], [host.userId, "camera"]]));
      expect(guestSubscribe.data.diagnostics.participants.find((entry: { userId: string }) => entry.userId === participant.userId).exclusionReason)
        .toBe("local-participant");
      expect(sfu.calls.filter((call) => call.url.endsWith("/tracks/new") && call.body.tracks?.[0]?.location === "remote"))
        .toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retains an admitted guest's publication across meeting snapshot refresh", async () => {
    const api = createChatApiFixture();
    const host = await api.createSession();
    const guest = await api.createSession();
    const meeting = await api.createMeeting(host.cookie, "Admitted guest media", "HOST_APPROVAL");
    const admission = await (await api.request(`/api/meetings/${meeting.id}/join`, "POST", guest.cookie, {
      displayName: "Admitted Guest",
    })).json();
    expect(admission.data.status).toBe("WAITING");
    await api.request(`/api/meetings/${meeting.id}/admission/${admission.data.id}/approve`, "POST", host.cookie);
    const joinedSnapshot = await (await api.request(`/api/meetings/${meeting.id}`, "GET", guest.cookie)).json();
    expect(joinedSnapshot.data.participants.find((entry: { userId: string }) => entry.userId === guest.userId).state).toBe("JOINED");

    const sfu = createSfuFetchMock();
    vi.stubGlobal("fetch", sfu.fetcher);
    try {
      const publish = await api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", guest.cookie, {
        connectionId: "admitted-guest-publisher",
        sessionDescription: { type: "offer", sdp: "admitted-guest-offer" },
        tracks: [{ trackName: "microphone", mid: "0" }, { trackName: "camera", mid: "1" }],
      });
      const publishPayload = await publish.json();
      expect(publish.status).toBe(200);
      const admittedParticipant = joinedSnapshot.data.participants.find((entry: { userId: string }) => entry.userId === guest.userId);
      expect(publishPayload.data.publisherDiagnostics).toMatchObject({
        participantId: admittedParticipant.id,
        userIdSuffix: guest.userId.slice(-6),
        publisherSessionPresent: true,
        publishedTracks: [],
        pendingPublishedTracks: [{ trackName: "microphone", mid: "0" }, { trackName: "camera", mid: "1" }],
      });
      const ready = await api.request(`/api/meetings/${meeting.id}/media/publish/ready`, "POST", guest.cookie, {
        connectionId: "admitted-guest-publisher",
        trackNames: ["microphone", "camera"],
      });
      expect(ready.status).toBe(200);
      expect((await ready.json()).data.publisherDiagnostics).toMatchObject({
        participantId: admittedParticipant.id,
        userIdSuffix: guest.userId.slice(-6),
        publisherSessionPresent: true,
        publishedTracks: expect.arrayContaining([
          { trackName: "microphone", mid: "0" },
          { trackName: "camera", mid: "1" },
        ]),
      });
      await api.request(`/api/meetings/${meeting.id}`, "GET", guest.cookie);

      const subscribe = await (await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", host.cookie, {
        connectionId: "host-admitted-subscriber",
      })).json();
      expect(subscribe.data.tracks).toHaveLength(2);
      expect(subscribe.data.tracks.map((track: { trackName: string }) => track.trackName).sort()).toEqual(["camera", "microphone"]);
      expect(subscribe.data.diagnostics.participants.find((entry: { userId: string }) => entry.userId === guest.userId))
        .toMatchObject({
          publisherSessionPresent: true,
          publishedTracks: expect.arrayContaining([
            { trackName: "microphone", mid: "0", included: true, reason: "included" },
            { trackName: "camera", mid: "1", included: true, reason: "included" },
          ]),
        });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("repopulates a recovered guest publisher under the same admitted participant identity", async () => {
    const { api, host, participant, meeting } = await createJoinedChatRoom();
    const sfu = createSfuFetchMock();
    vi.stubGlobal("fetch", sfu.fetcher);
    try {
      const initialSnapshot = await (await api.request(`/api/meetings/${meeting.id}`, "GET", participant.cookie)).json();
      const participantId = initialSnapshot.data.participants.find((entry: { userId: string }) => entry.userId === participant.userId).id;
      const publish = (sdp: string, mids: [string, string]) => api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", participant.cookie, {
        connectionId: "recovered-guest-publisher",
        sessionDescription: { type: "offer", sdp },
        tracks: [{ trackName: "microphone", mid: mids[0] }, { trackName: "camera", mid: mids[1] }],
      });
      const ready = () => api.request(`/api/meetings/${meeting.id}/media/publish/ready`, "POST", participant.cookie, {
        connectionId: "recovered-guest-publisher",
        trackNames: ["microphone", "camera"],
      });

      expect((await publish("guest-initial", ["0", "1"])).status).toBe(200);
      expect((await ready()).status).toBe(200);
      expect((await api.request(`/api/meetings/${meeting.id}`, "GET", participant.cookie)).status).toBe(200);
      expect((await api.request(`/api/meetings/${meeting.id}/media/recover`, "POST", participant.cookie, {
        connectionId: "recovered-guest-publisher",
        direction: "publisher",
        reason: "connection-failed",
      })).status).toBe(200);

      expect((await publish("guest-recovered", ["2", "3"])).status).toBe(200);
      const recoveredReady = await (await ready()).json();
      expect(recoveredReady.data.publisherDiagnostics).toMatchObject({
        participantId,
        userIdSuffix: participant.userId.slice(-6),
        publisherSessionPresent: true,
        publishedTracks: expect.arrayContaining([
          { trackName: "microphone", mid: "2" },
          { trackName: "camera", mid: "3" },
        ]),
      });
      await api.request(`/api/meetings/${meeting.id}`, "GET", participant.cookie);
      const hostSubscribe = await (await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", host.cookie, {
        connectionId: "host-sees-recovered-guest",
      })).json();
      expect(hostSubscribe.data.tracks.map((track: { publisherUserId: string; trackName: string }) => [track.publisherUserId, track.trackName]))
        .toEqual(expect.arrayContaining([[participant.userId, "microphone"], [participant.userId, "camera"]]));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("removes and republishes a participant microphone across OFF/ON without duplicate subscriptions", async () => {
    const { api, host, participant, meeting } = await createJoinedChatRoom();
    const sfu = createSfuFetchMock();
    vi.stubGlobal("fetch", sfu.fetcher);
    try {
      const publish = (mid: string, sdp: string) => api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", participant.cookie, {
        connectionId: "participant-mic-off-on",
        sessionDescription: { type: "offer", sdp },
        tracks: [{ trackName: "microphone", mid }],
      });
      const ready = () => api.request(`/api/meetings/${meeting.id}/media/publish/ready`, "POST", participant.cookie, {
        connectionId: "participant-mic-off-on",
        trackNames: ["microphone"],
      });

      expect((await publish("0", "mic-on-first-offer")).status).toBe(200);
      expect((await ready()).status).toBe(200);
      const firstSubscribe = await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", host.cookie, { connectionId: "host-mic-off-on-subscriber" });
      const firstPayload = await firstSubscribe.json();
      expect(firstPayload.data.tracks).toEqual([
        expect.objectContaining({ publisherUserId: participant.userId, trackName: "microphone" }),
      ]);
      expect((await api.request(`/api/meetings/${meeting.id}/media/renegotiate`, "POST", host.cookie, {
        connectionId: "host-mic-off-on-subscriber",
        operationId: firstPayload.data.operationId,
        sessionDescription: { type: "answer", sdp: "host-mic-first-answer" },
      })).status).toBe(200);

      const repeatedSubscribe = await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", host.cookie, { connectionId: "host-mic-off-on-subscriber" });
      expect((await repeatedSubscribe.json()).data.tracks).toEqual([]);
      expect(sfu.calls.filter((call) => call.url.endsWith("/tracks/new") && call.body.tracks?.[0]?.location === "remote")).toHaveLength(1);

      const closed = await api.request(`/api/meetings/${meeting.id}/media/tracks/close`, "POST", participant.cookie, {
        connectionId: "participant-mic-off-on",
        trackNames: ["microphone"],
      });
      expect((await closed.json()).data.closed).toEqual(["microphone"]);
      const offSubscribe = await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", host.cookie, { connectionId: "host-mic-off-on-subscriber" });
      expect((await offSubscribe.json()).data.tracks).toEqual([]);
      const offPayload = await (await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", host.cookie, { connectionId: "host-mic-off-on-subscriber" })).json();
      expect(offPayload.data.removed).toEqual([expect.objectContaining({ trackName: "microphone" })]);
      expect((await api.request(`/api/meetings/${meeting.id}/media/renegotiate`, "POST", host.cookie, {
        connectionId: "host-mic-off-on-subscriber",
        operationId: offPayload.data.operationId,
        sessionDescription: { type: "answer", sdp: "host-mic-removal-answer" },
      })).status).toBe(200);

      expect((await publish("1", "mic-on-fresh-offer")).status).toBe(200);
      expect((await ready()).status).toBe(200);
      const onSubscribe = await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", host.cookie, { connectionId: "host-mic-off-on-subscriber" });
      const onPayload = await onSubscribe.json();
      expect(onPayload.data.tracks).toEqual([
        expect.objectContaining({ publisherUserId: participant.userId, trackName: "microphone" }),
      ]);
      expect(sfu.calls.filter((call) => call.url.endsWith("/tracks/new") && call.body.tracks?.[0]?.location === "remote")).toHaveLength(2);
      expect(sfu.calls.filter((call) => call.url.endsWith("/tracks/close")).length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("negotiates screen-share start/stop/restart on one subscriber session without forced closes or touching mic/camera", async () => {
    const { api, host, participant, meeting } = await createJoinedChatRoom();
    const sfu = createSfuFetchMock();
    vi.stubGlobal("fetch", sfu.fetcher);
    try {
      const connectionId = "participant-share-publisher";
      const hostConnection = "host-share-subscriber";
      const publish = async (trackName: string, mid: string) => {
        expect((await api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", participant.cookie, {
          connectionId,
          sessionDescription: { type: "offer", sdp: `offer-${trackName}-${mid}` },
          tracks: [{ trackName, mid }],
        })).status).toBe(200);
        expect((await api.request(`/api/meetings/${meeting.id}/media/publish/ready`, "POST", participant.cookie, { connectionId, trackNames: [trackName] })).status).toBe(200);
      };
      const subscribe = async () => (await (await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", host.cookie, { connectionId: hostConnection })).json()).data;
      const answer = async (operationId: string) => expect((await api.request(`/api/meetings/${meeting.id}/media/renegotiate`, "POST", host.cookie, {
        connectionId: hostConnection,
        operationId,
        sessionDescription: { type: "answer", sdp: "host-answer" },
      })).status).toBe(200);
      const stopShare = async () => {
        const closed = await api.request(`/api/meetings/${meeting.id}/media/tracks/close`, "POST", participant.cookie, {
          connectionId,
          trackNames: ["screen-video"],
          sessionDescription: { type: "offer", sdp: "participant-close-offer" },
        });
        expect(closed.status).toBe(200);
        expect((await closed.json()).data.sessionDescription).toEqual({ type: "answer", sdp: "sfu-close-answer" });
      };

      await publish("microphone", "0");
      await publish("camera", "1");
      const initial = await subscribe();
      expect(initial.tracks.map((track: { trackName: string }) => track.trackName)).toEqual(["microphone", "camera"]);
      await answer(initial.operationId);

      for (const mid of ["2", "3"]) {
        await publish("screen-video", mid);
        const started = await subscribe();
        expect(started.tracks.map((track: { trackName: string }) => track.trackName)).toEqual(["screen-video"]);
        expect(started.removed ?? []).toEqual([]);
        await answer(started.operationId);

        await stopShare();
        const stopped = await subscribe();
        expect(stopped.tracks).toEqual([]);
        expect(stopped.removed.map((track: { trackName: string }) => track.trackName)).toEqual(["screen-video"]);
        expect(stopped.sessionDescription.type).toBe("offer");
        await answer(stopped.operationId);
        expect((await subscribe()).operationId).toBeNull();
      }

      const closeCalls = sfu.calls.filter((call) => call.url.endsWith("/tracks/close"));
      expect(closeCalls).toHaveLength(4);
      expect(closeCalls.every((call) => call.body.force === false)).toBe(true);
      expect(closeCalls.filter((call) => call.body.sessionDescription).map((call) => call.body.tracks)).toEqual([[{ mid: "2" }], [{ mid: "3" }]]);
      expect(sfu.calls.filter((call) => call.url.endsWith("/sessions/new"))).toHaveLength(2);
      const state = await (await api.request(`/api/meetings/${meeting.id}/media/subscribe`, "POST", host.cookie, { connectionId: hostConnection })).json();
      expect(state.data.operationId).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("replaces prior publisher transport on rejoin without duplicating meeting membership", async () => {
    const { api, host, meeting } = await createJoinedChatRoom();
    const sfu = createSfuFetchMock();
    vi.stubGlobal("fetch", sfu.fetcher);
    try {
      const publish = (connectionId: string) => api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", host.cookie, {
        connectionId,
        sessionDescription: { type: "offer", sdp: `offer-${connectionId}` },
        tracks: [{ trackName: "camera", mid: "0" }],
      });
      expect((await publish("publisher-tab-a-connection")).status).toBe(200);
      expect((await publish("publisher-tab-b-connection")).status).toBe(200);

      const close = sfu.calls.find((call) => call.url.endsWith("/tracks/close"));
      expect(close?.url).toContain("/sessions/sfu-session-1-secretish/tracks/close");
      expect(close?.body).toMatchObject({ force: true, tracks: [{ mid: "0" }] });
      const savedMeeting = await api.request(`/api/meetings/${meeting.id}`);
      const savedPayload = await savedMeeting.json();
      expect(savedPayload.data.participants.filter((entry: { userId: string }) => entry.userId === host.userId)).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("closes the removed participant's published SFU track", async () => {
    const { api, host, participant, meeting } = await createJoinedChatRoom();
    const sfu = createSfuFetchMock();
    vi.stubGlobal("fetch", sfu.fetcher);
    try {
      const publish = await api.request(`/api/meetings/${meeting.id}/media/publish`, "POST", participant.cookie, {
        connectionId: "removed-participant-connection",
        sessionDescription: { type: "offer", sdp: "guest-offer" },
        tracks: [{ trackName: "microphone", mid: "4" }],
      });
      expect(publish.status).toBe(200);
      const removed = await api.request(`/api/meetings/${meeting.id}/remove`, "POST", host.cookie, {
        actorUserId: host.userId,
        targetUserId: participant.userId,
      });
      expect(removed.status).toBe(200);
      expect(sfu.calls.some((call) => call.url.endsWith("/sessions/sfu-session-1-secretish/tracks/close") && call.body.tracks[0].mid === "4")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not discover publications across separate BillionTalks meetings", async () => {
    const api = createChatApiFixture();
    const host = await api.createSession();
    const visitor = await api.createSession();
    const roomA = await api.createOpenMeeting(host.cookie, "SFU room A");
    const roomB = await api.createOpenMeeting(host.cookie, "SFU room B");
    await api.request(`/api/meetings/${roomB.id}/join`, "POST", visitor.cookie, { displayName: "Visitor" });
    const sfu = createSfuFetchMock();
    vi.stubGlobal("fetch", sfu.fetcher);
    try {
      await api.request(`/api/meetings/${roomA.id}/media/publish`, "POST", host.cookie, {
        connectionId: "room-a-publisher",
        sessionDescription: { type: "offer", sdp: "room-a-offer" },
        tracks: [{ trackName: "camera", mid: "0" }],
      });
      const ready = await api.request(`/api/meetings/${roomA.id}/media/publish/ready`, "POST", host.cookie, {
        connectionId: "room-a-publisher",
        trackNames: ["camera"],
      });
      expect(ready.status).toBe(200);
      const response = await api.request(`/api/meetings/${roomB.id}/media/subscribe`, "POST", visitor.cookie, { connectionId: "room-b-subscriber" });
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.data.tracks).toEqual([]);
      expect(sfu.calls.filter((call) => call.url.endsWith("/tracks/new") && call.body.tracks?.[0]?.location === "remote")).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("creates a meeting with a generated BT meeting ID and host participant", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());

    const meeting = await service.createMeeting({ title: "Sprint review", hostUserId: "user-1" });

    expect(meeting.id).toMatch(/^btm_[a-z0-9]+$/);
    expect(meeting.status).toBe(MeetingStatus.ACTIVE);
    expect(meeting.hostId).toBe("user-1");
    expect(meeting.participants).toHaveLength(1);
    expect(meeting.participants[0].role).toBe(ParticipantRole.HOST);
    expect(meeting.participants[0].state).toBe(ParticipantState.JOINED);
  });

  it("allows host-only end meeting and removes participant state on leave", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Standup", hostUserId: "host", accessMode: "OPEN" });

    const participant = await service.joinMeeting(meeting.id, {
      userId: "guest-1",
      displayName: "Guest",
    });

    expect(meeting.participants).toHaveLength(2);
    expect(participant.role).toBe(ParticipantRole.PARTICIPANT);

    await service.leaveMeeting(meeting.id, "guest-1");
    const refreshed = await service.getMeeting(meeting.id);
    expect(refreshed?.participants.find((p) => p.userId === "guest-1")?.state).toBe(ParticipantState.LEFT);

    await service.endMeeting(meeting.id, "host");
    const ended = await service.getMeeting(meeting.id);
    expect(ended?.status).toBe(MeetingStatus.ENDED);
  });

  it("enforces basic host and participant permissions", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Design review", hostUserId: "host", accessMode: "OPEN" });

    await service.joinMeeting(meeting.id, { userId: "p1", displayName: "Participant 1" });

    expect(MeetingPermissions.canEndMeeting(meeting, "host")).toBe(true);
    expect(MeetingPermissions.canEndMeeting(meeting, "p1")).toBe(false);
    expect(MeetingPermissions.canKickParticipant(meeting, "host", "p1")).toBe(true);
    expect(MeetingPermissions.canKickParticipant(meeting, "p1", "host")).toBe(false);
  });

  it("keeps participant-media mapping separate from the Meeting entity", async () => {
    const mediaProvider = new StubMediaProvider();
    const service = new MeetingService(new InMemoryMeetingRepository(), mediaProvider);

    const meeting = await service.createMeeting({ title: "Demo", hostUserId: "host", accessMode: "OPEN" });
    const participant = await service.joinMeeting(meeting.id, { userId: "guest", displayName: "Guest" });

    const connection = await service.getParticipantMediaConnection(meeting.id, participant.id);

    expect(connection).toBeTruthy();
    expect(connection?.meetingId).toBe(meeting.id);
    expect(connection?.participantId).toBe(participant.id);
    expect(connection?.providerSessionId).toContain("media-");
    expect("mediaProviderSessionId" in meeting).toBe(false);
  });

  it("keeps participant lifecycle deterministic across leave, rejoin, and host end", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Lifecycle validation", hostUserId: "host", accessMode: "OPEN" });

    const participant = await service.joinMeeting(meeting.id, { userId: "guest", displayName: "Guest" });
    const leftParticipant = await service.leaveMeeting(meeting.id, "guest");

    expect(leftParticipant?.state).toBe(ParticipantState.LEFT);
    expect((await service.getMeeting(meeting.id))?.status).toBe(MeetingStatus.ACTIVE);

    const rejoin = await service.joinMeeting(meeting.id, { userId: "guest", displayName: "Guest Again" });
    expect(rejoin.id).toBe(participant.id);
    expect((await service.listParticipants(meeting.id)).filter((entry) => entry.userId === "guest")).toHaveLength(1);

    const hostLeave = await service.leaveMeeting(meeting.id, "host");
    expect(hostLeave?.state).toBe(ParticipantState.LEFT);
    expect((await service.getMeeting(meeting.id))?.status).toBe(MeetingStatus.ACTIVE);

    await service.endMeeting(meeting.id, "host");
    expect((await service.getMeeting(meeting.id))?.status).toBe(MeetingStatus.ENDED);

    await expect(
      service.joinMeeting(meeting.id, { userId: "guest-2", displayName: "Late guest" }),
    ).rejects.toThrow("not active");
  });

  it("rejects joins after end and keeps join state deterministic", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Closed meeting", hostUserId: "host", accessMode: "OPEN" });

    const firstJoin = await service.joinMeeting(meeting.id, { userId: "guest", displayName: "Guest" });
    const secondJoin = await service.joinMeeting(meeting.id, { userId: "guest", displayName: "Guest Updated" });

    expect(firstJoin.id).toBe(secondJoin.id);
    expect(await service.listParticipants(meeting.id)).toHaveLength(2);

    await service.endMeeting(meeting.id, "host");

    await expect(
      service.joinMeeting(meeting.id, { userId: "guest-2", displayName: "New guest" }),
    ).rejects.toThrow("not active");
  });

  it("defaults new meetings to host approval and leaves waiting participants out of active participants", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Access review", hostUserId: "host" });

    expect(meeting.accessMode).toBe("HOST_APPROVAL");

    const waiting = await service.requestAdmission(meeting.id, {
      userId: "guest-1",
      displayName: "Guest One",
    });

    expect(waiting.status).toBe("WAITING");
    expect((await service.listParticipants(meeting.id)).some((participant) => participant.userId === "guest-1")).toBe(false);
    expect(await service.listPendingAdmissions(meeting.id, "host")).toHaveLength(1);
  });

  it("lets the meeting creator join as host immediately and keeps guests waiting for approval", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Approval review", hostUserId: "host-creator" });

    expect(meeting.accessMode).toBe("HOST_APPROVAL");
    expect(meeting.hostId).toBe("host-creator");
    expect(meeting.participants.find((participant) => participant.userId === "host-creator")?.role).toBe(
      ParticipantRole.HOST,
    );
    expect(meeting.participants.find((participant) => participant.userId === "host-creator")?.state).toBe(
      ParticipantState.JOINED,
    );

    await expect(
      service.joinMeeting(meeting.id, { userId: "host-creator", displayName: "Host Creator" }),
    ).resolves.toMatchObject({
      userId: "host-creator",
      role: ParticipantRole.HOST,
      state: ParticipantState.JOINED,
    });

    await expect(
      service.joinMeeting(meeting.id, { userId: "guest-1", displayName: "Guest One" }),
    ).rejects.toThrow("Admission request submitted and waiting for host approval.");

    const reloaded = await service.getMeeting(meeting.id);
    expect(reloaded?.participants.some((participant) => participant.userId === "guest-1")).toBe(false);
    expect(reloaded?.accessRequests.some((request) => request.userId === "guest-1")).toBe(true);
    expect(reloaded?.accessRequests.find((request) => request.userId === "guest-1")?.status).toBe("WAITING");
    expect(await service.listPendingAdmissions(meeting.id, "host-creator")).toHaveLength(1);

    const waiting = (await service.listPendingAdmissions(meeting.id, "host-creator"))[0];
    const approved = await service.approveAdmission(meeting.id, "host-creator", waiting.id);
    expect(approved.status).toBe("APPROVED");
    expect((await service.listParticipants(meeting.id)).find((participant) => participant.userId === "guest-1")).toMatchObject({
      role: ParticipantRole.PARTICIPANT,
      state: ParticipantState.JOINED,
    });
    expect(await service.listPendingAdmissions(meeting.id, "host-creator")).toHaveLength(0);

    await expect(
      service.requestAdmission(meeting.id, { userId: "host-creator", displayName: "Host Creator" }),
    ).resolves.toMatchObject({ status: "APPROVED", userId: "host-creator" });
    const again = await service.getMeeting(meeting.id);
    expect(again?.accessRequests.some((request) => request.userId === "host-creator")).toBe(false);
  });

  it("allows the host to reject a waiting participant and keeps them out of the active room", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Reject review", hostUserId: "host" });

    const waiting = await service.requestAdmission(meeting.id, {
      userId: "guest-1",
      displayName: "Guest One",
    });

    const rejected = await service.rejectAdmission(meeting.id, "host", waiting.id);

    expect(rejected.status).toBe("REJECTED");
    expect((await service.listParticipants(meeting.id)).some((participant) => participant.userId === "guest-1")).toBe(false);
    expect(await service.listPendingAdmissions(meeting.id, "host")).toHaveLength(0);
  });

  it("enforces host-only actions and blocks spoofed host identity", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Security review", hostUserId: "host" });

    const waiting = await service.requestAdmission(meeting.id, {
      userId: "guest-1",
      displayName: "Guest One",
    });

    await expect(service.approveAdmission(meeting.id, "guest-1", waiting.id)).rejects.toThrow("Only the host");
    await expect(service.rejectAdmission(meeting.id, "guest-1", waiting.id)).rejects.toThrow("Only the host");
    await expect(service.changeAccessMode(meeting.id, "guest-1", "OPEN")).rejects.toThrow("Only the host");
    await expect(service.changeAccessMode(meeting.id, "host", "OPEN" as any)).resolves.toBeDefined();
  });

  it("rejects new admissions when the meeting is locked or ended", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Locked meeting", hostUserId: "host" });

    await service.changeAccessMode(meeting.id, "host", "LOCKED");
    await expect(
      service.requestAdmission(meeting.id, { userId: "guest-1", displayName: "Guest One" }),
    ).rejects.toThrow("locked");

    const ended = await service.endMeeting(meeting.id, "host");
    expect(ended.status).toBe(MeetingStatus.ENDED);

    await expect(
      service.requestAdmission(meeting.id, { userId: "guest-2", displayName: "Guest Two" }),
    ).rejects.toThrow("not active");
  });

  it("requires the durable meeting binding from the worker env instead of silently using memory", () => {
    expect(() => resolveMeetingRepository({})).toThrow("MEETING_STORE Durable Object binding is required");
  });

  it("preserves participant identity and prevents stale duplicates on refresh/rejoin", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Reconnect test", hostUserId: "host", accessMode: "OPEN" });

    const firstJoin = await service.joinMeeting(meeting.id, { userId: "guest-1", displayName: "Guest One" });
    await service.leaveMeeting(meeting.id, "guest-1");

    const rejoin = await service.joinMeeting(meeting.id, { userId: "guest-1", displayName: "Guest One Again" });

    expect(rejoin.id).toBe(firstJoin.id);
    expect(rejoin.state).toBe(ParticipantState.JOINED);
    expect((await service.listParticipants(meeting.id)).filter((participant) => participant.userId === "guest-1")).toHaveLength(1);
  });

  it("lets the host leave and rejoin without losing host authority or creating a duplicate host entry", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Host rejoin", hostUserId: "host-1", accessMode: "OPEN" });

    await service.leaveMeeting(meeting.id, "host-1");
    const rejoinedHost = await service.joinMeeting(meeting.id, { userId: "host-1", displayName: "Host One" });

    expect(rejoinedHost.role).toBe(ParticipantRole.HOST);
    expect(rejoinedHost.state).toBe(ParticipantState.JOINED);
    expect((await service.listParticipants(meeting.id)).filter((participant) => participant.userId === "host-1")).toHaveLength(1);
    expect((await service.getMeeting(meeting.id))?.hostId).toBe("host-1");
  });

  it("keeps previous approval semantics when a guest re-enters a host-approved meeting", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Approval reconnect", hostUserId: "host", accessMode: "HOST_APPROVAL" });

    const waiting = await service.requestAdmission(meeting.id, { userId: "guest-1", displayName: "Guest One" });
    await service.approveAdmission(meeting.id, "host", waiting.id);
    await service.leaveMeeting(meeting.id, "guest-1");

    const rejoin = await service.joinMeeting(meeting.id, { userId: "guest-1", displayName: "Guest One" });
    expect(rejoin.role).toBe(ParticipantRole.PARTICIPANT);
    expect(rejoin.state).toBe(ParticipantState.JOINED);
    expect((await service.getMeeting(meeting.id))?.accessRequests.find((request) => request.userId === "guest-1")?.status).toBe("APPROVED");
  });

  it("rejects reconnects for ended meetings and keeps host approval state stable", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Ended meeting", hostUserId: "host", accessMode: "HOST_APPROVAL" });

    const waiting = await service.requestAdmission(meeting.id, { userId: "guest-1", displayName: "Guest One" });
    await service.approveAdmission(meeting.id, "host", waiting.id);
    await service.endMeeting(meeting.id, "host");

    await expect(service.joinMeeting(meeting.id, { userId: "guest-1", displayName: "Guest One" })).rejects.toThrow("not active");
    await expect(service.requestAdmission(meeting.id, { userId: "guest-2", displayName: "Guest Two" })).rejects.toThrow("not active");
  });

  it("persists meeting state across service restarts without changing host approval behavior", async () => {
    const durableState = new Map<string, unknown>();
    const storage = {
      get: async (key: string) => durableState.get(key),
      put: async (key: string, value: unknown) => {
        durableState.set(key, value);
      },
      delete: async (key: string) => {
        durableState.delete(key);
      },
      list: async () => Array.from(durableState.entries()).map(([k, v]) => ({ name: k, value: v })),
      has: async (key: string) => durableState.has(key),
    };

    const firstService = new MeetingService(new DurableMeetingRepository(storage as any), new StubMediaProvider());
    const meeting = await firstService.createMeeting({ title: "Persistent state", hostUserId: "host", accessMode: "HOST_APPROVAL" });

    await firstService.requestAdmission(meeting.id, {
      userId: "guest-1",
      displayName: "Guest One",
    });

    const secondService = new MeetingService(new DurableMeetingRepository(storage as any), new StubMediaProvider());
    const reloaded = await secondService.getMeeting(meeting.id);

    expect(reloaded).toBeTruthy();
    expect(reloaded?.hostId).toBe("host");
    expect(reloaded?.accessMode).toBe("HOST_APPROVAL");
    expect(reloaded?.accessRequests).toHaveLength(1);
    expect(reloaded?.accessRequests[0].status).toBe("WAITING");

    const pending = await secondService.listPendingAdmissions(meeting.id, "host");
    expect(pending).toHaveLength(1);

    const approved = await secondService.approveAdmission(meeting.id, "host", pending[0].id);
    expect(approved.status).toBe("APPROVED");
    expect((await secondService.listParticipants(meeting.id)).find((participant) => participant.userId === "guest-1")?.state).toBe(
      ParticipantState.JOINED,
    );

    const ended = await secondService.endMeeting(meeting.id, "host");
    expect(ended.status).toBe(MeetingStatus.ENDED);

    const restartedAgain = new MeetingService(new DurableMeetingRepository(storage as any), new StubMediaProvider());
    expect((await restartedAgain.getMeeting(meeting.id))?.status).toBe(MeetingStatus.ENDED);
  });
});
