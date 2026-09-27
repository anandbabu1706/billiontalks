import { describe, expect, it } from "vitest";

import {
  type MediaProvider,
  MeetingPermissions,
  MeetingService,
  MeetingStatus,
  InMemoryMeetingRepository,
  ParticipantRole,
  ParticipantState,
} from "../src/meeting";

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

describe("MeetingService lifecycle", () => {
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
    expect(service.getMeeting(meeting.id)?.participants.find((p) => p.userId === "guest-1")?.state).toBe(
      ParticipantState.LEFT,
    );

    service.endMeeting(meeting.id, "host");
    expect(service.getMeeting(meeting.id)?.status).toBe(MeetingStatus.ENDED);
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

    const connection = service.getParticipantMediaConnection(meeting.id, participant.id);

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
    expect(service.getMeeting(meeting.id)?.status).toBe(MeetingStatus.ACTIVE);

    const rejoin = await service.joinMeeting(meeting.id, { userId: "guest", displayName: "Guest Again" });
    expect(rejoin.id).toBe(participant.id);
    expect(service.listParticipants(meeting.id).filter((entry) => entry.userId === "guest")).toHaveLength(1);

    const hostLeave = await service.leaveMeeting(meeting.id, "host");
    expect(hostLeave?.state).toBe(ParticipantState.LEFT);
    expect(service.getMeeting(meeting.id)?.status).toBe(MeetingStatus.ACTIVE);

    service.endMeeting(meeting.id, "host");
    expect(service.getMeeting(meeting.id)?.status).toBe(MeetingStatus.ENDED);

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
    expect(service.listParticipants(meeting.id)).toHaveLength(2);

    service.endMeeting(meeting.id, "host");

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
    expect(service.listParticipants(meeting.id).some((participant) => participant.userId === "guest-1")).toBe(false);
    expect(service.listPendingAdmissions(meeting.id, "host")).toHaveLength(1);
  });

  it("allows the host to approve a waiting participant and makes them active", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Approval review", hostUserId: "host" });

    const waiting = await service.requestAdmission(meeting.id, {
      userId: "guest-1",
      displayName: "Guest One",
    });

    const approved = await service.approveAdmission(meeting.id, "host", waiting.id);

    expect(approved.status).toBe("APPROVED");
    expect(service.listParticipants(meeting.id).some((participant) => participant.userId === "guest-1")).toBe(true);
    expect(
      service.listParticipants(meeting.id).find((participant) => participant.userId === "guest-1")?.state,
    ).toBe(ParticipantState.JOINED);
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
    expect(service.listParticipants(meeting.id).some((participant) => participant.userId === "guest-1")).toBe(false);
    expect(service.listPendingAdmissions(meeting.id, "host")).toHaveLength(0);
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

    const ended = service.endMeeting(meeting.id, "host");
    expect(ended.status).toBe(MeetingStatus.ENDED);

    await expect(
      service.requestAdmission(meeting.id, { userId: "guest-2", displayName: "Guest Two" }),
    ).rejects.toThrow("not active");
  });
});
