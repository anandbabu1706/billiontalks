import type { DurableObjectStorage } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app, { MeetingStateDurableObject } from "../src/index";
import { DurableMeetingRepository, InMemoryMeetingRepository, MeetingService, NullMediaProvider, type Meeting } from "../src/meeting";

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

  it("exposes the removal API with validation and host-role checks", async () => {
    const fixture = durableFixture();
    const service = fixture.service();
    const meeting = await service.createMeeting({ title: "API", hostUserId: "host", accessMode: "OPEN" });
    await service.joinMeeting(meeting.id, { userId: "guest", displayName: "Guest" });
    const remove = (body: unknown) => app.fetch(new Request(`http://localhost/api/meetings/${meeting.id}/remove`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), { MEETING_STORE: fixture.namespace } as any);
    expect((await remove({})).status).toBe(400);
    expect((await remove({ actorUserId: "guest", targetUserId: "host" })).status).toBe(403);
    const result = await remove({ actorUserId: "host", targetUserId: "guest" });
    expect(result.status).toBe(200);
    const payload = await result.json() as { data: Meeting };
    expect(payload.data.participants.find(p => p.userId === "guest")?.state).toBe("REMOVED");
  });
});
