import type { DurableObjectStorage } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app, { MeetingStateDurableObject } from "../src/index";
import { DurableMeetingRepository, InMemoryMeetingRepository, MeetingService, NullMediaProvider, type Meeting } from "../src/meeting";

describe("canonical production hostname", () => {
  it("redirects www to the apex while preserving path and query", async () => {
    const response = await app.fetch(new Request("http://www.billiontalks.com/meetings/room?meeting=btm_example&tab=chat"));

    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("https://billiontalks.com/meetings/room?meeting=btm_example&tab=chat");
  });

  it("does not redirect unrelated hosts", async () => {
    const response = await app.fetch(new Request("http://localhost/not-found"));

    expect(response.status).toBe(404);
    expect(response.headers.has("Location")).toBe(false);
  });
});

function durableFixture() {
  const objects = new Map<string, MeetingStateDurableObject>();
  const snapshots = new Map<string, Map<string, unknown>>();
  const namespace = {
    idFromName: (id: string) => id,
    get(id: string) {
      if (!objects.has(id)) {
        const data = snapshots.get(id) ?? new Map<string, unknown>();
        snapshots.set(id, data);
        let queue: Promise<unknown> = Promise.resolve();
        const storage: DurableObjectStorage = {
          get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
          put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); },
          delete: async (key: string) => data.delete(key),
          transaction<T>(callback: (store: DurableObjectStorage) => Promise<T>): Promise<T> {
            const result = queue.then(() => callback(storage));
            queue = result.catch(() => undefined);
            return result;
          },
        };
        objects.set(id, new MeetingStateDurableObject({ storage } as any, {}));
      }
      return objects.get(id)!;
    },
  };
  const service = () => new MeetingService(new DurableMeetingRepository(namespace), new NullMediaProvider());
  return { namespace, service, restart: () => objects.clear() };
}

describe("BT-V0-009 host management", () => {
  it("persists removal across restart, blocks rejoin in every mode, and preserves other guests", async () => {
    const fixture = durableFixture();
    const service = fixture.service();
    const meeting = await service.createMeeting({ title: "Controls", hostUserId: "host", accessMode: "OPEN" });
    await service.joinMeeting(meeting.id, { userId: "guest", displayName: "Guest" });
    await service.joinMeeting(meeting.id, { userId: "other", displayName: "Other" });
    await expect(service.removeParticipant(meeting.id, "other", "guest")).rejects.toThrow("Only the host");
    await expect(service.removeParticipant(meeting.id, "host", "host")).rejects.toThrow("Only the host");
    await service.removeParticipant(meeting.id, "host", "guest");
    fixture.restart();
    const restored = fixture.service();
    for (const mode of ["OPEN", "HOST_APPROVAL", "LOCKED"]) {
      await restored.changeAccessMode(meeting.id, "host", mode);
      await expect(restored.joinMeeting(meeting.id, { userId: "guest", displayName: "Again" })).rejects.toThrow("removed");
      await expect(restored.requestAdmission(meeting.id, { userId: "guest", displayName: "Again" })).rejects.toThrow("removed");
    }
    await restored.leaveMeeting(meeting.id, "guest");
    const state = await restored.getMeeting(meeting.id);
    expect(state?.participants.find(p => p.userId === "guest")?.state).toBe("REMOVED");
    expect(state?.participants.find(p => p.userId === "other")?.state).toBe("JOINED");
  });

  it("blocks approvals while locked and closes pending requests when ended", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new NullMediaProvider());
    const meeting = await service.createMeeting({ title: "Controls", hostUserId: "host" });
    const admission = await service.requestAdmission(meeting.id, { userId: "guest", displayName: "Guest" });
    await expect(service.changeAccessMode(meeting.id, "guest", "LOCKED")).rejects.toThrow("Only the host");
    await expect(service.approveAdmission(meeting.id, "guest", admission.id)).rejects.toThrow("Only the host");
    await expect(service.rejectAdmission(meeting.id, "guest", admission.id)).rejects.toThrow("Only the host");
    await expect(service.endMeeting(meeting.id, "guest")).rejects.toThrow("Only the host");
    await service.changeAccessMode(meeting.id, "host", "LOCKED");
    await expect(service.approveAdmission(meeting.id, "host", admission.id)).rejects.toThrow("locked");
    await service.endMeeting(meeting.id, "host");
    expect(admission.status).toBe("REJECTED");
    await expect(service.changeAccessMode(meeting.id, "host", "OPEN")).rejects.toThrow("Only the host");
    await expect(service.approveAdmission(meeting.id, "host", admission.id)).rejects.toThrow("Only the host");
    await expect(service.removeParticipant(meeting.id, "host", "guest")).rejects.toThrow("Only the host");
  });

  it("preserves approved voluntary leave/rejoin and revokes approval on removal", async () => {
    const service = new MeetingService(new InMemoryMeetingRepository(), new NullMediaProvider());
    const meeting = await service.createMeeting({ title: "Controls", hostUserId: "host" });
    const input = { userId: "guest", displayName: "Guest" };
    const request = await service.requestAdmission(meeting.id, input);
    await service.approveAdmission(meeting.id, "host", request.id);
    await service.leaveMeeting(meeting.id, "guest");
    await service.requestAdmission(meeting.id, input);
    expect(meeting.participants.find(p => p.userId === "guest")?.state).toBe("JOINED");
    await service.removeParticipant(meeting.id, "host", "guest");
    expect(request.status).toBe("REJECTED");
  });

  it("rejects stale and simultaneous durable writes instead of resurrecting ended state", async () => {
    const fixture = durableFixture();
    const service = fixture.service();
    const meeting = await service.createMeeting({ title: "Race", hostUserId: "host" });
    const stale = (await service.getMeeting(meeting.id))!;
    const revision = stale.revision;
    await service.listParticipants(meeting.id);
    expect((await service.getMeeting(meeting.id))?.revision).toBe(revision);
    await service.endMeeting(meeting.id, "host");
    await expect(fixture.namespace.get(meeting.id).saveMeeting(stale)).rejects.toThrow("Refresh");
    expect((await service.getMeeting(meeting.id))?.status).toBe("ended");
    const latest = (await service.getMeeting(meeting.id))!;
    const results = await Promise.allSettled([
      fixture.namespace.get(meeting.id).saveMeeting(latest),
      fixture.namespace.get(meeting.id).saveMeeting(latest),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });

  it("requires explicit host readmission, persists approval, and reuses the same participant after restart", async () => {
    const fixture = durableFixture();
    const service = fixture.service();
    const meeting = await service.createMeeting({ title: "Readmission", hostUserId: "host" });
    const input = { userId: "guest", displayName: "Guest" };
    const request = await service.requestAdmission(meeting.id, input);
    await service.approveAdmission(meeting.id, "host", request.id);
    const participantId = (await service.getMeeting(meeting.id))!.participants.find(p => p.userId === "guest")!.id;
    await service.removeParticipant(meeting.id, "host", "guest");
    await expect(service.readmitParticipant(meeting.id, "guest", "guest")).rejects.toThrow("Only the host");
    await expect(service.joinMeeting(meeting.id, input)).rejects.toThrow("removed");
    await service.changeAccessMode(meeting.id, "host", "LOCKED");
    await expect(service.readmitParticipant(meeting.id, "host", "guest")).rejects.toThrow("locked");
    await service.changeAccessMode(meeting.id, "host", "HOST_APPROVAL");
    await service.readmitParticipant(meeting.id, "host", "guest");
    fixture.restart();
    const restored = fixture.service();
    const before = (await restored.getMeeting(meeting.id))!;
    expect(before.participants.find(p => p.userId === "guest")?.state).toBe("LEFT");
    expect(before.accessRequests.filter(r => r.userId === "guest")).toEqual([expect.objectContaining({
      status: "APPROVED", reviewedByUserId: "host",
    })]);
    expect((await restored.requestAdmission(meeting.id, input)).status).toBe("APPROVED");
    const joined = await restored.joinMeeting(meeting.id, input);
    expect(joined.id).toBe(participantId);
    expect((await restored.getMeeting(meeting.id))!.participants.filter(p => p.userId === "guest")).toHaveLength(1);
    await restored.removeParticipant(meeting.id, "host", "guest");
    await expect(restored.joinMeeting(meeting.id, input)).rejects.toThrow("removed");
    await restored.endMeeting(meeting.id, "host");
    await expect(restored.readmitParticipant(meeting.id, "host", "guest")).rejects.toThrow("Only the host");
  });

  it("exposes the removal API with validation and host-role checks", async () => {
    const fixture = durableFixture();
    const env = { MEETING_STORE: fixture.namespace } as any;
    const request = (path: string, method = "GET", cookie?: string, body?: unknown) => app.fetch(new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
    const createSession = async () => {
      const response = await request("/api/session", "POST");
      const payload = await response.json();
      const cookieValue = response.headers.get("Set-Cookie")?.match(/bt_session_v0=([^;]+)/)?.[1];
      if (!cookieValue) throw new Error("Expected secure session cookie.");
      return { userId: payload.data.userId as string, cookie: `bt_session_v0=${cookieValue}` };
    };
    const host = await createSession();
    const guest = await createSession();
    const createdResponse = await request("/api/meetings", "POST", host.cookie, { title: "API", accessMode: "OPEN" });
    const meeting = (await createdResponse.json()).data;
    const joined = await request(`/api/meetings/${meeting.id}/join`, "POST", guest.cookie, { userId: host.userId, displayName: "Guest" });
    expect(joined.status).toBe(200);

    expect((await request(`/api/meetings/${meeting.id}/remove`, "POST", guest.cookie, {})).status).toBe(400);
    expect((await request(`/api/meetings/${meeting.id}/remove`, "POST", guest.cookie, { actorUserId: host.userId, targetUserId: guest.userId })).status).toBe(403);
    const result = await request(`/api/meetings/${meeting.id}/remove`, "POST", host.cookie, { actorUserId: guest.userId, targetUserId: guest.userId });
    expect(result.status).toBe(200);
    const payload = await result.json() as { data: Meeting };
    expect(payload.data.participants.find(p => p.userId === guest.userId)?.state).toBe("REMOVED");
    const originalLink = `/ui?meeting=${meeting.id}`;
    expect((await request(originalLink, "GET", guest.cookie)).status).toBe(200);
    expect((await request(`/api/meetings/${meeting.id}/join`, "POST", guest.cookie, { displayName: "Guest" })).status).toBe(400);
    expect((await request(`/api/meetings/${meeting.id}/readmit`, "POST", undefined, { actorUserId: host.userId, targetUserId: guest.userId })).status).toBe(403);
    expect((await request(`/api/meetings/${meeting.id}/readmit`, "POST", guest.cookie, { actorUserId: host.userId, targetUserId: guest.userId })).status).toBe(403);
    expect((await request(`/api/meetings/${meeting.id}/readmit`, "POST", host.cookie, {})).status).toBe(400);
    expect((await request(`/api/meetings/${meeting.id}/readmit`, "POST", host.cookie, { targetUserId: host.userId })).status).toBe(403);
    expect((await request(`/api/meetings/${meeting.id}/readmit`, "POST", host.cookie, { targetUserId: guest.userId })).status).toBe(200);
    fixture.restart();
    expect((await request(originalLink, "GET", guest.cookie)).status).toBe(200);
    const snapshot = await (await request(`/api/meetings/${meeting.id}`, "GET", guest.cookie)).json();
    expect(snapshot.viewer.userId).toBe(guest.userId);
    expect(snapshot.data.participants[0].state).toBe("LEFT");
    const rejoined = await request(`/api/meetings/${meeting.id}/join`, "POST", guest.cookie, { userId: host.userId, displayName: "Guest" });
    expect(rejoined.status).toBe(200);
    expect((await rejoined.json()).data.id).toBe((await joined.json()).data.id);
    expect((await fixture.service().getMeeting(meeting.id))!.participants.filter(p => p.userId === guest.userId)).toHaveLength(1);
    expect((await request(`/api/meetings/${meeting.id}/leave`, "POST", guest.cookie)).status).toBe(200);
    const voluntaryRejoin = await request(`/api/meetings/${meeting.id}/join`, "POST", guest.cookie, { displayName: "Guest" });
    expect(voluntaryRejoin.status).toBe(200);
    expect((await voluntaryRejoin.json()).data.id).toBe((await fixture.service().getMeeting(meeting.id))!.participants.find(p => p.userId === guest.userId)!.id);
  });
});
