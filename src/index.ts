import { validateRealtimeEnv, type RealtimeEnv } from "./config";
import { CloudflareRealtimeConnectionClient } from "./realtime";

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export default {
  async fetch(request: Request, env: RealtimeEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const validation = validateRealtimeEnv(env);

      return jsonResponse({
        ok: true,
        service: "billiontalks-realtime-backend",
        envConfigured: validation.ok,
      });
    }

    if (request.method === "POST" && url.pathname === "/api/realtime/session") {
      const validation = validateRealtimeEnv(env);

      if (!validation.ok) {
        return jsonResponse(
          {
            ok: false,
            error: "Cloudflare Realtime configuration is missing.",
            missing: validation.missing,
          },
          500,
        );
      }

      try {
        const client = new CloudflareRealtimeConnectionClient(
          env.REALTIME_SFU_APP_ID!,
          env.REALTIME_SFU_BEARER_TOKEN!,
        );

        const result = await client.createSession();

        return jsonResponse(
          {
            ok: true,
            data: {
              sessionId: result.sessionId,
            },
          },
          200,
        );
      } catch (error) {
        const upstreamStatus =
          error instanceof Error && "upstreamStatus" in error
            ? Number((error as { upstreamStatus?: number }).upstreamStatus)
            : undefined;

        const errorMessage =
          typeof upstreamStatus === "number" && Number.isFinite(upstreamStatus)
            ? `Cloudflare Realtime session creation failed. HTTP status: ${upstreamStatus}.`
            : "Cloudflare Realtime session creation failed.";

        return jsonResponse(
          {
            ok: false,
            error: errorMessage,
            upstreamStatus,
          },
          500,
        );
      }
    }

    return jsonResponse(
      {
        ok: false,
        error: "Not found.",
      },
      404,
    );
  },
};
