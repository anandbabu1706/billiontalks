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
    const meeting = await service.createMeeting({ title: "Standup", hostUserId: "host" });

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
    const meeting = await service.createMeeting({ title: "Design review", hostUserId: "host" });

    await service.joinMeeting(meeting.id, { userId: "p1", displayName: "Participant 1" });

    expect(MeetingPermissions.canEndMeeting(meeting, "host")).toBe(true);
    expect(MeetingPermissions.canEndMeeting(meeting, "p1")).toBe(false);
    expect(MeetingPermissions.canKickParticipant(meeting, "host", "p1")).toBe(true);
    expect(MeetingPermissions.canKickParticipant(meeting, "p1", "host")).toBe(false);
  });

  it("keeps participant-media mapping separate from the Meeting entity", async () => {
    const mediaProvider = new StubMediaProvider();
    const service = new MeetingService(new InMemoryMeetingRepository(), mediaProvider);

    const meeting = await service.createMeeting({ title: "Demo", hostUserId: "host" });
    const participant = await service.joinMeeting(meeting.id, { userId: "guest", displayName: "Guest" });

    const connection = service.getParticipantMediaConnection(meeting.id, participant.id);

    expect(connection).toBeTruthy();
    expect(connection?.meetingId).toBe(meeting.id);
    expect(connection?.participantId).toBe(participant.id);
    expect(connection?.providerSessionId).toContain("media-");
    expect("mediaProviderSessionId" in meeting).toBe(false);
  });

  it("rejects joins after end and keeps join state deterministic", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new StubMediaProvider());
    const meeting = await service.createMeeting({ title: "Closed meeting", hostUserId: "host" });

    const firstJoin = await service.joinMeeting(meeting.id, { userId: "guest", displayName: "Guest" });
    const secondJoin = await service.joinMeeting(meeting.id, { userId: "guest", displayName: "Guest Updated" });

    expect(firstJoin.id).toBe(secondJoin.id);
    expect(service.listParticipants(meeting.id)).toHaveLength(2);

    service.endMeeting(meeting.id, "host");

    await expect(
      service.joinMeeting(meeting.id, { userId: "guest-2", displayName: "New guest" }),
    ).rejects.toThrow("not active");
  });
});
