import { CloudflareRealtimeConnectionClient } from "./realtime";

export enum MeetingStatus {
  ACTIVE = "active",
  ENDED = "ended",
  CANCELLED = "cancelled",
}

export enum ParticipantRole {
  HOST = "HOST",
  PARTICIPANT = "PARTICIPANT",
}

export enum ParticipantState {
  PENDING = "PENDING",
  JOINED = "JOINED",
  LEFT = "LEFT",
}

export type MeetingParticipant = {
  id: string;
  meetingId: string;
  userId: string;
  displayName: string;
  role: ParticipantRole;
  state: ParticipantState;
  joinedAt: string;
  leftAt?: string;
};

export type Meeting = {
  id: string;
  title: string;
  status: MeetingStatus;
  createdAt: string;
  hostId: string;
  participants: MeetingParticipant[];
};

export type MeetingMediaConnection = {
  id: string;
  meetingId: string;
  participantId: string;
  provider: "cloudflare" | "none";
  providerSessionId: string;
  createdAt: string;
};

export type MediaProviderResult = {
  mediaConnectionId: string;
  provider: "cloudflare" | "none";
  providerSessionId: string;
};

export interface MediaProvider {
  createParticipantMediaConnection(
    meetingId: string,
    participantId: string,
  ): Promise<MediaProviderResult>;
  deleteParticipantMediaConnection(meetingId: string, participantId: string): Promise<void>;
}

export class NullMediaProvider implements MediaProvider {
  async createParticipantMediaConnection(
    meetingId: string,
    participantId: string,
  ): Promise<MediaProviderResult> {
    return {
      mediaConnectionId: `virtual-${meetingId}-${participantId}`,
      provider: "none",
      providerSessionId: `virtual-${meetingId}-${participantId}`,
    };
  }

  async deleteParticipantMediaConnection(): Promise<void> {
    // No-op for the V0 in-memory environment.
  }
}

export class CloudflareMediaProvider implements MediaProvider {
  constructor(
    private readonly appId: string,
    private readonly bearerToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async createParticipantMediaConnection(
    meetingId: string,
    participantId: string,
  ): Promise<MediaProviderResult> {
    const client = new CloudflareRealtimeConnectionClient(
      this.appId,
      this.bearerToken,
      this.fetcher,
    );

    const result = await client.createSession();

    return {
      mediaConnectionId: result.sessionId,
      provider: "cloudflare",
      providerSessionId: result.sessionId,
    };
  }

  async deleteParticipantMediaConnection(
    _meetingId: string,
    _participantId: string,
  ): Promise<void> {
    // The initial V0 foundation keeps participant/media mapping in memory and does not
    // treat the Cloudflare SFU session as the authoritative Meeting identity.
  }
}

function generateMeetingId(): string {
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return `btm_${uuid.slice(0, 16)}`;
}

function generateParticipantId(meetingId: string, userId: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return `participant_${meetingId}_${userId}_${uuid.slice(0, 12)}`;
}

function normalizeRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

export class InMemoryMeetingRepository {
  private readonly meetings = new Map<string, Meeting>();
  private readonly participantMediaConnections = new Map<string, MeetingMediaConnection>();

  saveMeeting(meeting: Meeting): void {
    this.meetings.set(meeting.id, meeting);
  }

  getMeeting(meetingId: string): Meeting | undefined {
    return this.meetings.get(meetingId);
  }

  setMediaConnection(connection: MeetingMediaConnection): void {
    const key = `${connection.meetingId}:${connection.participantId}`;
    this.participantMediaConnections.set(key, connection);
  }

  getMediaConnection(meetingId: string, participantId: string): MeetingMediaConnection | undefined {
    const key = `${meetingId}:${participantId}`;
    return this.participantMediaConnections.get(key);
  }

  deleteMediaConnection(meetingId: string, participantId: string): void {
    const key = `${meetingId}:${participantId}`;
    this.participantMediaConnections.delete(key);
  }
}

export class MeetingPermissions {
  static canEndMeeting(meeting: Meeting, actorUserId: string): boolean {
    return meeting.status === MeetingStatus.ACTIVE && meeting.hostId === actorUserId;
  }

  static canKickParticipant(
    meeting: Meeting,
    actorUserId: string,
    targetUserId: string,
  ): boolean {
    if (actorUserId === targetUserId) {
      return false;
    }

    return meeting.hostId === actorUserId &&
      meeting.participants.some((participant) => participant.userId === targetUserId);
  }
}

export type CreateMeetingInput = {
  title: string;
  hostUserId: string;
};

export type JoinMeetingInput = {
  userId: string;
  displayName: string;
};

export class MeetingService {
  constructor(
    private readonly repository: InMemoryMeetingRepository,
    private readonly mediaProvider: MediaProvider,
  ) {}

  async createMeeting(input: CreateMeetingInput): Promise<Meeting> {
    const title = normalizeRequiredString(input.title, "Meeting title");
    const hostUserId = normalizeRequiredString(input.hostUserId, "Host userId");
    const meetingId = generateMeetingId();
    const hostParticipantId = generateParticipantId(meetingId, hostUserId);

    const hostParticipant: MeetingParticipant = {
      id: hostParticipantId,
      meetingId,
      userId: hostUserId,
      displayName: "Host",
      role: ParticipantRole.HOST,
      state: ParticipantState.JOINED,
      joinedAt: new Date().toISOString(),
    };

    const meeting: Meeting = {
      id: meetingId,
      title,
      status: MeetingStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      hostId: hostUserId,
      participants: [hostParticipant],
    };

    const result = await this.mediaProvider.createParticipantMediaConnection(
      meeting.id,
      hostParticipant.id,
    );

    this.repository.saveMeeting(meeting);
    this.repository.setMediaConnection({
      id: `${meeting.id}:${hostParticipant.id}`,
      meetingId: meeting.id,
      participantId: hostParticipant.id,
      provider: result.provider,
      providerSessionId: result.providerSessionId,
      createdAt: new Date().toISOString(),
    });

    return meeting;
  }

  getMeeting(meetingId: string): Meeting | undefined {
    return this.repository.getMeeting(meetingId);
  }

  async joinMeeting(meetingId: string, input: JoinMeetingInput): Promise<MeetingParticipant> {
    const meeting = this.getRequiredMeeting(meetingId);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new Error("Meeting is not active.");
    }

    const userId = normalizeRequiredString(input.userId, "Participant userId");
    const displayName = normalizeRequiredString(input.displayName, "Participant displayName");

    const existingParticipant = meeting.participants.find(
      (participant) => participant.userId === userId,
    );

    if (existingParticipant) {
      if (existingParticipant.state === ParticipantState.LEFT) {
        existingParticipant.state = ParticipantState.JOINED;
        existingParticipant.leftAt = undefined;
      }

      existingParticipant.displayName = displayName;
      this.repository.saveMeeting(meeting);
      return existingParticipant;
    }

    const participant: MeetingParticipant = {
      id: generateParticipantId(meetingId, userId),
      meetingId,
      userId,
      displayName,
      role: ParticipantRole.PARTICIPANT,
      state: ParticipantState.JOINED,
      joinedAt: new Date().toISOString(),
    };

    const result = await this.mediaProvider.createParticipantMediaConnection(
      meeting.id,
      participant.id,
    );

    meeting.participants.push(participant);
    this.repository.saveMeeting(meeting);
    this.repository.setMediaConnection({
      id: `${meeting.id}:${participant.id}`,
      meetingId: meeting.id,
      participantId: participant.id,
      provider: result.provider,
      providerSessionId: result.providerSessionId,
      createdAt: new Date().toISOString(),
    });

    return participant;
  }

  async leaveMeeting(meetingId: string, userId: string): Promise<MeetingParticipant | undefined> {
    const meeting = this.getRequiredMeeting(meetingId);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new Error("Meeting is not active.");
    }

    const normalizedUserId = normalizeRequiredString(userId, "Participant userId");
    const participant = meeting.participants.find((entry) => entry.userId === normalizedUserId);

    if (!participant) {
      return undefined;
    }

    if (participant.state === ParticipantState.LEFT) {
      return participant;
    }

    await this.mediaProvider.deleteParticipantMediaConnection(meeting.id, participant.id);

    participant.state = ParticipantState.LEFT;
    participant.leftAt = new Date().toISOString();
    this.repository.saveMeeting(meeting);
    this.repository.deleteMediaConnection(meeting.id, participant.id);

    return participant;
  }

  endMeeting(meetingId: string, actorUserId: string): Meeting {
    const meeting = this.getRequiredMeeting(meetingId);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new Error("Meeting is not active.");
    }

    if (!MeetingPermissions.canEndMeeting(meeting, actorUserId)) {
      throw new Error("Only the host may end the meeting.");
    }

    meeting.status = MeetingStatus.ENDED;
    meeting.participants.forEach((participant) => {
      if (participant.state === ParticipantState.JOINED) {
        participant.state = ParticipantState.LEFT;
        participant.leftAt = new Date().toISOString();
      }
    });

    this.repository.saveMeeting(meeting);
    return meeting;
  }

  getParticipantMediaConnection(meetingId: string, participantId: string): MeetingMediaConnection | undefined {
    return this.repository.getMediaConnection(meetingId, participantId);
  }

  listParticipants(meetingId: string): MeetingParticipant[] {
    const meeting = this.getRequiredMeeting(meetingId);
    return [...meeting.participants];
  }

  private getRequiredMeeting(meetingId: string): Meeting {
    const meeting = this.repository.getMeeting(meetingId);

    if (!meeting) {
      throw new Error(`Meeting not found: ${meetingId}`);
    }

    return meeting;
  }
}
