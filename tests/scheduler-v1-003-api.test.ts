import { describe, expect, it, vi } from "vitest";

import type { D1AccountDatabase, D1AccountStatement } from "../src/account/repository";
import app from "../src/index";
import { handleScheduledMeetingRequest } from "../src/scheduler/api";
import {
  D1ScheduleRepository,
  resolveLocalStart,
  ScheduleValidationError,
  validateScheduledMeetingInput,
  type ScheduledMeetingStatus,
} from "../src/scheduler/schedules";
import { InMemoryMeetingRepository, MeetingService, NullMediaProvider } from "../src/meeting";

type StoredSchedule = {
  meeting_id: string;
  owner_account_id: string;
  title: string;
  agenda: string;
  local_date: string;
  local_time: string;
  duration_minutes: number;
  time_zone: string;
  starts_at: string;
  guest_access: "OPEN" | "HOST_APPROVAL" | "LOCKED";
  status: ScheduledMeetingStatus;
  revision: number;
  created_at: string;
  updated_at: string;
};

function scheduleDatabaseFixture() {
  const rows = new Map<string, StoredSchedule>();
  const database: D1AccountDatabase = {
    prepare(query: string) {
      const state = { values: [] as unknown[] };
      let statement: D1AccountStatement;
      statement = {
        bind(...values: unknown[]) {
          state.values = values;
          return statement;
        },
        async first<T>() {
          const [id, owner] = state.values as [string, string?];
          const row = rows.get(id);
          if (query.includes("SELECT status FROM scheduled_meetings")) {
            return (row ? { status: row.status } : null) as T | null;
          }
          return (row && row.owner_account_id === owner ? { ...row } : null) as T | null;
        },
        async all<T>() {
          const [owner, from] = state.values as [string, string?];
          return {
            results: [...rows.values()]
              .filter((row) => row.owner_account_id === owner)
              .filter((row) => !query.includes("status IN ('SCHEDULED', 'STARTING')") || ["SCHEDULED", "STARTING"].includes(row.status))
              .filter((row) => !query.includes("starts_at >= ?") || row.starts_at >= from!)
              .sort((left, right) => left.starts_at.localeCompare(right.starts_at))
              .map((row) => ({ ...row }) as T),
          };
        },
        async run() {
          const values = state.values;
          if (query.includes("INSERT INTO scheduled_meetings")) {
            const [meeting_id, owner_account_id, title, agenda, local_date, local_time, duration_minutes, time_zone, starts_at, guest_access, created_at, updated_at] = values as [string, string, string, string, string, string, number, string, string, StoredSchedule["guest_access"], string, string];
            rows.set(meeting_id, {
              meeting_id,
              owner_account_id,
              title,
              agenda,
              local_date,
              local_time,
              duration_minutes,
              time_zone,
              starts_at,
              guest_access,
              status: "SCHEDULED",
              revision: 1,
              created_at,
              updated_at,
            });
            return { meta: { changes: 1 } };
          }
          if (query.includes("UPDATE scheduled_meetings")) {
            const status = query.startsWith("UPDATE scheduled_meetings SET status = 'CANCELLED'")
              ? "CANCELLED"
              : query.startsWith("UPDATE scheduled_meetings SET status = 'STARTING'")
                ? "STARTING"
                : query.startsWith("UPDATE scheduled_meetings SET status = 'STARTED'")
                  ? "STARTED"
                  : query.startsWith("UPDATE scheduled_meetings SET status = 'ENDED'")
                    ? "ENDED"
                    : null;
            if (query.includes("status = 'ENDED'")) {
              const row = rows.get(values[1] as string);
              if (!row || row.status !== "STARTED") return { meta: { changes: 0 } };
              row.status = "ENDED";
              row.revision += 1;
              row.updated_at = values[0] as string;
              return { meta: { changes: 1 } };
            }
            const id = values[status ? 1 : 9] as string;
            const owner = values[status ? 2 : 10] as string;
            const expectedRevision = values[status ? 3 : 11] as number;
            const row = rows.get(id);
            if (!row || row.owner_account_id !== owner || row.revision !== expectedRevision || (status && row.status !== (status === "STARTING" ? "SCHEDULED" : status === "STARTED" ? "STARTING" : "SCHEDULED"))) {
              return { meta: { changes: 0 } };
            }
            if (status) row.status = status;
            else {
              [row.title, row.agenda, row.local_date, row.local_time, row.duration_minutes, row.time_zone, row.starts_at, row.guest_access] = values.slice(0, 8) as [string, string, string, string, number, string, string, StoredSchedule["guest_access"]];
            }
            row.revision += 1;
            row.updated_at = status ? values[0] as string : values[8] as string;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return statement;
    },
    async batch() {
      return [];
    },
  };
  return { database, rows };
}

const now = new Date("2026-10-13T00:00:00.000Z");
const validSchedule = {
  title: "Design review",
  agenda: "Review the new flow",
  date: "2026-10-14",
  time: "11:00",
  durationMinutes: 45,
  timeZone: "Asia/Kolkata",
  guestAccess: "HOST_APPROVAL",
};

function request(path: string, method: string, body?: unknown): Request {
  return new Request(`https://meet.example${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("BT-V1-003 scheduled meeting lifecycle", () => {
  it("converts local times with daylight-saving transitions without inventing nonexistent instants", () => {
    expect(resolveLocalStart("2026-11-01", "01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
    expect(() => resolveLocalStart("2027-03-14", "02:30", "America/New_York")).toThrow(ScheduleValidationError);
    expect(resolveLocalStart("2026-11-10", "10:30", "Asia/Calcutta"))
      .toBe(resolveLocalStart("2026-11-10", "10:30", "Asia/Kolkata"));
    expect(validateScheduledMeetingInput({ ...validSchedule, timeZone: "Asia/Calcutta" }, now.getTime()))
      .toMatchObject({ timeZone: "Asia/Kolkata", date: "2026-10-14", time: "11:00", startsAt: "2026-10-14T05:30:00.000Z" });
  });

  it("requires an account owner and enforces validation, private reads, revisions, and cancellation", async () => {
    const { database, rows } = scheduleDatabaseFixture();
    const unauthenticated = await handleScheduledMeetingRequest(request("/api/schedules", "GET"), null, database, undefined, now);
    expect(unauthenticated.status).toBe(401);

    const invalid = await handleScheduledMeetingRequest(request("/api/schedules", "POST", { ...validSchedule, time: "25:00" }), "account-1", database, undefined, now);
    expect(invalid.status).toBe(400);
    const invalidAgenda = await handleScheduledMeetingRequest(request("/api/schedules", "POST", { ...validSchedule, agenda: 42 }), "account-1", database, undefined, now);
    expect(invalidAgenda.status).toBe(400);

    const createdResponse = await handleScheduledMeetingRequest(request("/api/schedules", "POST", validSchedule), "account-1", database, undefined, now);
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json() as { data: { id: string; revision: number; status: string; startsAt: string; shareUrl: string } }).data;
    expect(created.id).toMatch(/^btm_[A-Za-z0-9_-]{8,64}$/);
    expect(created.revision).toBe(1);
    expect(created.status).toBe("SCHEDULED");
    expect(created.startsAt).toBe("2026-10-14T05:30:00.000Z");
    expect(created.shareUrl).toBe(`https://meet.example/?meeting=${created.id}`);

    const ownView = await handleScheduledMeetingRequest(request(`/api/schedules/${created.id}`, "GET"), "account-1", database, undefined, now);
    expect(ownView.status).toBe(200);
    expect((await ownView.json() as { data: { title: string } }).data.title).toBe("Design review");
    const ownerList = await handleScheduledMeetingRequest(request("/api/schedules", "GET"), "account-1", database, undefined, now);
    expect((await ownerList.json() as { data: Array<{ id: string }> }).data).toHaveLength(1);
    const upcomingList = await handleScheduledMeetingRequest(request("/api/schedules?upcoming=1", "GET"), "account-1", database, undefined, now);
    expect((await upcomingList.json() as { data: Array<{ id: string }> }).data[0].id).toBe(created.id);
    const otherList = await handleScheduledMeetingRequest(request("/api/schedules", "GET"), "account-2", database, undefined, now);
    expect((await otherList.json() as { data: unknown[] }).data).toHaveLength(0);

    const hidden = await handleScheduledMeetingRequest(request(`/api/schedules/${created.id}`, "GET"), "account-2", database, undefined, now);
    expect(hidden.status).toBe(404);

    const updatedResponse = await handleScheduledMeetingRequest(request(`/api/schedules/${created.id}`, "PUT", {
      ...validSchedule,
      title: "Updated design review",
      revision: 1,
    }), "account-1", database, undefined, now);
    expect(updatedResponse.status).toBe(200);
    const updated = (await updatedResponse.json() as { data: { revision: number; title: string } }).data;
    expect(updated).toMatchObject({ revision: 2, title: "Updated design review" });

    const stale = await handleScheduledMeetingRequest(request(`/api/schedules/${created.id}`, "PUT", { ...validSchedule, revision: 1 }), "account-1", database, undefined, now);
    expect(stale.status).toBe(409);

    const cancelledResponse = await handleScheduledMeetingRequest(request(`/api/schedules/${created.id}`, "DELETE", { revision: 2 }), "account-1", database, undefined, now);
    expect(cancelledResponse.status).toBe(200);
    expect((await cancelledResponse.json() as { data: { status: string; revision: number } }).data).toMatchObject({ status: "CANCELLED", revision: 3 });
    expect(rows.get(created.id)?.status).toBe("CANCELLED");
  });

  it("starts the same stable room early or late, authorizes only its host, and returns that room on retries", async () => {
    const { database } = scheduleDatabaseFixture();
    const repository = new InMemoryMeetingRepository();
    const meetingService = new MeetingService(repository, new NullMediaProvider());
    const createRoom = vi.spyOn(meetingService, "createMeeting");
    const createdResponse = await handleScheduledMeetingRequest(request("/api/schedules", "POST", validSchedule), "account-1", database, meetingService, now);
    const created = (await createdResponse.json() as { data: { id: string; revision: number } }).data;
    expect(await meetingService.getMeeting(created.id)).toBeUndefined();

    const unauthorized = await handleScheduledMeetingRequest(request(`/api/schedules/${created.id}/start`, "POST", { revision: created.revision }), "account-2", database, meetingService, now);
    expect(unauthorized.status).toBe(404);

    const startResponse = await handleScheduledMeetingRequest(request(`/api/schedules/${created.id}/start`, "POST", { revision: created.revision }), "account-1", database, meetingService, now);
    expect(startResponse.status, await startResponse.clone().text()).toBe(200);
    const started = (await startResponse.json() as { data: { schedule: { status: string; revision: number }; meeting: { id: string; hostId: string; status: string; accessMode: string } } }).data;
    expect(started.schedule).toMatchObject({ status: "STARTED", revision: 3 });
    expect(started.meeting).toMatchObject({ id: created.id, hostId: "account-1", status: "active" });
    expect(started.meeting.accessMode).toBe("HOST_APPROVAL");
    expect(createRoom).toHaveBeenCalledTimes(1);

    const retryResponse = await handleScheduledMeetingRequest(request(`/api/schedules/${created.id}/start`, "POST", { revision: created.revision }), "account-1", database, meetingService, now);
    expect(retryResponse.status).toBe(200);
    const retry = (await retryResponse.json() as { data: { schedule: { id: string }; meeting: { id: string; hostId: string } } }).data;
    expect(retry.schedule.id).toBe(created.id);
    expect(retry.meeting).toMatchObject({ id: created.id, hostId: "account-1" });
    expect(createRoom).toHaveBeenCalledTimes(1);

    expect((await new D1ScheduleRepository(database).getPublicStatus(created.id))).toBe("STARTED");
    await meetingService.endMeeting(created.id, "account-1");
    await new D1ScheduleRepository(database).markEnded(created.id, now.toISOString());
    expect((await new D1ScheduleRepository(database).getPublicStatus(created.id))).toBe("ENDED");
    const endedRetry = await handleScheduledMeetingRequest(request(`/api/schedules/${created.id}/start`, "POST", { revision: created.revision }), "account-1", database, meetingService, now);
    expect(endedRetry.status).toBe(409);
    expect(createRoom).toHaveBeenCalledTimes(1);
  });

  it("keeps late scheduled meetings in the host's upcoming/startable list and refuses canceled starts", async () => {
    const { database } = scheduleDatabaseFixture();
    const createdResponse = await handleScheduledMeetingRequest(request("/api/schedules", "POST", validSchedule), "account-1", database, undefined, now);
    const created = (await createdResponse.json() as { data: { id: string; revision: number } }).data;

    const lateNow = new Date("2026-10-15T00:00:00.000Z");
    const upcoming = await handleScheduledMeetingRequest(request("/api/schedules?upcoming=1", "GET"), "account-1", database, undefined, lateNow);
    expect((await upcoming.json() as { data: Array<{ id: string }> }).data.map((meeting) => meeting.id)).toContain(created.id);

    const meetingService = new MeetingService(new InMemoryMeetingRepository(), new NullMediaProvider());
    const lateStart = await handleScheduledMeetingRequest(request(`/api/schedules/${created.id}/start`, "POST", { revision: created.revision }), "account-1", database, meetingService, lateNow);
    expect(lateStart.status).toBe(200);
    expect((await lateStart.json() as { data: { meeting: { id: string } } }).data.meeting.id).toBe(created.id);

    const cancelledResponse = await handleScheduledMeetingRequest(request("/api/schedules", "POST", { ...validSchedule, title: "Cancelled review" }), "account-1", database, undefined, now);
    const cancelledMeeting = (await cancelledResponse.json() as { data: { id: string; revision: number } }).data;
    const cancelled = await handleScheduledMeetingRequest(request(`/api/schedules/${cancelledMeeting.id}`, "DELETE", { revision: cancelledMeeting.revision }), "account-1", database, undefined, lateNow);
    expect(cancelled.status).toBe(200);
    const start = await handleScheduledMeetingRequest(request(`/api/schedules/${cancelledMeeting.id}/start`, "POST", { revision: cancelledMeeting.revision }), "account-1", database, meetingService, lateNow);
    expect(start.status).toBe(409);
    expect(await meetingService.getMeeting(cancelledMeeting.id)).toBeUndefined();
  });

  it("does not activate a same-ID room with a different host, title, or guest policy", async () => {
    const { database } = scheduleDatabaseFixture();
    const meetingService = new MeetingService(new InMemoryMeetingRepository(), new NullMediaProvider());
    const createdResponse = await handleScheduledMeetingRequest(request("/api/schedules", "POST", validSchedule), "account-1", database, undefined, now);
    const created = (await createdResponse.json() as { data: { id: string; revision: number } }).data;
    const unrelatedRoom = await meetingService.createMeeting({
      title: "Instant meeting with a different identity",
      hostUserId: "account-1",
      accessMode: "OPEN",
      meetingId: created.id,
    });

    const start = await handleScheduledMeetingRequest(request(`/api/schedules/${created.id}/start`, "POST", { revision: created.revision }), "account-1", database, meetingService, now);
    expect(start.status).toBe(409);
    expect(await meetingService.getMeeting(created.id)).toMatchObject({
      title: unrelatedRoom.title,
      accessMode: "OPEN",
    });
    expect((await new D1ScheduleRepository(database).getOwned(created.id, "account-1"))?.status).toBe("SCHEDULED");
  });

  it("requires an authenticated account at the Worker boundary and gives pre-start share links a clear status", async () => {
    let scheduledStatus: ScheduledMeetingStatus = "SCHEDULED";
    const id = "btm_prestart001";
    const database: D1AccountDatabase = {
      prepare(query: string) {
        const state = { values: [] as unknown[] };
        const statement: D1AccountStatement = {
          bind(...values: unknown[]) { state.values = values; return statement; },
          async first<T>() {
            return (query.includes("SELECT status FROM scheduled_meetings") && state.values[0] === id
              ? { status: scheduledStatus }
              : null) as T | null;
          },
          async run() { return { meta: { changes: 0 } }; },
        };
        return statement;
      },
      async batch() { return []; },
    };
    const authFailure = await app.fetch(request("/api/schedules", "GET"), { ACCOUNT_DB: database });
    expect(authFailure.status).toBe(401);
    const crossOriginWrite = await app.fetch(new Request("https://meet.example/api/schedules", {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify(validSchedule),
    }), { ACCOUNT_DB: database });
    expect(crossOriginWrite.status).toBe(403);

    const sessions = new Map<string, { sessionId: string; userId: string; displayName: string; createdAt: string; lastSeenAt: string }>();
    const sessionStub = {
      async getSession(sessionId: string) { return sessions.get(sessionId); },
      async saveSession(session: { sessionId: string; userId: string; displayName: string; createdAt: string; lastSeenAt: string }) { sessions.set(session.sessionId, session); },
      async deleteSession(sessionId: string) { sessions.delete(sessionId); },
    };
    const environment = {
      ACCOUNT_DB: database,
      SESSION_STORE: { idFromName: (name: string) => name, get: () => sessionStub },
      MEETING_STORE: {
        idFromName: (name: string) => name,
        get: () => ({ getMeeting: async () => undefined }),
      },
    };
    const prestart = await app.fetch(request(`/api/meetings/${id}`, "GET"), environment);
    expect(prestart.status).toBe(425);
    await expect(prestart.json()).resolves.toMatchObject({ ok: false, error: "This meeting has not started yet. Please check with the host." });

    scheduledStatus = "CANCELLED";
    const cancelled = await app.fetch(request(`/api/meetings/${id}`, "GET"), environment);
    expect(cancelled.status).toBe(410);
  });
});
