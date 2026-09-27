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
  REMOVED = "REMOVED",
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
  revision?: number;
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

export interface MeetingRepository {
  saveMeeting(meeting: Meeting): Promise<void> | void;
  getMeeting(meetingId: string): Promise<Meeting | undefined> | Meeting | undefined;
  setMediaConnection(connection: MeetingMediaConnection): Promise<void> | void;
  getMediaConnection(meetingId: string, participantId: string): Promise<MeetingMediaConnection | undefined> | MeetingMediaConnection | undefined;
  deleteMediaConnection(meetingId: string, participantId: string): Promise<void> | void;
}

type DurableObjectStorageLike = {
  get: (key: string) => Promise<unknown> | unknown;
  put: (key: string, value: unknown) => Promise<void> | void;
  delete: (key: string) => Promise<void> | void;
  has?: (key: string) => Promise<boolean> | boolean;
  list?: () => Promise<Array<{ name: string; value: unknown }>> | Array<{ name: string; value: unknown }>;
};

type DurableObjectStubLike = {
  saveMeeting: (meeting: Meeting) => Promise<number | void>;
  getMeeting: () => Promise<Meeting | undefined>;
};

type DurableObjectNamespaceLike = {
  get: (id: any) => DurableObjectStubLike;
  idFromName: (name: string) => any;
};

export class InMemoryMeetingRepository implements MeetingRepository {
  private readonly meetings = new Map<string, Meeting>();
  private readonly participantMediaConnections = new Map<string, MeetingMediaConnection>();

  async saveMeeting(meeting: Meeting): Promise<void> {
    this.meetings.set(meeting.id, meeting);
  }

  async getMeeting(meetingId: string): Promise<Meeting | undefined> {
    return this.meetings.get(meetingId);
  }

  async setMediaConnection(connection: MeetingMediaConnection): Promise<void> {
    const key = `${connection.meetingId}:${connection.participantId}`;
    this.participantMediaConnections.set(key, connection);
  }

  async getMediaConnection(meetingId: string, participantId: string): Promise<MeetingMediaConnection | undefined> {
    const key = `${meetingId}:${participantId}`;
    return this.participantMediaConnections.get(key);
  }

  async deleteMediaConnection(meetingId: string, participantId: string): Promise<void> {
    const key = `${meetingId}:${participantId}`;
    this.participantMediaConnections.delete(key);
  }
}

export class DurableMeetingRepository implements MeetingRepository {
  private readonly meetings = new Map<string, Meeting>();
  private readonly participantMediaConnections = new Map<string, MeetingMediaConnection>();
  private readonly storage?: DurableObjectStorageLike;
  private readonly namespace?: DurableObjectNamespaceLike;

  constructor(storageOrNamespace?: DurableObjectStorageLike | DurableObjectNamespaceLike) {
    if (storageOrNamespace && "get" in storageOrNamespace && "put" in storageOrNamespace) {
      this.storage = storageOrNamespace as DurableObjectStorageLike;
      return;
    }

    if (storageOrNamespace) {
      this.namespace = storageOrNamespace as DurableObjectNamespaceLike;
    }
  }

  async saveMeeting(meeting: Meeting): Promise<void> {
    if (this.namespace) {
      const stub = this.namespace.get(this.namespace.idFromName(meeting.id));
      const revision = await stub.saveMeeting(meeting);
      if (typeof revision === "number") meeting.revision = revision;
      return;
    }

    if (this.storage) {
      await this.storage.put(`meeting:${meeting.id}`, meeting);
      return;
    }

    this.meetings.set(meeting.id, meeting);
  }

  async getMeeting(meetingId: string): Promise<Meeting | undefined> {
    if (this.namespace) {
      const stub = this.namespace.get(this.namespace.idFromName(meetingId));
      return stub.getMeeting();
    }

    if (this.storage) {
      const value = await this.storage.get(`meeting:${meetingId}`);
      return value as Meeting | undefined;
    }

    return this.meetings.get(meetingId);
  }

  async setMediaConnection(connection: MeetingMediaConnection): Promise<void> {
    const key = `${connection.meetingId}:${connection.participantId}`;
    this.participantMediaConnections.set(key, connection);
  }

  async getMediaConnection(meetingId: string, participantId: string): Promise<MeetingMediaConnection | undefined> {
    const key = `${meetingId}:${participantId}`;
    return this.participantMediaConnections.get(key);
  }

  async deleteMediaConnection(meetingId: string, participantId: string): Promise<void> {
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

    return this.isHost(meeting, actorUserId) &&
      meeting.participants.some((participant) => participant.userId === targetUserId && participant.role !== ParticipantRole.HOST && participant.state === ParticipantState.JOINED);
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
    private readonly repository: MeetingRepository,
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

    await this.repository.saveMeeting(meeting);
    await this.repository.setMediaConnection({
      id: `${meeting.id}:${hostParticipant.id}`,
      meetingId: meeting.id,
      participantId: hostParticipant.id,
      provider: result.provider,
      providerSessionId: result.providerSessionId,
      createdAt: new Date().toISOString(),
    });

    return meeting;
  }

  async getMeeting(meetingId: string): Promise<Meeting | undefined> {
    const meeting = await this.repository.getMeeting(meetingId);
    if (!meeting) {
      return undefined;
    }

    meeting.participants = this.deduplicateParticipants(meeting.participants);
    return meeting;
  }

  async requestAdmission(
    meetingId: string,
    input: JoinMeetingInput,
  ): Promise<MeetingAdmissionRequest> {
    const meeting = await this.getRequiredMeeting(meetingId);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new Error("Meeting is not active.");
    }

    const userId = normalizeRequiredString(input.userId, "Participant userId");
    const displayName = normalizeRequiredString(input.displayName, "Participant displayName");

    if (meeting.hostId === userId) {
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

    if (meeting.participants.some((participant) => participant.userId === userId && participant.state === ParticipantState.REMOVED)) {
      throw new Error("You were removed from this meeting.");
    }

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
        await this.joinMeeting(meetingId, { userId, displayName });
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
    await this.repository.saveMeeting(meeting);
    return request;
  }

  async listPendingAdmissions(meetingId: string, actorUserId: string): Promise<MeetingAdmissionRequest[]> {
    const meeting = await this.getRequiredMeeting(meetingId);

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
    const meeting = await this.getRequiredMeeting(meetingId);

    if (!MeetingPermissions.canManageAdmission(meeting, actorUserId)) {
      throw new Error("Only the host may approve an admission request.");
    }

    if (meeting.accessMode === MeetingAccessMode.LOCKED) {
      throw new Error("Meeting admission is locked.");
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

    await this.repository.saveMeeting(meeting);
    return request;
  }

  async rejectAdmission(
    meetingId: string,
    actorUserId: string,
    requestId: string,
  ): Promise<MeetingAdmissionRequest> {
    const meeting = await this.getRequiredMeeting(meetingId);

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

    await this.repository.saveMeeting(meeting);
    return request;
  }

  async changeAccessMode(
    meetingId: string,
    actorUserId: string,
    nextModeInput: MeetingAccessMode | string,
  ): Promise<MeetingAccessMode> {
    const meeting = await this.getRequiredMeeting(meetingId);

    if (!MeetingPermissions.canManageAdmission(meeting, actorUserId)) {
      throw new Error("Only the host may change meeting access mode.");
    }

    const nextMode = normalizeMeetingAccessMode(
      typeof nextModeInput === "string" ? nextModeInput : MeetingAccessMode.OPEN,
      "Meeting access mode",
    );

    meeting.accessMode = nextMode;
    await this.repository.saveMeeting(meeting);
    return meeting.accessMode;
  }

  async joinMeeting(meetingId: string, input: JoinMeetingInput): Promise<MeetingParticipant> {
    const meeting = await this.getRequiredMeeting(meetingId);
    meeting.participants = this.deduplicateParticipants(meeting.participants);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new Error("Meeting is not active.");
    }

    const userId = normalizeRequiredString(input.userId, "Participant userId");
    const displayName = normalizeRequiredString(input.displayName, "Participant displayName");

    const existingParticipant = meeting.participants.find(
      (participant) => participant.userId === userId,
    );

    if (meeting.hostId === userId) {
      if (existingParticipant) {
        existingParticipant.role = ParticipantRole.HOST;
        if (existingParticipant.state === ParticipantState.LEFT) {
          existingParticipant.state = ParticipantState.JOINED;
          existingParticipant.leftAt = undefined;
        }
        existingParticipant.displayName = displayName;
        await this.repository.saveMeeting(meeting);
        return existingParticipant;
      }

      const participant: MeetingParticipant = {
        id: generateParticipantId(meetingId, userId),
        meetingId,
        userId,
        displayName,
        role: ParticipantRole.HOST,
        state: ParticipantState.JOINED,
        joinedAt: new Date().toISOString(),
      };

      const result = await this.mediaProvider.createParticipantMediaConnection(
        meeting.id,
        participant.id,
      );

      meeting.participants.push(participant);
      await this.repository.saveMeeting(meeting);
      await this.repository.setMediaConnection({
        id: `${meeting.id}:${participant.id}`,
        meetingId: meeting.id,
        participantId: participant.id,
        provider: result.provider,
        providerSessionId: result.providerSessionId,
        createdAt: new Date().toISOString(),
      });

      return participant;
    }

    if (meeting.participants.some((participant) => participant.userId === userId && participant.state === ParticipantState.REMOVED)) {
      throw new Error("You were removed from this meeting.");
    }

    if (meeting.accessMode === MeetingAccessMode.LOCKED) {
      throw new Error("Meeting admission is locked.");
    }

    if (meeting.accessMode === MeetingAccessMode.HOST_APPROVAL) {
      if (existingParticipant) {
        if (existingParticipant.state === ParticipantState.LEFT) {
          existingParticipant.state = ParticipantState.JOINED;
          existingParticipant.leftAt = undefined;
        }
        existingParticipant.displayName = displayName;
        existingParticipant.role = ParticipantRole.PARTICIPANT;
        await this.repository.saveMeeting(meeting);
        return existingParticipant;
      }

      const existingRequest = meeting.accessRequests.find((request) => request.userId === userId);
      if (existingRequest) {
        if (existingRequest.status === MeetingAdmissionStatus.APPROVED) {
          const participant: MeetingParticipant = {
            id: generateParticipantId(meetingId, userId),
            meetingId,
            userId,
            displayName,
            role: ParticipantRole.PARTICIPANT,
            state: ParticipantState.JOINED,
            joinedAt: new Date().toISOString(),
          };

          meeting.participants.push(participant);
          await this.repository.saveMeeting(meeting);
          return participant;
        }

        if (existingRequest.status === MeetingAdmissionStatus.REJECTED) {
          throw new Error("Your meeting admission request was rejected.");
        }

        if (existingRequest.status === MeetingAdmissionStatus.WAITING) {
          throw new Error("Admission request submitted and waiting for host approval.");
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
      await this.repository.saveMeeting(meeting);
      throw new Error("Admission request submitted and waiting for host approval.");
    }

    if (existingParticipant) {
      if (existingParticipant.state === ParticipantState.LEFT) {
        existingParticipant.state = ParticipantState.JOINED;
        existingParticipant.leftAt = undefined;
      }

      existingParticipant.displayName = displayName;
      await this.repository.saveMeeting(meeting);
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
    await this.repository.saveMeeting(meeting);
    await this.repository.setMediaConnection({
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
    const meeting = await this.getRequiredMeeting(meetingId);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new Error("Meeting is not active.");
    }

    const normalizedUserId = normalizeRequiredString(userId, "Participant userId");
    const participant = meeting.participants.find((entry) => entry.userId === normalizedUserId);

    if (!participant) {
      return undefined;
    }

    if (participant.state === ParticipantState.LEFT || participant.state === ParticipantState.REMOVED) {
      return participant;
    }

    await this.mediaProvider.deleteParticipantMediaConnection(meeting.id, participant.id);

    participant.state = ParticipantState.LEFT;
    participant.leftAt = new Date().toISOString();
    await this.repository.saveMeeting(meeting);
    await this.repository.deleteMediaConnection(meeting.id, participant.id);

    return participant;
  }

  async removeParticipant(meetingId: string, actorUserId: string, targetUserId: string): Promise<Meeting> {
    const meeting = await this.getRequiredMeeting(meetingId);
    if (!MeetingPermissions.canKickParticipant(meeting, actorUserId, targetUserId)) {
      throw new Error("Only the host may remove a joined guest from an active meeting.");
    }
    const participant = meeting.participants.find((entry) => entry.userId === targetUserId)!;
    participant.state = ParticipantState.REMOVED;
    participant.leftAt = new Date().toISOString();
    for (const request of meeting.accessRequests.filter((entry) => entry.userId === targetUserId)) {
      request.status = MeetingAdmissionStatus.REJECTED;
      request.resolvedAt = participant.leftAt;
      request.reviewedByUserId = actorUserId;
    }
    await this.repository.saveMeeting(meeting);
    await this.mediaProvider.deleteParticipantMediaConnection(meeting.id, participant.id);
    await this.repository.deleteMediaConnection(meeting.id, participant.id);
    return meeting;
  }

  async endMeeting(meetingId: string, actorUserId: string): Promise<Meeting> {
    const meeting = await this.getRequiredMeeting(meetingId);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new Error("Meeting is not active.");
    }

    if (!MeetingPermissions.canEndMeeting(meeting, actorUserId)) {
      throw new Error("Only the host may end the meeting.");
    }

    meeting.status = MeetingStatus.ENDED;
    for (const request of meeting.accessRequests.filter((entry) => entry.status === MeetingAdmissionStatus.WAITING)) {
      request.status = MeetingAdmissionStatus.REJECTED;
      request.resolvedAt = new Date().toISOString();
      request.reviewedByUserId = actorUserId;
    }
    meeting.participants.forEach((participant) => {
      if (participant.state === ParticipantState.JOINED) {
        participant.state = ParticipantState.LEFT;
        participant.leftAt = new Date().toISOString();
      }
    });

    await this.repository.saveMeeting(meeting);
    return meeting;
  }

  async getParticipantMediaConnection(meetingId: string, participantId: string): Promise<MeetingMediaConnection | undefined> {
    return this.repository.getMediaConnection(meetingId, participantId);
  }

  async listParticipants(meetingId: string): Promise<MeetingParticipant[]> {
    const meeting = await this.getRequiredMeeting(meetingId);
    return this.deduplicateParticipants(meeting.participants);
  }

  private deduplicateParticipants(participants: MeetingParticipant[]): MeetingParticipant[] {
    const deduped = new Map<string, MeetingParticipant>();

    for (const participant of participants) {
      const existing = deduped.get(participant.userId);
      if (!existing) {
        deduped.set(participant.userId, participant);
        continue;
      }

      const preferred = this.choosePreferredParticipant(existing, participant);
      deduped.set(participant.userId, preferred);
    }

    return Array.from(deduped.values());
  }

  private choosePreferredParticipant(
    current: MeetingParticipant,
    candidate: MeetingParticipant,
  ): MeetingParticipant {
    if (current.state === ParticipantState.REMOVED) return current;
    if (candidate.state === ParticipantState.REMOVED) return candidate;

    if (current.state === ParticipantState.JOINED && candidate.state !== ParticipantState.JOINED) {
      return current;
    }

    if (current.state !== ParticipantState.JOINED && candidate.state === ParticipantState.JOINED) {
      return candidate;
    }

    if (current.role === ParticipantRole.HOST && candidate.role !== ParticipantRole.HOST) {
      return current;
    }

    if (current.role !== ParticipantRole.HOST && candidate.role === ParticipantRole.HOST) {
      return candidate;
    }

    const currentTime = Date.parse(current.joinedAt || "1970-01-01T00:00:00.000Z");
    const candidateTime = Date.parse(candidate.joinedAt || "1970-01-01T00:00:00.000Z");
    return currentTime >= candidateTime ? current : candidate;
  }

  private async getRequiredMeeting(meetingId: string): Promise<Meeting> {
    const meeting = await this.repository.getMeeting(meetingId);

    if (!meeting) {
      throw new Error(`Meeting not found: ${meetingId}`);
    }

    meeting.participants = this.deduplicateParticipants(meeting.participants);

    return meeting;
  }
}
