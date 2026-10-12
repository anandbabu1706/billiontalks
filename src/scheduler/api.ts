import type { D1AccountDatabase } from "../account/repository";
import type { MeetingService } from "../meeting";
import { D1ScheduleRepository, ensureScheduledLiveRoom, ScheduleConflictError, ScheduleValidationError, validateScheduledMeetingInput } from "./schedules";

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new ScheduleValidationError("A JSON request body is required.");
  }
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > 8192) {
    throw new ScheduleValidationError("The meeting schedule request is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ScheduleValidationError("A JSON request body is required.");
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > 8192) {
      await reader.cancel();
      throw new ScheduleValidationError("The meeting schedule request is too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ScheduleValidationError("The request body must contain valid JSON.");
  }
}

function getRevision(value: unknown): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ScheduleValidationError("A meeting revision is required.");
  }
  const revision = (value as Record<string, unknown>).revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) {
    throw new ScheduleValidationError("A valid meeting revision is required.");
  }
  return revision;
}

function shareUrl(request: Request, id: string): string {
  const url = new URL("/", request.url);
  url.searchParams.set("meeting", id);
  return url.toString();
}

function errorResponse(error: unknown): Response {
  if (error instanceof ScheduleValidationError) return jsonResponse({ ok: false, error: error.message }, 400);
  if (error instanceof ScheduleConflictError) return jsonResponse({ ok: false, error: error.message }, 409);
  console.error("Scheduled meeting request failed.", error);
  return jsonResponse({ ok: false, error: "Unable to complete the scheduled meeting request." }, 500);
}

export async function handleScheduledMeetingRequest(
  request: Request,
  ownerAccountId: string | null,
  database: D1AccountDatabase | undefined,
  meetingService?: MeetingService,
  now = new Date(),
): Promise<Response> {
  if (!database) return jsonResponse({ ok: false, error: "Meeting scheduling is temporarily unavailable." }, 503);
  if (!ownerAccountId) return jsonResponse({ ok: false, error: "Sign in to manage scheduled meetings." }, 401);

  const url = new URL(request.url);
  const collection = url.pathname === "/api/schedules";
  const match = /^\/api\/schedules\/(btm_[A-Za-z0-9_-]{8,64})(?:\/(start))?$/.exec(url.pathname);
  if (!collection && !match) return jsonResponse({ ok: false, error: "Not found." }, 404);
  const repository = new D1ScheduleRepository(database);

  try {
    if (collection && request.method === "GET") {
      const meetings = url.searchParams.get("upcoming") === "1"
        ? await repository.listUpcoming(ownerAccountId, now.toISOString())
        : await repository.listOwned(ownerAccountId);
      return jsonResponse({ ok: true, data: meetings.map((meeting) => ({ ...meeting, shareUrl: shareUrl(request, meeting.id) })) });
    }

    if (collection && request.method === "POST") {
      const input = validateScheduledMeetingInput(await readJson(request), now.getTime());
      const { startsAt, ...scheduleInput } = input;
      const meeting = await repository.create(ownerAccountId, { ...scheduleInput, startsAt }, now.toISOString());
      return jsonResponse({ ok: true, data: { ...meeting, shareUrl: shareUrl(request, meeting.id) } }, 201);
    }

    if (!match) return jsonResponse({ ok: false, error: "Not found." }, 404);
    const [, id, action] = match;
    if (!action && request.method === "GET") {
      const meeting = await repository.getOwned(id, ownerAccountId);
      return meeting
        ? jsonResponse({ ok: true, data: { ...meeting, shareUrl: shareUrl(request, meeting.id) } })
        : jsonResponse({ ok: false, error: "Scheduled meeting not found." }, 404);
    }

    if (!action && request.method === "PUT") {
      const body = await readJson(request);
      const revision = getRevision(body);
      const input = validateScheduledMeetingInput(body, now.getTime());
      const { startsAt, ...scheduleInput } = input;
      const meeting = await repository.updateOwned(id, ownerAccountId, revision, { ...scheduleInput, startsAt }, now.toISOString());
      return jsonResponse({ ok: true, data: { ...meeting, shareUrl: shareUrl(request, meeting.id) } });
    }

    if (!action && request.method === "DELETE") {
      const revision = getRevision(await readJson(request));
      const meeting = await repository.cancelOwned(id, ownerAccountId, revision, now.toISOString());
      return jsonResponse({ ok: true, data: meeting });
    }

    if (action === "start" && request.method === "POST") {
      if (!meetingService) return jsonResponse({ ok: false, error: "Live meeting startup is temporarily unavailable." }, 503);
      const revision = getRevision(await readJson(request));
      const current = await repository.getOwned(id, ownerAccountId);
      if (!current) return jsonResponse({ ok: false, error: "Scheduled meeting not found." }, 404);
      if (current.status === "STARTED") {
        if (revision !== current.revision) throw new ScheduleConflictError("This meeting changed before it could start. Refresh and try again.");
        const existing = await meetingService.getMeeting(id);
        if (!existing || existing.hostId !== ownerAccountId) {
          return jsonResponse({ ok: false, error: "The started meeting room is unavailable." }, 409);
        }
        return jsonResponse({ ok: true, data: { schedule: current, meeting: existing, shareUrl: shareUrl(request, id) } });
      }
      const starting = await repository.claimStart(id, ownerAccountId, revision, now.toISOString());
      const room = await ensureScheduledLiveRoom(
        starting,
        (input) => meetingService.createMeeting(input),
        (meetingId) => meetingService.getMeeting(meetingId),
      );
      const started = await repository.markStarted(id, ownerAccountId, starting.revision, now.toISOString());
      return jsonResponse({ ok: true, data: { schedule: started, meeting: room, shareUrl: shareUrl(request, id) } });
    }

    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  } catch (error) {
    return errorResponse(error);
  }
}
