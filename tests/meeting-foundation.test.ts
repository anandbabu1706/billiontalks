import { describe, expect, it } from "vitest";

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
  return {
    idFromName: (name: string) => name,
    get: (id: string) => {
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
      return new MeetingStateDurableObject({ storage } as any, {});
    },
  };
}

function createChatApiFixture(namespace = createDurableObjectNamespace()) {
  const env = { MEETING_STORE: namespace as any };
  const request = (path: string, method = "GET", cookie?: string, body?: unknown) => {
    const headers = new Headers();
    if (cookie) headers.set("Cookie", cookie);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    return app.fetch(new Request(`http://localhost${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
  };

  return {
    request,
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
  };
}

async function createJoinedChatRoom() {
  const api = createChatApiFixture();
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
    const stopped = await api.request(`/api/meetings/${meeting.id}/recording/stop`, "POST", host.cookie);
    const stoppedPayload = await stopped.json();
    const stored = backingStorage.get(meeting.id)?.get("recordings") as Array<Record<string, unknown>>;

    expect(stopped.status).toBe(200);
    expect(stoppedPayload.data).toMatchObject({
      recordingId: startedPayload.data.recordingId,
      meetingId: meeting.id,
      initiatedByUserId: host.userId,
      status: "STOPPED",
    });
    expect(stoppedPayload.data.stoppedAt).toBeTruthy();
    expect(stored[1]).toMatchObject({ recordingId: startedPayload.data.recordingId, status: "STOPPED" });
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
