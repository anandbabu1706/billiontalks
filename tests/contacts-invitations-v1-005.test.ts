import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

import type { AccountEmailSender } from "../src/account/email-delivery";
import type { D1AccountDatabase, D1AccountStatement } from "../src/account/repository";
import app from "../src/index";
import { handleContactsRequest, handleInvitationsRequest } from "../src/contacts/api";
import { contactsPage, rsvpPage } from "../src/contacts/ui";
import { calendarPage } from "../src/calendar/ui";
import { dashboardPage } from "../src/dashboard/ui";
import { schedulerPreviewPage } from "../src/scheduler/ui";

type Schedule = {
  meeting_id: string;
  owner_account_id: string;
  title: string;
  starts_at: string;
  time_zone: string;
  duration_minutes: number;
  guest_access: string;
  status: string;
};

type Contact = {
  contact_id: string;
  owner_account_id: string;
  display_name: string;
  email_normalized: string;
  created_at: string;
  updated_at: string;
};

type Invitation = {
  invitation_id: string;
  meeting_id: string;
  owner_account_id: string;
  contact_id: string | null;
  recipient_email: string;
  recipient_name: string;
  token_hash: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED";
  delivery_status: "PENDING" | "SENT" | "FAILED";
  expires_at: string;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};

function databaseFixture() {
  const contacts = new Map<string, Contact>();
  const schedules = new Map<string, Schedule>();
  const invitations = new Map<string, Invitation>();
  schedules.set("btm_owner_schedule_01", {
    meeting_id: "btm_owner_schedule_01",
    owner_account_id: "owner-1",
    title: "Private planning",
    starts_at: "2026-11-15T18:00:00.000Z",
    time_zone: "America/New_York",
    duration_minutes: 60,
    guest_access: "LOCKED",
    status: "SCHEDULED",
  });
  schedules.set("btm_other_schedule_01", {
    meeting_id: "btm_other_schedule_01",
    owner_account_id: "owner-2",
    title: "Other account meeting",
    starts_at: "2026-11-15T18:00:00.000Z",
    time_zone: "UTC",
    duration_minutes: 60,
    guest_access: "OPEN",
    status: "SCHEDULED",
  });

  const database: D1AccountDatabase = {
    prepare(query: string) {
      const state = { values: [] as unknown[] };
      let statement: D1AccountStatement;
      statement = {
        bind(...values: unknown[]) { state.values = values; return statement; },
        async first<T>() {
          const values = state.values;
          let result: unknown = null;
          if (query.includes("FROM contacts WHERE contact_id = ?")) {
            const row = contacts.get(values[0] as string);
            if (row?.owner_account_id === values[1]) result = { ...row };
          } else if (query.includes("FROM scheduled_meetings WHERE meeting_id = ? AND owner_account_id = ?")) {
            const row = schedules.get(values[0] as string);
            if (row?.owner_account_id === values[1]) result = { ...row };
          } else if (query.includes("WHERE i.invitation_id = ? AND i.owner_account_id = ?")) {
            const row = invitations.get(values[0] as string);
            if (row && row.owner_account_id === values[1]) result = joined(row);
          } else if (query.includes("WHERE i.token_hash = ?")) {
            const row = [...invitations.values()].find((entry) => entry.token_hash === values[0]);
            if (row) result = publicJoined(row);
          }
          return result as T | null;
        },
        async all<T>() {
          const owner = state.values[0];
          if (query.includes("FROM contacts")) {
            return { results: [...contacts.values()].filter((row) => row.owner_account_id === owner).map((row) => ({ ...row }) as T) };
          }
          if (query.includes("FROM meeting_invitations")) {
            return { results: [...invitations.values()]
              .filter((row) => row.owner_account_id === owner)
              .map((row) => joined(row) as T) };
          }
          return { results: [] };
        },
        async run() {
          const values = state.values;
          if (query.includes("INSERT INTO contacts")) {
            const [contact_id, owner_account_id, display_name, email_normalized, created_at, updated_at] = values as [string, string, string, string, string, string];
            if ([...contacts.values()].some((row) => row.owner_account_id === owner_account_id && row.email_normalized === email_normalized)) {
              throw new Error("UNIQUE constraint failed: contacts.owner_account_id, contacts.email_normalized");
            }
            contacts.set(contact_id, { contact_id, owner_account_id, display_name, email_normalized, created_at, updated_at });
            return { meta: { changes: 1 } };
          }
          if (query.includes("UPDATE contacts")) {
            const [display_name, email_normalized, updated_at, id, owner] = values as [string, string, string, string, string];
            const row = contacts.get(id);
            if (!row || row.owner_account_id !== owner) return { meta: { changes: 0 } };
            if ([...contacts.values()].some((contact) => contact.contact_id !== id && contact.owner_account_id === owner && contact.email_normalized === email_normalized)) {
              throw new Error("UNIQUE constraint failed: contacts.owner_account_id, contacts.email_normalized");
            }
            row.display_name = display_name;
            row.email_normalized = email_normalized;
            row.updated_at = updated_at;
            return { meta: { changes: 1 } };
          }
          if (query.includes("DELETE FROM contacts")) {
            const [id, owner] = values as [string, string];
            const row = contacts.get(id);
            if (!row || row.owner_account_id !== owner) return { meta: { changes: 0 } };
            contacts.delete(id);
            return { meta: { changes: 1 } };
          }
          if (query.includes("INSERT INTO meeting_invitations")) {
            const [invitation_id, meeting_id, owner_account_id, contact_id, recipient_email, recipient_name, token_hash, expires_at, created_at, updated_at] =
              values as [string, string, string, string | null, string, string, string, string, string, string];
            if ([...invitations.values()].some((row) => row.meeting_id === meeting_id && row.recipient_email === recipient_email)) {
              throw new Error("UNIQUE constraint failed: meeting_invitations.meeting_id, meeting_invitations.recipient_email");
            }
            invitations.set(invitation_id, {
              invitation_id, meeting_id, owner_account_id, contact_id, recipient_email, recipient_name, token_hash,
              status: "PENDING", delivery_status: "PENDING", expires_at, responded_at: null, created_at, updated_at,
            });
            return { meta: { changes: 1 } };
          }
          if (query.includes("SET delivery_status = 'SENT'") || query.includes("SET delivery_status = 'FAILED'")) {
            const [updated_at, id] = values as [string, string];
            const row = invitations.get(id);
            if (!row) return { meta: { changes: 0 } };
            row.delivery_status = query.includes("'SENT'") ? "SENT" : "FAILED";
            row.updated_at = updated_at;
            return { meta: { changes: 1 } };
          }
          if (query.includes("SET token_hash = ?, delivery_status = 'PENDING'")) {
            const [token_hash, expires_at, updated_at, id, owner, meetingId, meetingOwner] = values as [string, string, string, string, string, string, string];
            const row = invitations.get(id);
            const schedule = schedules.get(meetingId);
            if (!row || row.owner_account_id !== owner || row.status !== "PENDING" ||
              !schedule || schedule.owner_account_id !== meetingOwner || schedule.status !== "SCHEDULED") return { meta: { changes: 0 } };
            row.token_hash = token_hash;
            row.expires_at = expires_at;
            row.updated_at = updated_at;
            row.delivery_status = "PENDING";
            return { meta: { changes: 1 } };
          }
          if (query.includes("UPDATE meeting_invitations SET status = ?")) {
            const [status, responded_at, updated_at, token_hash, now] = values as [Invitation["status"], string, string, string, string];
            const row = [...invitations.values()].find((entry) => entry.token_hash === token_hash);
            const schedule = row && schedules.get(row.meeting_id);
            if (!row || row.status !== "PENDING" || row.expires_at <= now ||
              !schedule || !["SCHEDULED", "STARTING", "STARTED"].includes(schedule.status)) return { meta: { changes: 0 } };
            row.status = status;
            row.responded_at = responded_at;
            row.updated_at = updated_at;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return statement;
    },
    async batch() { return []; },
  };

  function joined(row: Invitation): Record<string, unknown> {
    const schedule = schedules.get(row.meeting_id)!;
    return {
      invitation_id: row.invitation_id, meeting_id: row.meeting_id, meeting_title: schedule.title,
      starts_at: schedule.starts_at, time_zone: schedule.time_zone, duration_minutes: schedule.duration_minutes,
      guest_access: schedule.guest_access, meeting_status: schedule.status, recipient_name: row.recipient_name,
      recipient_email: row.recipient_email, status: row.status, delivery_status: row.delivery_status,
      expires_at: row.expires_at, responded_at: row.responded_at, created_at: row.created_at,
    };
  }
  function publicJoined(row: Invitation): Record<string, unknown> {
    const schedule = schedules.get(row.meeting_id)!;
    return {
      invitation_id: row.invitation_id, meeting_id: row.meeting_id, meeting_title: schedule.title,
      starts_at: schedule.starts_at, time_zone: schedule.time_zone, duration_minutes: schedule.duration_minutes,
      guest_access: schedule.guest_access, meeting_status: schedule.status, status: row.status, expires_at: row.expires_at,
    };
  }
  return { database, contacts, schedules, invitations };
}

const now = new Date("2026-10-13T00:00:00.000Z");
function request(path: string, method: string, body?: unknown): Request {
  return new Request(`https://meet.example${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("BT-V1-005 contacts, invitations, and RSVP", () => {
  it("isolates contact CRUD by owner and prevents duplicate identities", async () => {
    const { database } = databaseFixture();
    expect((await handleContactsRequest(request("/api/contacts", "GET"), null, database, now)).status).toBe(401);
    const createdResponse = await handleContactsRequest(request("/api/contacts", "POST", {
      displayName: "  Ada Lovelace ", email: "ADA@example.test",
    }), "owner-1", database, now);
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json() as { data: { id: string; email: string } }).data;
    expect(created.email).toBe("ada@example.test");
    expect((await handleContactsRequest(request("/api/contacts", "GET"), "owner-2", database, now)).status).toBe(200);
    const otherOwnerList = await handleContactsRequest(request("/api/contacts", "GET"), "owner-2", database, now);
    expect((await otherOwnerList.json() as { data: unknown[] }).data).toEqual([]);
    expect((await handleContactsRequest(request("/api/contacts", "POST", {
      displayName: "Duplicate", email: "ada@example.test",
    }), "owner-1", database, now)).status).toBe(409);
    expect((await handleContactsRequest(request(`/api/contacts/${created.id}`, "PUT", {
      displayName: "Ada Byron", email: "ada@example.test",
    }), "owner-2", database, now)).status).toBe(404);
    expect((await handleContactsRequest(request(`/api/contacts/${created.id}`, "DELETE"), "owner-1", database, now)).status).toBe(200);
  });

  it("sends recipient-specific tokens, supports RSVP, and preserves room access policy", async () => {
    const fixture = databaseFixture();
    const { database, schedules, invitations } = fixture;
    const contactResponse = await handleContactsRequest(request("/api/contacts", "POST", {
      displayName: "Guest Person", email: "guest@example.test",
    }), "owner-1", database, now);
    const contact = (await contactResponse.json() as { data: { id: string } }).data;
    let deliveredToken = "";
    const mailer: AccountEmailSender = {
      sendVerification: async () => undefined,
      sendPasswordReset: async () => undefined,
      sendMeetingInvitation: async (_email, _title, token) => { deliveredToken = token; },
    };
    const response = await handleInvitationsRequest(
      request("/api/schedules/btm_owner_schedule_01/invitations", "POST", { contactId: contact.id }),
      "owner-1", database, mailer, now,
    );
    expect(response.status).toBe(201);
    const created = (await response.json() as { data: Record<string, unknown> }).data;
    expect(created.deliveryStatus).toBe("SENT");
    expect(created.status).toBe("PENDING");
    expect(created.recipientEmail).toBe("guest@example.test");
    expect(deliveredToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect([...invitations.values()][0].token_hash).not.toBe(deliveredToken);

    const lookup = await handleInvitationsRequest(request("/api/invitations/lookup", "POST", { token: deliveredToken }), null, database, null, now);
    expect(lookup.status).toBe(200);
    const safe = await lookup.json() as { data: Record<string, unknown> };
    expect(safe.data.meetingId).toBe("btm_owner_schedule_01");
    expect(safe.data.guestAccess).toBe("LOCKED");
    expect(safe.data).not.toHaveProperty("recipientEmail");
    expect(safe.data).not.toHaveProperty("ownerAccountId");

    const accepted = await handleInvitationsRequest(request("/api/invitations/respond", "POST", {
      token: deliveredToken, response: "ACCEPTED",
    }), null, database, null, now);
    expect(accepted.status).toBe(200);
    expect((await accepted.json() as { data: { status: string; guestAccess: string } }).data).toMatchObject({
      status: "ACCEPTED", guestAccess: "LOCKED",
    });
    const changedResponse = await handleInvitationsRequest(request("/api/invitations/respond", "POST", {
      token: deliveredToken, response: "DECLINED",
    }), null, database, null, now);
    expect(changedResponse.status).toBe(409);
    expect(schedules.get("btm_owner_schedule_01")?.guest_access).toBe("LOCKED");
  });

  it("rejects unauthorized, duplicate, failed-delivery, ended-meeting, and cancelled-meeting invitation actions", async () => {
    const fixture = databaseFixture();
    const { database, schedules, invitations } = fixture;
    const mailer: AccountEmailSender = {
      sendVerification: async () => undefined,
      sendPasswordReset: async () => undefined,
      sendMeetingInvitation: async () => { throw new Error("provider failure"); },
    };
    expect((await handleInvitationsRequest(request("/api/schedules/btm_owner_schedule_01/invitations", "POST", {
      email: "guest@example.test",
    }), null, database, mailer, now)).status).toBe(401);
    expect((await handleInvitationsRequest(request("/api/schedules/btm_other_schedule_01/invitations", "POST", {
      email: "guest@example.test",
    }), "owner-1", database, mailer, now)).status).toBe(404);

    const failed = await handleInvitationsRequest(request("/api/schedules/btm_owner_schedule_01/invitations", "POST", {
      email: "guest@example.test",
    }), "owner-1", database, mailer, now);
    expect(failed.status).toBe(502);
    expect((await failed.json() as { data: { deliveryStatus: string } }).data.deliveryStatus).toBe("FAILED");
    expect((await handleInvitationsRequest(request("/api/schedules/btm_owner_schedule_01/invitations", "POST", {
      email: "guest@example.test",
    }), "owner-1", database, mailer, now)).status).toBe(409);

    const invite = [...invitations.values()][0];
    const responseToken = "A".repeat(43);
    invite.token_hash = await sha256(responseToken);
    schedules.get(invite.meeting_id)!.status = "CANCELLED";
    const cancelledLookup = await handleInvitationsRequest(
      request("/api/invitations/lookup", "POST", { token: responseToken }), null, database, null, now,
    );
    expect(cancelledLookup.status).toBe(410);
    const cancelledRsvp = await handleInvitationsRequest(
      request("/api/invitations/respond", "POST", { token: responseToken, response: "ACCEPTED" }), null, database, null, now,
    );
    expect(cancelledRsvp.status).toBe(410);
    expect(invite.status).toBe("PENDING");

    schedules.get(invite.meeting_id)!.status = "ENDED";
    const endedRsvp = await handleInvitationsRequest(
      request("/api/invitations/respond", "POST", { token: responseToken, response: "DECLINED" }), null, database, null, now,
    );
    expect(endedRsvp.status).toBe(410);
  });

  it("keeps invitation tokens out of URLs sent to recipients and wires existing workspaces", async () => {
    const contacts = contactsPage();
    const rsvp = rsvpPage();
    expect(contacts).toContain("/api/schedules/'+encodeURIComponent(meetingId)+'/invitations");
    expect(contacts).toContain("deliveryStatus");
    expect(rsvp).toContain("location.hash");
    expect(rsvp).toContain("history.replaceState");
    expect(rsvp).toContain("/api/invitations/respond");
    expect(rsvp).not.toContain("searchParams.get('token')");
    expect(calendarPage()).toContain("fetch('/api/invitations'");
    expect(dashboardPage()).toContain('href="/contacts"');
    expect(schedulerPreviewPage()).toContain('href="/contacts?meeting=');

    const page = await app.fetch(new Request("https://meet.example/rsvp"));
    expect(page.status).toBe(200);
    expect(page.headers.get("Referrer-Policy")).toBe("no-referrer");
    const csrf = await app.fetch(new Request("https://meet.example/api/invitations/respond", {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ token: "A".repeat(43), response: "ACCEPTED" }),
    }), { ACCOUNT_DB: databaseFixture().database });
    expect(csrf.status).toBe(403);
  });

  it("opens the exact scheduled meeting from an accepted invitation link", async () => {
    const token = "A".repeat(43);
    const meetingId = "btm_owner_schedule_01";
    const dom = new JSDOM(rsvpPage(), {
      runScripts: "dangerously",
      url: `https://meet.example/rsvp#token=${token}`,
      beforeParse(window) {
        Object.defineProperty(window, "fetch", {
          value: async (input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body || "{}")) as { response?: string };
            const data = {
              meetingId,
              meetingTitle: "Private planning",
              startsAt: "2026-11-15T18:00:00.000Z",
              timeZone: "America/New_York",
              durationMinutes: 60,
              guestAccess: "HOST_APPROVAL",
              meetingStatus: body.response ? "STARTED" : "SCHEDULED",
              status: body.response || "PENDING",
              expiresAt: "2026-11-16T00:00:00.000Z",
            };
            return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
          },
        });
      },
    });
    try {
      const { document, MouseEvent } = dom.window;
      for (let attempt = 0; attempt < 20 && document.getElementById("actions")?.hidden; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(document.getElementById("actions")?.hidden).toBe(false);
      document.querySelector<HTMLButtonElement>('[data-response="ACCEPTED"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      for (let attempt = 0; attempt < 20 && document.getElementById("meetingLink")?.hidden; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const meetingLink = document.getElementById("meetingLink") as HTMLAnchorElement;
      expect(meetingLink.hidden).toBe(false);
      expect(meetingLink.href).toBe(`https://meet.example/?meeting=${meetingId}`);
      expect(document.getElementById("details")?.textContent).toContain("host approval");
    } finally {
      dom.window.close();
    }
  });
});

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
