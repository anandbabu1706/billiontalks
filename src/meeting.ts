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
  WAITING = "WAITING",
  JOINED = "JOINED",
  LEFT = "LEFT",
  REJECTED = "REJECTED",
}

export enum MeetingAccessMode {
  OPEN = "OPEN",
  HOST_APPROVAL = "HOST_APPROVAL",
  LOCKED = "LOCKED",
}

export enum MeetingAdmissionStatus {
  WAITING = "WAITING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
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

export type MeetingAdmissionRequest = {
  id: string;
  meetingId: string;
  userId: string;
  displayName: string;
  status: MeetingAdmissionStatus;
  requestedAt: string;
  resolvedAt?: string;
  reviewedByUserId?: string;
};

export type Meeting = {
  id: string;
  title: string;
  status: MeetingStatus;
  createdAt: string;
  hostId: string;
  accessMode: MeetingAccessMode;
  participants: MeetingParticipant[];
  accessRequests: MeetingAdmissionRequest[];
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

function normalizeMeetingAccessMode(value: string | undefined, label: string): MeetingAccessMode {
  const normalized = (value ?? "").trim().toUpperCase();

  if (normalized === MeetingAccessMode.OPEN || normalized === MeetingAccessMode.HOST_APPROVAL || normalized === MeetingAccessMode.LOCKED) {
    return normalized as MeetingAccessMode;
  }

  throw new Error(`${label} must be one of: OPEN, HOST_APPROVAL, LOCKED.`);
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
  static isHost(meeting: Meeting, actorUserId: string): boolean {
    return meeting.status === MeetingStatus.ACTIVE && meeting.hostId === actorUserId;
  }

  static canEndMeeting(meeting: Meeting, actorUserId: string): boolean {
    return this.isHost(meeting, actorUserId);
  }

  static canManageAdmission(meeting: Meeting, actorUserId: string): boolean {
    return this.isHost(meeting, actorUserId);
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
  accessMode?: MeetingAccessMode | string;
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
    const accessMode = normalizeMeetingAccessMode(
      typeof input.accessMode === "string" ? input.accessMode : MeetingAccessMode.HOST_APPROVAL,
      "Meeting access mode",
    );
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
      accessMode,
      participants: [hostParticipant],
      accessRequests: [],
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

  async requestAdmission(
    meetingId: string,
    input: JoinMeetingInput,
  ): Promise<MeetingAdmissionRequest> {
    const meeting = this.getRequiredMeeting(meetingId);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new Error("Meeting is not active.");
    }

    const userId = normalizeRequiredString(input.userId, "Participant userId");
    const displayName = normalizeRequiredString(input.displayName, "Participant displayName");

    if (meeting.accessMode === MeetingAccessMode.LOCKED) {
      throw new Error("Meeting admission is locked.");
    }

    if (meeting.accessMode === MeetingAccessMode.OPEN) {
      await this.joinMeeting(meetingId, { userId, displayName });
      return {
        id: `admission-${meetingId}-${userId}`,
        meetingId,
        userId,
        displayName,
        status: MeetingAdmissionStatus.APPROVED,
        requestedAt: new Date().toISOString(),
        resolvedAt: new Date().toISOString(),
        reviewedByUserId: meeting.hostId,
      };
    }

    const existingRequest = meeting.accessRequests.find((request) => request.userId === userId);
    if (existingRequest) {
      if (existingRequest.status === MeetingAdmissionStatus.WAITING) {
        return existingRequest;
      }

      if (existingRequest.status === MeetingAdmissionStatus.REJECTED) {
        throw new Error("Your meeting admission request was rejected.");
      }

      if (existingRequest.status === MeetingAdmissionStatus.APPROVED) {
        return existingRequest;
      }
    }

    const request: MeetingAdmissionRequest = {
      id: `admission-${meetingId}-${userId}-${crypto.randomUUID().slice(0, 8)}`,
      meetingId,
      userId,
      displayName,
      status: MeetingAdmissionStatus.WAITING,
      requestedAt: new Date().toISOString(),
    };

    meeting.accessRequests.push(request);
    this.repository.saveMeeting(meeting);
    return request;
  }

  listPendingAdmissions(meetingId: string, actorUserId: string): MeetingAdmissionRequest[] {
    const meeting = this.getRequiredMeeting(meetingId);

    if (!MeetingPermissions.canManageAdmission(meeting, actorUserId)) {
      throw new Error("Only the host may view pending admissions.");
    }

    return meeting.accessRequests.filter((request) => request.status === MeetingAdmissionStatus.WAITING);
  }

  async approveAdmission(
    meetingId: string,
    actorUserId: string,
    requestId: string,
  ): Promise<MeetingAdmissionRequest> {
    const meeting = this.getRequiredMeeting(meetingId);

    if (!MeetingPermissions.canManageAdmission(meeting, actorUserId)) {
      throw new Error("Only the host may approve an admission request.");
    }

    const request = meeting.accessRequests.find((entry) => entry.id === requestId);
    if (!request) {
      throw new Error("Admission request not found.");
    }

    if (request.userId === actorUserId) {
      throw new Error("A participant cannot approve their own admission.");
    }

    if (request.status !== MeetingAdmissionStatus.WAITING) {
      throw new Error("Admission request is no longer pending.");
    }

    const existingParticipant = meeting.participants.find((participant) => participant.userId === request.userId);
    if (existingParticipant) {
      existingParticipant.state = ParticipantState.JOINED;
      existingParticipant.displayName = request.displayName;
      existingParticipant.leftAt = undefined;
    } else {
      const participant: MeetingParticipant = {
        id: generateParticipantId(meetingId, request.userId),
        meetingId,
        userId: request.userId,
        displayName: request.displayName,
        role: ParticipantRole.PARTICIPANT,
        state: ParticipantState.JOINED,
        joinedAt: new Date().toISOString(),
      };

      meeting.participants.push(participant);
    }

    request.status = MeetingAdmissionStatus.APPROVED;
    request.resolvedAt = new Date().toISOString();
    request.reviewedByUserId = actorUserId;

    this.repository.saveMeeting(meeting);
    return request;
  }

  async rejectAdmission(
    meetingId: string,
    actorUserId: string,
    requestId: string,
  ): Promise<MeetingAdmissionRequest> {
    const meeting = this.getRequiredMeeting(meetingId);

    if (!MeetingPermissions.canManageAdmission(meeting, actorUserId)) {
      throw new Error("Only the host may reject an admission request.");
    }

    const request = meeting.accessRequests.find((entry) => entry.id === requestId);
    if (!request) {
      throw new Error("Admission request not found.");
    }

    if (request.userId === actorUserId) {
      throw new Error("A participant cannot reject their own admission.");
    }

    if (request.status !== MeetingAdmissionStatus.WAITING) {
      throw new Error("Admission request is no longer pending.");
    }

    request.status = MeetingAdmissionStatus.REJECTED;
    request.resolvedAt = new Date().toISOString();
    request.reviewedByUserId = actorUserId;

    meeting.participants = meeting.participants.filter(
      (participant) => !(participant.userId === request.userId && participant.role === ParticipantRole.PARTICIPANT),
    );

    this.repository.saveMeeting(meeting);
    return request;
  }

  async changeAccessMode(
    meetingId: string,
    actorUserId: string,
    nextModeInput: MeetingAccessMode | string,
  ): Promise<MeetingAccessMode> {
    const meeting = this.getRequiredMeeting(meetingId);

    if (!MeetingPermissions.canManageAdmission(meeting, actorUserId)) {
      throw new Error("Only the host may change meeting access mode.");
    }

    const nextMode = normalizeMeetingAccessMode(
      typeof nextModeInput === "string" ? nextModeInput : MeetingAccessMode.OPEN,
      "Meeting access mode",
    );

    meeting.accessMode = nextMode;
    this.repository.saveMeeting(meeting);
    return meeting.accessMode;
  }

  async joinMeeting(meetingId: string, input: JoinMeetingInput): Promise<MeetingParticipant> {
    const meeting = this.getRequiredMeeting(meetingId);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new Error("Meeting is not active.");
    }

    const userId = normalizeRequiredString(input.userId, "Participant userId");
    const displayName = normalizeRequiredString(input.displayName, "Participant displayName");

    if (meeting.accessMode === MeetingAccessMode.LOCKED) {
      throw new Error("Meeting admission is locked.");
    }

    if (meeting.accessMode === MeetingAccessMode.HOST_APPROVAL) {
      await this.requestAdmission(meetingId, { userId, displayName });
      throw new Error("Admission request submitted and waiting for host approval.");
    }

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
