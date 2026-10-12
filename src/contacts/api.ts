import { normalizeEmail, normalizeFullName, AccountValidationError } from "../account/validation";
import type { AccountEmailSender } from "../account/email-delivery";
import type { D1AccountDatabase, D1AccountStatement } from "../account/repository";

export type ContactRecord = {
  id: string;
  displayName: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

export type InvitationRecord = {
  id: string;
  meetingId: string;
  meetingTitle: string;
  startsAt: string;
  timeZone: string;
  durationMinutes: number;
  guestAccess: string;
  meetingStatus: string;
  recipientName: string;
  recipientEmail: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED";
  deliveryStatus: "PENDING" | "SENT" | "FAILED";
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
};

type InvitationRow = {
  invitation_id: string;
  meeting_id: string;
  meeting_title: string;
  starts_at: string;
  time_zone: string;
  duration_minutes: number;
  guest_access: string;
  meeting_status: string;
  recipient_name: string;
  recipient_email: string;
  status: InvitationRecord["status"];
  delivery_status: InvitationRecord["deliveryStatus"];
  expires_at: string;
  responded_at: string | null;
  created_at: string;
};

type PublicInvitationRow = {
  invitation_id: string;
  meeting_id: string;
  meeting_title: string;
  starts_at: string;
  time_zone: string;
  duration_minutes: number;
  guest_access: string;
  meeting_status: string;
  status: InvitationRecord["status"];
  expires_at: string;
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

class ContactRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ContactRequestError";
  }
}

function mapContact(row: Record<string, unknown>): ContactRecord {
  return {
    id: String(row.contact_id),
    displayName: String(row.display_name),
    email: String(row.email_normalized),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapInvitation(row: InvitationRow): InvitationRecord {
  return {
    id: row.invitation_id,
    meetingId: row.meeting_id,
    meetingTitle: row.meeting_title,
    startsAt: row.starts_at,
    timeZone: row.time_zone,
    durationMinutes: row.duration_minutes,
    guestAccess: row.guest_access,
    meetingStatus: row.meeting_status,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    status: row.status,
    deliveryStatus: row.delivery_status,
    expiresAt: row.expires_at,
    respondedAt: row.responded_at,
    createdAt: row.created_at,
  };
}

function all(statement: D1AccountStatement): Promise<{ results: Record<string, unknown>[] }> {
  if (!statement.all) throw new Error("The D1 database does not support listing.");
  return statement.all<Record<string, unknown>>();
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new ContactRequestError("A JSON request body is required.", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ContactRequestError("A JSON request body is required.", 400);
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      throw new ContactRequestError("The request is too large.", 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    const value: unknown = JSON.parse(text + decoder.decode());
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ContactRequestError("The request body is invalid.", 400);
  }
}

function contactInput(body: Record<string, unknown>): { displayName: string; email: string } {
  if (typeof body.displayName !== "string" || typeof body.email !== "string") {
    throw new ContactRequestError("Contact name and email are required.", 400);
  }
  try {
    const displayName = normalizeFullName(body.displayName);
    if (displayName.length > 120) throw new AccountValidationError("Contact name must be 120 characters or fewer.");
    return { displayName, email: normalizeEmail(body.email) };
  } catch (error) {
    if (error instanceof AccountValidationError) throw new ContactRequestError(error.message, 400);
    throw error;
  }
}

function validToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/u.test(token);
}

function encodeToken(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

async function newToken(): Promise<{ token: string; hash: string }> {
  const token = encodeToken(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { token, hash };
}

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function invitationExpiresAt(startsAt: string, durationMinutes: number): string {
  return new Date(Date.parse(startsAt) + durationMinutes * 60_000 + 24 * 60 * 60_000).toISOString();
}

export async function handleContactsRequest(
  request: Request,
  ownerId: string | null,
  database?: D1AccountDatabase,
  now = new Date(),
): Promise<Response> {
  if (!database) return json({ ok: false, error: "Contact management is temporarily unavailable." }, 503);
  if (!ownerId) return json({ ok: false, error: "Sign in to manage contacts." }, 401);
  const url = new URL(request.url);
  const match = /^\/api\/contacts\/(btc_[A-Za-z0-9_-]{8,64})$/.exec(url.pathname);
  if (url.pathname !== "/api/contacts" && !match) return json({ ok: false, error: "Not found." }, 404);

  try {
    if (request.method === "GET" && !match) {
      const result = await all(database.prepare(
        `SELECT contact_id, display_name, email_normalized, created_at, updated_at
         FROM contacts WHERE owner_account_id = ? ORDER BY display_name COLLATE NOCASE`,
      ).bind(ownerId));
      return json({ ok: true, data: result.results.map(mapContact) });
    }
    if (request.method === "POST" && !match) {
      const input = contactInput(await readBody(request));
      const id = `btc_${crypto.randomUUID()}`;
      const timestamp = now.toISOString();
      try {
        await database.prepare(
          `INSERT INTO contacts (contact_id, owner_account_id, display_name, email_normalized, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(id, ownerId, input.displayName, input.email, timestamp, timestamp).run();
      } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
          return json({ ok: false, error: "A contact with this email already exists." }, 409);
        }
        throw error;
      }
      return json({ ok: true, data: { id, ...input, createdAt: timestamp, updatedAt: timestamp } }, 201);
    }
    if (match && request.method === "PUT") {
      const input = contactInput(await readBody(request));
      let result: { meta?: { changes?: number } };
      try {
        result = await database.prepare(
          `UPDATE contacts SET display_name = ?, email_normalized = ?, updated_at = ?
           WHERE contact_id = ? AND owner_account_id = ?`,
        ).bind(input.displayName, input.email, now.toISOString(), match[1], ownerId).run() as { meta?: { changes?: number } };
      } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
          return json({ ok: false, error: "A contact with this email already exists." }, 409);
        }
        throw error;
      }
      if (result.meta?.changes !== 1) return json({ ok: false, error: "Contact not found." }, 404);
      return json({ ok: true, data: { id: match[1], ...input, updatedAt: now.toISOString() } });
    }
    if (match && request.method === "DELETE") {
      const result = await database.prepare(
        "DELETE FROM contacts WHERE contact_id = ? AND owner_account_id = ?",
      ).bind(match[1], ownerId).run() as { meta?: { changes?: number } };
      return result.meta?.changes === 1
        ? json({ ok: true, data: { deleted: true } })
        : json({ ok: false, error: "Contact not found." }, 404);
    }
    return json({ ok: false, error: "Method not allowed." }, 405);
  } catch (error) {
    if (error instanceof ContactRequestError) return json({ ok: false, error: error.message }, error.status);
    console.error("Contact request failed.", error);
    return json({ ok: false, error: "Unable to complete the contact request." }, 500);
  }
}

async function loadInvitation(
  database: D1AccountDatabase,
  invitationId: string,
  ownerId: string,
): Promise<InvitationRow | null> {
  return database.prepare(
    `SELECT i.invitation_id, i.meeting_id, s.title AS meeting_title, s.starts_at, s.time_zone,
      s.duration_minutes, s.guest_access, s.status AS meeting_status, i.recipient_name,
      i.recipient_email, i.status, i.delivery_status, i.expires_at, i.responded_at, i.created_at
     FROM meeting_invitations i JOIN scheduled_meetings s ON s.meeting_id = i.meeting_id
     WHERE i.invitation_id = ? AND i.owner_account_id = ?`,
  ).bind(invitationId, ownerId).first<InvitationRow>();
}

async function deliverInvitation(
  mailer: AccountEmailSender,
  database: D1AccountDatabase,
  invitationId: string,
  recipientEmail: string,
  meetingTitle: string,
  token: string,
  timestamp: string,
): Promise<boolean> {
  if (!mailer.sendMeetingInvitation) return false;
  try {
    await mailer.sendMeetingInvitation(recipientEmail, meetingTitle, token);
    await database.prepare(
      "UPDATE meeting_invitations SET delivery_status = 'SENT', updated_at = ? WHERE invitation_id = ?",
    ).bind(timestamp, invitationId).run();
    return true;
  } catch {
    console.error("[billiontalks invitations] email delivery failed", { category: "provider_failure" });
    await database.prepare(
      "UPDATE meeting_invitations SET delivery_status = 'FAILED', updated_at = ? WHERE invitation_id = ?",
    ).bind(timestamp, invitationId).run();
    return false;
  }
}

async function createInvitation(
  request: Request,
  meetingId: string,
  ownerId: string,
  database: D1AccountDatabase,
  mailer: AccountEmailSender | null,
  now: Date,
): Promise<Response> {
  if (!mailer?.sendMeetingInvitation) return json({ ok: false, error: "Invitation email is not configured." }, 503);
  const schedule = await database.prepare(
    `SELECT title, starts_at, time_zone, duration_minutes, guest_access, status
     FROM scheduled_meetings WHERE meeting_id = ? AND owner_account_id = ?`,
  ).bind(meetingId, ownerId).first<{
    title: string; starts_at: string; time_zone: string; duration_minutes: number; guest_access: string; status: string;
  }>();
  if (!schedule) return json({ ok: false, error: "Scheduled meeting not found." }, 404);
  if (schedule.status !== "SCHEDULED") {
    return json({ ok: false, error: "Invitations can only be sent for scheduled meetings." }, 409);
  }

  const body = await readBody(request);
  let displayName: string;
  let email: string;
  let contactId: string | null = null;
  if (typeof body.contactId === "string") {
    const contact = await database.prepare(
      "SELECT contact_id, display_name, email_normalized FROM contacts WHERE contact_id = ? AND owner_account_id = ?",
    ).bind(body.contactId, ownerId).first<{ contact_id: string; display_name: string; email_normalized: string }>();
    if (!contact) return json({ ok: false, error: "Contact not found." }, 404);
    contactId = contact.contact_id;
    displayName = contact.display_name;
    email = contact.email_normalized;
  } else {
    if (typeof body.email !== "string") throw new ContactRequestError("Guest email is required.", 400);
    try {
      email = normalizeEmail(body.email);
      displayName = typeof body.displayName === "string" && body.displayName.trim()
        ? normalizeFullName(body.displayName)
        : email;
      if (displayName.length > 120) throw new AccountValidationError("Guest name must be 120 characters or fewer.");
    } catch (error) {
      if (error instanceof AccountValidationError) throw new ContactRequestError(error.message, 400);
      throw error;
    }
  }
  if (email.length > 254 || /[\r\n]/u.test(displayName)) throw new ContactRequestError("Guest details are invalid.", 400);
  const timestamp = now.toISOString();
  const expiresAt = invitationExpiresAt(schedule.starts_at, schedule.duration_minutes);
  if (Date.parse(expiresAt) <= now.getTime()) return json({ ok: false, error: "The meeting has already ended." }, 409);
  const id = `bti_${crypto.randomUUID()}`;
  const { token, hash } = await newToken();
  try {
    await database.prepare(
      `INSERT INTO meeting_invitations (
        invitation_id, meeting_id, owner_account_id, contact_id, recipient_email, recipient_name,
        token_hash, status, delivery_status, expires_at, responded_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 'PENDING', ?, NULL, ?, ?)`,
    ).bind(id, meetingId, ownerId, contactId, email, displayName, hash, expiresAt, timestamp, timestamp).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      return json({ ok: false, error: "This email address has already been invited to the meeting." }, 409);
    }
    throw error;
  }
  const sent = await deliverInvitation(mailer, database, id, email, schedule.title, token, timestamp);
  const invitation = await loadInvitation(database, id, ownerId);
  if (!invitation) throw new Error("The invitation could not be read after creation.");
  return sent
    ? json({ ok: true, data: mapInvitation(invitation) }, 201)
    : json({ ok: false, error: "The invitation was created but email delivery failed. Retry delivery from the invitation list.", data: mapInvitation(invitation) }, 502);
}

async function resendInvitation(
  invitationId: string,
  ownerId: string,
  database: D1AccountDatabase,
  mailer: AccountEmailSender | null,
  now: Date,
): Promise<Response> {
  if (!mailer?.sendMeetingInvitation) return json({ ok: false, error: "Invitation email is not configured." }, 503);
  const invitation = await loadInvitation(database, invitationId, ownerId);
  if (!invitation) return json({ ok: false, error: "Invitation not found." }, 404);
  if (invitation.status !== "PENDING" || invitation.meeting_status !== "SCHEDULED") {
    return json({ ok: false, error: "This invitation can no longer be delivered." }, 409);
  }
  const expiresAt = invitationExpiresAt(invitation.starts_at, invitation.duration_minutes);
  if (Date.parse(expiresAt) <= now.getTime()) return json({ ok: false, error: "The meeting has already ended." }, 409);
  const { token, hash } = await newToken();
  const updated = await database.prepare(
    `UPDATE meeting_invitations SET token_hash = ?, delivery_status = 'PENDING', expires_at = ?, updated_at = ?
     WHERE invitation_id = ? AND owner_account_id = ? AND status = 'PENDING'
       AND EXISTS (SELECT 1 FROM scheduled_meetings WHERE meeting_id = ? AND owner_account_id = ? AND status = 'SCHEDULED')`,
  ).bind(hash, expiresAt, now.toISOString(), invitationId, ownerId, invitation.meeting_id, ownerId).run() as { meta?: { changes?: number } };
  if (updated.meta?.changes !== 1) return json({ ok: false, error: "This invitation can no longer be delivered." }, 409);
  const sent = await deliverInvitation(mailer, database, invitationId, invitation.recipient_email, invitation.meeting_title, token, now.toISOString());
  const latest = await loadInvitation(database, invitationId, ownerId);
  if (!latest) throw new Error("The invitation could not be read after redelivery.");
  return sent
    ? json({ ok: true, data: mapInvitation(latest) })
    : json({ ok: false, error: "Invitation email delivery failed. The invitation remains unsent.", data: mapInvitation(latest) }, 502);
}

async function invitationPublicRow(database: D1AccountDatabase, hash: string): Promise<PublicInvitationRow | null> {
  return database.prepare(
    `SELECT i.invitation_id, i.meeting_id, s.title AS meeting_title, s.starts_at, s.time_zone,
      s.duration_minutes, s.guest_access, s.status AS meeting_status, i.status, i.expires_at
     FROM meeting_invitations i JOIN scheduled_meetings s ON s.meeting_id = i.meeting_id
     WHERE i.token_hash = ?`,
  ).bind(hash).first<PublicInvitationRow>();
}

function publicInvitation(row: PublicInvitationRow): Record<string, unknown> {
  return {
    invitationId: row.invitation_id,
    meetingId: row.meeting_id,
    meetingTitle: row.meeting_title,
    startsAt: row.starts_at,
    timeZone: row.time_zone,
    durationMinutes: row.duration_minutes,
    guestAccess: row.guest_access,
    meetingStatus: row.meeting_status,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

export async function handleInvitationsRequest(
  request: Request,
  ownerId: string | null,
  database?: D1AccountDatabase,
  mailer: AccountEmailSender | null = null,
  now = new Date(),
): Promise<Response> {
  if (!database) return json({ ok: false, error: "Invitation services are temporarily unavailable." }, 503);
  const url = new URL(request.url);
  const publicAction = url.pathname === "/api/invitations/lookup" || url.pathname === "/api/invitations/respond";
  if (!publicAction && !ownerId) return json({ ok: false, error: "Sign in to manage invitations." }, 401);
  const invitationMatch = /^\/api\/invitations\/(bti_[A-Za-z0-9_-]{8,64})(?:\/(resend))?$/.exec(url.pathname);
  const meetingMatch = /^\/api\/schedules\/(btm_[A-Za-z0-9_-]{8,64})\/invitations$/.exec(url.pathname);
  try {
    if (request.method === "GET" && url.pathname === "/api/invitations") {
      const result = await all(database.prepare(
        `SELECT i.invitation_id, i.meeting_id, s.title AS meeting_title, s.starts_at, s.time_zone,
          s.duration_minutes, s.guest_access, s.status AS meeting_status, i.recipient_name,
          i.recipient_email, i.status, i.delivery_status, i.expires_at, i.responded_at, i.created_at
         FROM meeting_invitations i JOIN scheduled_meetings s ON s.meeting_id = i.meeting_id
         WHERE i.owner_account_id = ? ORDER BY i.created_at DESC`,
      ).bind(ownerId));
      return json({ ok: true, data: result.results.map((row) => mapInvitation(row as unknown as InvitationRow)) });
    }
    if (request.method === "POST" && meetingMatch) {
      return await createInvitation(request, meetingMatch[1], ownerId!, database, mailer, now);
    }
    if (request.method === "POST" && invitationMatch?.[2] === "resend") {
      return await resendInvitation(invitationMatch[1], ownerId!, database, mailer, now);
    }
    if (request.method === "POST" && url.pathname === "/api/invitations/lookup") {
      const body = await readBody(request);
      if (!validToken(body.token)) throw new ContactRequestError("Invitation token is invalid.", 400);
      const row = await invitationPublicRow(database, await tokenHash(body.token));
      if (!row) return json({ ok: false, error: "Invitation is invalid or unavailable." }, 404);
      if (Date.parse(row.expires_at) <= now.getTime() || ["CANCELLED", "ENDED"].includes(row.meeting_status)) {
        return json({ ok: false, error: "This invitation is no longer available." }, 410);
      }
      return json({ ok: true, data: publicInvitation(row) });
    }
    if (request.method === "POST" && url.pathname === "/api/invitations/respond") {
      const body = await readBody(request);
      if (!validToken(body.token) || !["ACCEPTED", "DECLINED"].includes(String(body.response))) {
        throw new ContactRequestError("Invitation response is invalid.", 400);
      }
      const hash = await tokenHash(body.token);
      const timestamp = now.toISOString();
      const result = await database.prepare(
        `UPDATE meeting_invitations SET status = ?, responded_at = ?, updated_at = ?
         WHERE token_hash = ? AND status = 'PENDING' AND expires_at > ?
           AND EXISTS (SELECT 1 FROM scheduled_meetings
             WHERE scheduled_meetings.meeting_id = meeting_invitations.meeting_id
               AND scheduled_meetings.owner_account_id = meeting_invitations.owner_account_id
               AND scheduled_meetings.status IN ('SCHEDULED', 'STARTING', 'STARTED'))`,
      ).bind(body.response, timestamp, timestamp, hash, timestamp).run() as { meta?: { changes?: number } };
      if (result.meta?.changes !== 1) {
        const row = await invitationPublicRow(database, hash);
        if (!row || Date.parse(row.expires_at) <= now.getTime() || ["CANCELLED", "ENDED"].includes(row.meeting_status)) {
          return json({ ok: false, error: "This invitation is no longer available." }, 410);
        }
        return json({ ok: false, error: "This invitation has already been answered." }, 409);
      }
      const row = await invitationPublicRow(database, hash);
      if (!row) throw new Error("The updated invitation could not be read.");
      return json({ ok: true, data: publicInvitation(row) });
    }
    if (invitationMatch && request.method === "GET" && !invitationMatch[2]) {
      const invitation = await loadInvitation(database, invitationMatch[1], ownerId!);
      return invitation
        ? json({ ok: true, data: mapInvitation(invitation) })
        : json({ ok: false, error: "Invitation not found." }, 404);
    }
    return json({ ok: false, error: "Not found." }, 404);
  } catch (error) {
    if (error instanceof ContactRequestError) return json({ ok: false, error: error.message }, error.status);
    console.error("Invitation request failed.", error);
    return json({ ok: false, error: "Unable to complete the invitation request." }, 500);
  }
}
