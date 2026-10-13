import type { D1AccountDatabase, D1AccountStatement } from "../account/repository";

export type AccountPreferences = {
  timeZone: string;
  timeZoneExplicit: boolean;
  defaultDurationMinutes: number;
  defaultGuestAccess: "OPEN" | "HOST_APPROVAL" | "LOCKED";
  notifyMeetingEvents: boolean;
  notifyInvitationEvents: boolean;
};

export type AccountNotification = {
  id: string;
  category: "MEETING" | "INVITATION";
  title: string;
  body: string;
  meetingId: string | null;
  isRead: boolean;
  createdAt: string;
};

type PreferenceRow = {
  time_zone: string;
  time_zone_explicit: number;
  default_duration_minutes: number;
  default_guest_access: AccountPreferences["defaultGuestAccess"];
  notify_meeting_events: number;
  notify_invitation_events: number;
};

type NotificationRow = {
  notification_id: string;
  category: AccountNotification["category"];
  title: string;
  body: string;
  meeting_id: string | null;
  is_read: number;
  created_at: string;
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function all<T>(statement: D1AccountStatement): Promise<{ results: T[] }> {
  if (!statement.all) throw new Error("The D1 database does not support listing records.");
  return statement.all<T>();
}

function mapPreferences(row: PreferenceRow): AccountPreferences {
  return {
    timeZone: row.time_zone,
    timeZoneExplicit: row.time_zone_explicit === 1,
    defaultDurationMinutes: row.default_duration_minutes,
    defaultGuestAccess: row.default_guest_access,
    notifyMeetingEvents: row.notify_meeting_events === 1,
    notifyInvitationEvents: row.notify_invitation_events === 1,
  };
}

function mapNotification(row: NotificationRow): AccountNotification {
  return {
    id: row.notification_id,
    category: row.category,
    title: row.title,
    body: row.body,
    meetingId: row.meeting_id,
    isRead: row.is_read === 1,
    createdAt: row.created_at,
  };
}

function defaultPreferences(): AccountPreferences {
  return {
    timeZone: "UTC",
    timeZoneExplicit: false,
    defaultDurationMinutes: 60,
    defaultGuestAccess: "HOST_APPROVAL",
    notifyMeetingEvents: true,
    notifyInvitationEvents: true,
  };
}

function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    const parsed: unknown = JSON.parse(text + decoder.decode());
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function ensureAccountSettings(database: D1AccountDatabase, accountId: string, now: string): Promise<void> {
  await database.batch([
    database.prepare(
      `INSERT OR IGNORE INTO account_preferences (account_id, updated_at)
       SELECT id, ? FROM accounts WHERE id = ?`,
    ).bind(now, accountId),
    database.prepare(
      `INSERT OR IGNORE INTO account_entitlements (account_id, updated_at)
       SELECT id, ? FROM accounts WHERE id = ?`,
    ).bind(now, accountId),
  ]);
}

export async function handlePreferencesRequest(
  request: Request,
  accountId: string | null,
  database?: D1AccountDatabase,
  now = new Date(),
): Promise<Response> {
  if (!database) return json({ ok: false, error: "Account settings are temporarily unavailable." }, 503);
  if (!accountId) return json({ ok: false, error: "Sign in to manage account settings." }, 401);
  if (new URL(request.url).pathname !== "/api/preferences") return json({ ok: false, error: "Not found." }, 404);

  try {
    await ensureAccountSettings(database, accountId, now.toISOString());
    if (request.method === "GET") {
      const [preferences, entitlement] = await Promise.all([
        database.prepare(
          `SELECT time_zone, time_zone_explicit, default_duration_minutes, default_guest_access,
            notify_meeting_events, notify_invitation_events
           FROM account_preferences WHERE account_id = ?`,
        ).bind(accountId).first<PreferenceRow>(),
        database.prepare(
          "SELECT plan_code, status FROM account_entitlements WHERE account_id = ?",
        ).bind(accountId).first<{ plan_code: string; status: string }>(),
      ]);
      if (!entitlement) return json({ ok: false, error: "Account entitlements are unavailable." }, 500);
      return json({
        ok: true,
        data: {
          preferences: preferences ? mapPreferences(preferences) : defaultPreferences(),
          entitlement: { planCode: entitlement.plan_code, status: entitlement.status },
        },
      });
    }
    if (request.method !== "PUT") return json({ ok: false, error: "Method not allowed." }, 405);

    const body = await readJson(request);
    if (
      !body ||
      !validTimeZone(body.timeZone) ||
      typeof body.defaultDurationMinutes !== "number" ||
      !Number.isSafeInteger(body.defaultDurationMinutes) ||
      ![30, 45, 60, 90, 120].includes(body.defaultDurationMinutes) ||
      !["OPEN", "HOST_APPROVAL", "LOCKED"].includes(String(body.defaultGuestAccess)) ||
      typeof body.notifyMeetingEvents !== "boolean" ||
      typeof body.notifyInvitationEvents !== "boolean"
    ) {
      return json({ ok: false, error: "Valid account, meeting, and notification preferences are required." }, 400);
    }
    await database.prepare(
      `UPDATE account_preferences SET time_zone = ?, time_zone_explicit = 1, default_duration_minutes = ?, default_guest_access = ?,
        notify_meeting_events = ?, notify_invitation_events = ?, updated_at = ? WHERE account_id = ?`,
    ).bind(
      body.timeZone,
      Number(body.defaultDurationMinutes),
      body.defaultGuestAccess,
      Number(body.notifyMeetingEvents),
      Number(body.notifyInvitationEvents),
      now.toISOString(),
      accountId,
    ).run();
    return json({
      ok: true,
      data: {
        timeZone: body.timeZone,
        timeZoneExplicit: true,
        defaultDurationMinutes: body.defaultDurationMinutes,
        defaultGuestAccess: body.defaultGuestAccess,
        notifyMeetingEvents: body.notifyMeetingEvents,
        notifyInvitationEvents: body.notifyInvitationEvents,
      },
    });
  } catch (error) {
    console.error("Account preferences request failed.", error);
    return json({ ok: false, error: "Unable to complete the account settings request." }, 500);
  }
}

export async function createAccountNotification(
  database: D1AccountDatabase,
  input: {
    accountId: string;
    eventKey: string;
    category: AccountNotification["category"];
    title: string;
    body: string;
    meetingId: string;
    createdAt: string;
  },
): Promise<void> {
  if (!input.eventKey || input.eventKey.length > 200) throw new Error("A valid notification event key is required.");
  await database.prepare(
    `INSERT INTO account_notifications (
      notification_id, account_id, event_key, category, title, body, meeting_id, is_read, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, 0, ?
    WHERE EXISTS (SELECT 1 FROM accounts WHERE id = ?)
      AND COALESCE((
        SELECT CASE WHEN ? = 'MEETING' THEN notify_meeting_events ELSE notify_invitation_events END
        FROM account_preferences WHERE account_id = ?
      ), 1) = 1
    ON CONFLICT(account_id, event_key) DO NOTHING`,
  ).bind(
    `btn_${crypto.randomUUID()}`,
    input.accountId,
    input.eventKey,
    input.category,
    input.title.slice(0, 120),
    input.body.slice(0, 500),
    input.meetingId,
    input.createdAt,
    input.accountId,
    input.category,
    input.accountId,
  ).run();
}

export async function handleNotificationsRequest(
  request: Request,
  accountId: string | null,
  database?: D1AccountDatabase,
  now = new Date(),
): Promise<Response> {
  if (!database) return json({ ok: false, error: "Notifications are temporarily unavailable." }, 503);
  if (!accountId) return json({ ok: false, error: "Sign in to view notifications." }, 401);
  const url = new URL(request.url);
  const match = /^\/api\/notifications\/(btn_[A-Za-z0-9_-]{8,64})$/.exec(url.pathname);
  try {
    if (url.pathname === "/api/notifications" && request.method === "GET") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
      const [notifications, unread] = await Promise.all([
        all<NotificationRow>(database.prepare(
          `SELECT notification_id, category, title, body, meeting_id, is_read, created_at
           FROM account_notifications WHERE account_id = ? ORDER BY created_at DESC LIMIT ?`,
        ).bind(accountId, limit)),
        database.prepare(
          "SELECT COUNT(*) AS count FROM account_notifications WHERE account_id = ? AND is_read = 0",
        ).bind(accountId).first<{ count: number }>(),
      ]);
      return json({ ok: true, data: { notifications: notifications.results.map(mapNotification), unreadCount: unread?.count ?? 0 } });
    }
    if (url.pathname === "/api/notifications/read-all" && request.method === "POST") {
      await database.prepare(
        "UPDATE account_notifications SET is_read = 1 WHERE account_id = ? AND is_read = 0",
      ).bind(accountId).run();
      return json({ ok: true, data: { read: true } });
    }
    if (match && request.method === "PATCH") {
      const body = await readJson(request);
      if (!body || typeof body.isRead !== "boolean") return json({ ok: false, error: "A read state is required." }, 400);
      const result = await database.prepare(
        "UPDATE account_notifications SET is_read = ? WHERE notification_id = ? AND account_id = ?",
      ).bind(Number(body.isRead), match[1], accountId).run() as { meta?: { changes?: number } };
      return result.meta?.changes === 1
        ? json({ ok: true, data: { id: match[1], isRead: body.isRead } })
        : json({ ok: false, error: "Notification not found." }, 404);
    }
    return json({ ok: false, error: "Not found." }, 404);
  } catch (error) {
    console.error("Notifications request failed.", error);
    return json({ ok: false, error: "Unable to complete the notifications request." }, 500);
  }
}
