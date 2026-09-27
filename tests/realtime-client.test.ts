import { describe, expect, it, vi } from "vitest";

import { validateRealtimeEnv } from "../src/config";
import {
  CloudflareRealtimeConnectionClient,
  CloudflareRealtimeSessionError,
} from "../src/realtime";

describe("validateRealtimeEnv", () => {
  it("returns missing keys without leaking values", () => {
    const validation = validateRealtimeEnv({});

    expect(validation.ok).toBe(false);
    expect(validation.missing).toEqual([
      "REALTIME_SFU_APP_ID",
      "REALTIME_SFU_BEARER_TOKEN",
    ]);
  });

  it("accepts the required environment values", () => {
    const validation = validateRealtimeEnv({
      REALTIME_SFU_APP_ID: "app-123",
      REALTIME_SFU_BEARER_TOKEN: "token-456",
    });

    expect(validation.ok).toBe(true);
    expect(validation.missing).toEqual([]);
  });
});

describe("CloudflareRealtimeConnectionClient", () => {
  it("creates a session with bearer auth and returns the sessionId", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: "session-abc" }),
    });

    const client = new CloudflareRealtimeConnectionClient(
      "app-123",
      "bearer-secret-abc",
      fetchMock as typeof fetch,
    );

    const result = await client.createSession();

    expect(result).toEqual({ sessionId: "session-abc" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const requestUrl = fetchMock.mock.calls[0][0];
    const requestInit = fetchMock.mock.calls[0][1];

    expect(requestUrl).toBe("https://rtc.live.cloudflare.com/v1/apps/app-123/sessions/new");
    expect(requestInit?.headers).toMatchObject({
      Authorization: "Bearer bearer-secret-abc",
      "Content-Type": "application/json",
    });
  });

  it("publishes, subscribes, renegotiates, and closes tracks through authenticated server calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionDescription: { type: "answer", sdp: "sfu-answer" },
        tracks: [{ location: "remote", mid: "2", sessionId: "publisher-transport", trackName: "camera" }],
      }),
    });
    const client = new CloudflareRealtimeConnectionClient("app-123", "bearer-secret-abc", fetchMock as typeof fetch);

    await client.publishTracks("transport-local", { type: "offer", sdp: "local-offer" }, [
      { location: "local", mid: "0", trackName: "microphone" },
      { location: "local", mid: "1", trackName: "camera" },
    ]);
    await client.subscribeTracks("transport-local", [
      { location: "remote", sessionId: "transport-remote", trackName: "camera" },
    ]);
    await client.renegotiate("transport-local", { type: "answer", sdp: "local-answer" });
    await client.closeTracks("transport-local", ["0", "1"]);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["https://rtc.live.cloudflare.com/v1/apps/app-123/sessions/transport-local/tracks/new", "POST"],
      ["https://rtc.live.cloudflare.com/v1/apps/app-123/sessions/transport-local/tracks/new", "POST"],
      ["https://rtc.live.cloudflare.com/v1/apps/app-123/sessions/transport-local/renegotiate", "PUT"],
      ["https://rtc.live.cloudflare.com/v1/apps/app-123/sessions/transport-local/tracks/close", "PUT"],
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      sessionDescription: { type: "offer", sdp: "local-offer" },
      tracks: [
        { location: "local", mid: "0", trackName: "microphone" },
        { location: "local", mid: "1", trackName: "camera" },
      ],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      tracks: [{ location: "remote", sessionId: "transport-remote", trackName: "camera" }],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      sessionDescription: { type: "answer", sdp: "local-answer" },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({
      tracks: [{ mid: "0" }, { mid: "1" }],
      force: true,
    });
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer bearer-secret-abc" });
    }
  });

  it("sanitizes Cloudflare error responses and does not leak raw body content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ errors: [{ message: "secret leaked in body" }] }),
    });

    const client = new CloudflareRealtimeConnectionClient(
      "app-123",
      "bearer-secret-abc",
      fetchMock as typeof fetch,
    );

    await expect(client.createSession()).rejects.toThrow(CloudflareRealtimeSessionError);
    await expect(client.createSession()).rejects.toMatchObject({
      upstreamStatus: 401,
    });
  });
});
