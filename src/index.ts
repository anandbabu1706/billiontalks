import { validateRealtimeEnv, type RealtimeEnv } from "./config";
import {
  CloudflareMediaProvider,
  InMemoryMeetingRepository,
  MeetingService,
  NullMediaProvider,
} from "./meeting";
import { CloudflareRealtimeConnectionClient } from "./realtime";

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

const meetingRepository = new InMemoryMeetingRepository();

function getMeetingService(env: RealtimeEnv): MeetingService {
  const mediaProvider =
    env.REALTIME_SFU_APP_ID && env.REALTIME_SFU_BEARER_TOKEN
      ? new CloudflareMediaProvider(env.REALTIME_SFU_APP_ID, env.REALTIME_SFU_BEARER_TOKEN)
      : new NullMediaProvider();

  return new MeetingService(meetingRepository, mediaProvider);
}

function parseJsonBody<T>(request: Request): Promise<T | null> {
  return request.json().catch(() => null) as Promise<T | null>;
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

    if (request.method === "POST" && url.pathname === "/api/meetings") {
      const body = await parseJsonBody<{ title?: string; hostUserId?: string }>(request);

      if (!body || !body.title || !body.hostUserId) {
        return jsonResponse(
          {
            ok: false,
            error: "Meeting title and hostUserId are required.",
          },
          400,
        );
      }

      try {
        const meeting = await getMeetingService(env).createMeeting({
          title: body.title,
          hostUserId: body.hostUserId,
        });

        return jsonResponse(
          {
            ok: true,
            data: meeting,
          },
          201,
        );
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Unable to create meeting.",
          },
          500,
        );
      }
    }

    const meetingMatch = /^\/api\/meetings\/([^/]+)(?:\/(join|leave|end|participants))?$/.exec(
      url.pathname,
    );

    if (meetingMatch && request.method === "GET" && !meetingMatch[2]) {
      const meeting = getMeetingService(env).getMeeting(meetingMatch[1]);

      if (!meeting) {
        return jsonResponse({ ok: false, error: "Meeting not found." }, 404);
      }

      return jsonResponse({ ok: true, data: meeting });
    }

    if (meetingMatch && request.method === "POST" && meetingMatch[2] === "join") {
      const body = await parseJsonBody<{ userId?: string; displayName?: string }>(request);

      if (!body || !body.userId || !body.displayName) {
        return jsonResponse(
          {
            ok: false,
            error: "userId and displayName are required to join a meeting.",
          },
          400,
        );
      }

      try {
        const meeting = await getMeetingService(env).joinMeeting(meetingMatch[1], {
          userId: body.userId,
          displayName: body.displayName,
        });

        return jsonResponse({ ok: true, data: meeting });
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Unable to join meeting.",
          },
          400,
        );
      }
    }

    if (meetingMatch && request.method === "POST" && meetingMatch[2] === "leave") {
      const body = await parseJsonBody<{ userId?: string }>(request);

      if (!body || !body.userId) {
        return jsonResponse(
          {
            ok: false,
            error: "userId is required to leave a meeting.",
          },
          400,
        );
      }

      try {
        const participant = await getMeetingService(env).leaveMeeting(meetingMatch[1], body.userId);

        return participant
          ? jsonResponse({ ok: true, data: participant })
          : jsonResponse({ ok: false, error: "Participant not found." }, 404);
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Unable to leave meeting.",
          },
          400,
        );
      }
    }

    if (meetingMatch && request.method === "POST" && meetingMatch[2] === "end") {
      const body = await parseJsonBody<{ userId?: string }>(request);

      if (!body || !body.userId) {
        return jsonResponse(
          {
            ok: false,
            error: "userId is required to end the meeting.",
          },
          400,
        );
      }

      try {
        const meeting = getMeetingService(env).endMeeting(meetingMatch[1], body.userId);
        return jsonResponse({ ok: true, data: meeting });
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Unable to end meeting.",
          },
          403,
        );
      }
    }

    if (meetingMatch && request.method === "GET" && meetingMatch[2] === "participants") {
      const participants = getMeetingService(env).listParticipants(meetingMatch[1]);
      return jsonResponse({ ok: true, data: participants });
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
