export type CloudflareRealtimeSessionResult = {
  sessionId: string;
};

export type RealtimeSessionDescription = {
  type: "offer" | "answer";
  sdp: string;
};

export type RealtimeTrackRequest =
  | { location: "local"; mid: string; trackName: string }
  | { location: "remote"; sessionId: string; trackName: string };

export type RealtimeTrackResult = {
  location?: "local" | "remote";
  mid?: string;
  sessionId?: string;
  trackName?: string;
  errorCode?: string;
  errorDescription?: string;
};

export type RealtimeTrackOperationResult = {
  sessionDescription?: RealtimeSessionDescription;
  requiresImmediateRenegotiation?: boolean;
  tracks?: RealtimeTrackResult[];
};

export type RealtimePublishedTrack = {
  trackName: string;
  mid: string;
};

export type RealtimeSubscribedTrack = {
  publicationKey: string;
  publisherUserId: string;
  publisherDisplayName: string;
  trackName: string;
  mid: string;
};

export type RealtimeParticipantMediaState = {
  userId: string;
  connectionId: string;
  generation: number;
  publisherSessionId?: string;
  subscriberSessionId?: string;
  publishedTracks: RealtimePublishedTrack[];
  pendingPublishedTracks?: RealtimePublishedTrack[];
  subscribedTracks: RealtimeSubscribedTrack[];
  pendingSubscriptions?: {
    operationId: string;
    sessionDescription: RealtimeSessionDescription;
    tracks: RealtimeSubscribedTrack[];
    removed?: RealtimeSubscribedTrack[];
  };
};

export class CloudflareRealtimeSessionError extends Error {
  constructor(
    public readonly upstreamStatus: number,
    message = `Cloudflare Realtime session creation failed. HTTP status: ${upstreamStatus}.`,
    public readonly errorCode?: string,
    public readonly errorDescription?: string,
  ) {
    super(message);
    this.name = "CloudflareRealtimeSessionError";
  }
}

export class CloudflareRealtimeConnectionClient {
  private readonly baseUrl: string;

  constructor(
    private readonly appId: string,
    private readonly bearerToken: string,
    private readonly fetcher: typeof fetch = fetch,
    baseUrl = "https://rtc.live.cloudflare.com",
  ) {
    this.baseUrl = baseUrl;
    this.fetcher = fetcher.bind(globalThis);
  }

  async createSession(): Promise<CloudflareRealtimeSessionResult> {
    const payload = await this.request<{ sessionId?: string }>("POST", "/sessions/new");

    if (!payload.sessionId) {
      throw new Error("Cloudflare Realtime session response did not include a sessionId");
    }

    return {
      sessionId: payload.sessionId,
    };
  }

  publishTracks(
    sessionId: string,
    sessionDescription: RealtimeSessionDescription,
    tracks: Extract<RealtimeTrackRequest, { location: "local" }>[],
  ): Promise<RealtimeTrackOperationResult> {
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/tracks/new`, { sessionDescription, tracks });
  }

  subscribeTracks(
    sessionId: string,
    tracks: Extract<RealtimeTrackRequest, { location: "remote" }>[],
  ): Promise<RealtimeTrackOperationResult> {
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/tracks/new`, { tracks });
  }

  renegotiate(sessionId: string, sessionDescription: RealtimeSessionDescription): Promise<Record<string, unknown>> {
    return this.request("PUT", `/sessions/${encodeURIComponent(sessionId)}/renegotiate`, { sessionDescription });
  }

  // Forced close drops m-lines on the SFU side without a negotiation; only use it when the whole session is being discarded.
  closeTracks(
    sessionId: string,
    mids: string[],
    options: { force?: boolean; sessionDescription?: RealtimeSessionDescription } = {},
  ): Promise<RealtimeTrackOperationResult> {
    return this.request("PUT", `/sessions/${encodeURIComponent(sessionId)}/tracks/close`, {
      tracks: mids.map((mid) => ({ mid })),
      force: options.force ?? true,
      ...(options.sessionDescription ? { sessionDescription: options.sessionDescription } : {}),
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/v1/apps/${encodeURIComponent(this.appId)}${path}`;
    const response = await this.fetcher(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      let errorCode: string | undefined;
      let errorDescription: string | undefined;
      try {
        const detail = await response.json() as { errorCode?: unknown; errorDescription?: unknown };
        if (typeof detail.errorCode === "string" || typeof detail.errorCode === "number") errorCode = String(detail.errorCode).slice(0, 80);
        if (typeof detail.errorDescription === "string") errorDescription = detail.errorDescription.slice(0, 300);
      } catch { /* upstream body is not JSON */ }
      throw new CloudflareRealtimeSessionError(response.status, undefined, errorCode, errorDescription);
    }

    return response.json() as Promise<T>;
  }
}
