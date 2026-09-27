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
import app, { resolveMeetingRepository } from "../src/index";

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
  it("creates a server-issued session and keeps the same identity across repeated requests", async () => {
    const sessionResponse = await app.fetch(new Request("http://localhost/api/session", { method: "POST" }), {
      MEETING_STORE: new InMemoryMeetingRepository() as any,
    });
    const payload = await sessionResponse.json();
    const cookieValue = getCookieValue(sessionResponse.headers.get("Set-Cookie"), "bt_session_v0");

    expect(payload.ok).toBe(true);
    expect(cookieValue).toBeTruthy();
    expect(payload.data.userId).toMatch(/^session_/);

    const repeatResponse = await app.fetch(new Request("http://localhost/api/session", {
      method: "POST",
      headers: { Cookie: `bt_session_v0=${cookieValue}` },
    }), {
      MEETING_STORE: new InMemoryMeetingRepository() as any,
    });
    const repeatPayload = await repeatResponse.json();

    expect(repeatPayload.ok).toBe(true);
    expect(repeatPayload.data.userId).toBe(payload.data.userId);
  });

  it("rejects host and participant spoofing when a session-backed identity is present", async () => {
    const repository = new InMemoryMeetingRepository();

    const hostSessionResponse = await app.fetch(new Request("http://localhost/api/session", { method: "POST" }), {
      MEETING_STORE: repository as any,
    });
    const hostCookie = getCookieValue(hostSessionResponse.headers.get("Set-Cookie"), "bt_session_v0");
    const hostSession = await hostSessionResponse.json();

    const createMeetingResponse = await app.fetch(new Request("http://localhost/api/meetings", {
      method: "POST",
      headers: { Cookie: `bt_session_v0=${hostCookie}` },
      body: JSON.stringify({ title: "Secure room", accessMode: "OPEN" }),
    }), {
      MEETING_STORE: repository as any,
    });
    const createdMeeting = await createMeetingResponse.json();

    expect(createMeetingResponse.status).toBe(201);
    expect(createdMeeting.data.hostId).toBe(hostSession.data.userId);

    const guestSessionResponse = await app.fetch(new Request("http://localhost/api/session", { method: "POST" }), {
      MEETING_STORE: repository as any,
    });
    const guestCookie = getCookieValue(guestSessionResponse.headers.get("Set-Cookie"), "bt_session_v0");
    const guestUser = (await guestSessionResponse.json()).data.userId;

    const spoofedAccessResponse = await app.fetch(new Request(`http://localhost/api/meetings/${createdMeeting.data.id}/access-mode`, {
      method: "POST",
      headers: { Cookie: `bt_session_v0=${guestCookie}` },
      body: JSON.stringify({ actorUserId: "spoofed-host", accessMode: "OPEN" }),
    }), {
      MEETING_STORE: repository as any,
    });

    expect(spoofedAccessResponse.status).toBe(403);

    const joinResponse = await app.fetch(new Request(`http://localhost/api/meetings/${createdMeeting.data.id}/join`, {
      method: "POST",
      headers: { Cookie: `bt_session_v0=${guestCookie}` },
      body: JSON.stringify({ userId: hostSession.data.userId, displayName: "Host impersonator" }),
    }), {
      MEETING_STORE: repository as any,
    });
    const joinPayload = await joinResponse.json();

    expect(joinResponse.status).toBe(200);
    expect(joinPayload.data.userId).toBe(guestUser);
    expect(joinPayload.data.displayName).toBe("Host impersonator");
    expect(joinPayload.data.userId).not.toBe(hostSession.data.userId);
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
