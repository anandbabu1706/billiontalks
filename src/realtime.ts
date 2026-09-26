export type CloudflareRealtimeSessionResult = {
  sessionId: string;
};

export class CloudflareRealtimeSessionError extends Error {
  constructor(
    public readonly upstreamStatus: number,
    message = `Cloudflare Realtime session creation failed. HTTP status: ${upstreamStatus}.`,
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
  }

  async createSession(): Promise<CloudflareRealtimeSessionResult> {
    const url = `${this.baseUrl}/v1/apps/${encodeURIComponent(this.appId)}/sessions/new`;

    const response = await this.fetcher(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new CloudflareRealtimeSessionError(response.status);
    }

    const payload = (await response.json()) as { sessionId?: string };

    if (!payload.sessionId) {
      throw new Error("Cloudflare Realtime session response did not include a sessionId");
    }

    return {
      sessionId: payload.sessionId,
    };
  }
}
