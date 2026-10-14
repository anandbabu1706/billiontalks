import { describe, expect, it } from "vitest";

import type { D1AccountDatabase, D1AccountStatement } from "../src/account/repository";
import {
  createAccountNotification,
  handleNotificationsRequest,
  handlePreferencesRequest,
} from "../src/settings/api";
import { accountPage } from "../src/account/ui";
import { dashboardPage } from "../src/dashboard/ui";
import { schedulerPreviewPage } from "../src/scheduler/ui";
import { notificationsPage } from "../src/settings/ui";
import app from "../src/index";

type PreferenceRow = {
  time_zone: string;
  time_zone_explicit: number;
  default_duration_minutes: number;
  default_guest_access: "OPEN" | "HOST_APPROVAL" | "LOCKED";
  notify_meeting_events: number;
  notify_invitation_events: number;
};

type NotificationRow = {
  notification_id: string;
  account_id: string;
  event_key: string;
  category: "MEETING" | "INVITATION";
  title: string;
  body: string;
  meeting_id: string | null;
  is_read: number;
  created_at: string;
};

function settingsDatabase() {
  const accounts = new Set(["account-1", "account-2"]);
  const preferences = new Map<string, PreferenceRow>();
  const notifications = new Map<string, NotificationRow>();
  const entitlements = new Map<string, { plan_code: string; status: string }>();
  const database: D1AccountDatabase = {
    prepare(query: string) {
      const state = { values: [] as unknown[] };
      let statement: D1AccountStatement;
      statement = {
        bind(...values: unknown[]) { state.values = values; return statement; },
        async first<T>() {
          const values = state.values;
          if (query.includes("FROM account_preferences")) return (preferences.get(values[0] as string) ?? null) as T | null;
          if (query.includes("FROM account_entitlements")) return (entitlements.get(values[0] as string) ?? null) as T | null;
          if (query.includes("COUNT(*) AS count")) {
            return { count: [...notifications.values()].filter((row) => row.account_id === values[0] && row.is_read === 0).length } as T;
          }
          return null;
        },
        async all<T>() {
          const [accountId, limit] = state.values as [string, number];
          return {
            results: [...notifications.values()]
              .filter((row) => row.account_id === accountId)
              .sort((left, right) => right.created_at.localeCompare(left.created_at))
              .slice(0, limit)
              .map((row) => ({ ...row }) as T),
          };
        },
        async run() {
          const values = state.values;
          if (query.includes("INSERT OR IGNORE INTO account_preferences")) {
            const [updatedAt, accountId] = values as [string, string];
            if (accounts.has(accountId) && !preferences.has(accountId)) {
              preferences.set(accountId, {
                time_zone: "UTC",
                time_zone_explicit: 0,
                default_duration_minutes: 60,
                default_guest_access: "HOST_APPROVAL",
                notify_meeting_events: 1,
                notify_invitation_events: 1,
              });
            }
          } else if (query.includes("INSERT OR IGNORE INTO account_entitlements")) {
            const [updatedAt, accountId] = values as [string, string];
            if (accounts.has(accountId) && !entitlements.has(accountId)) {
              entitlements.set(accountId, { plan_code: "BASELINE", status: "ACTIVE" });
            }
          } else if (query.includes("UPDATE account_preferences")) {
            const [timeZone, duration, access, meetingEvents, invitationEvents, , accountId] = values as [string, number, PreferenceRow["default_guest_access"], number, number, string, string];
            preferences.set(accountId, {
              time_zone: timeZone,
              time_zone_explicit: 1,
              default_duration_minutes: duration,
              default_guest_access: access,
              notify_meeting_events: meetingEvents,
              notify_invitation_events: invitationEvents,
            });
          } else if (query.includes("INSERT INTO account_notifications")) {
            const [id, accountId, eventKey, category, title, body, meetingId, createdAt, existsAccount, preferenceCategory, preferenceAccountId] = values as [string, string, string, NotificationRow["category"], string, string, string, string, string, NotificationRow["category"], string];
            const prefs = preferences.get(preferenceAccountId);
            const enabled = preferenceCategory === "MEETING" ? prefs?.notify_meeting_events !== 0 : prefs?.notify_invitation_events !== 0;
            if (accounts.has(existsAccount) && enabled && ![...notifications.values()].some((row) => row.account_id === accountId && row.event_key === eventKey)) {
              notifications.set(id, { notification_id: id, account_id: accountId, event_key: eventKey, category, title, body, meeting_id: meetingId, is_read: 0, created_at: createdAt });
            }
          } else if (query.includes("UPDATE account_notifications SET is_read = 1")) {
            const [accountId] = values as [string];
            for (const row of notifications.values()) if (row.account_id === accountId) row.is_read = 1;
          } else if (query.includes("UPDATE account_notifications SET is_read = ?")) {
            const [isRead, notificationId, accountId] = values as [number, string, string];
            const row = notifications.get(notificationId);
            if (row?.account_id === accountId) row.is_read = isRead;
            return { meta: { changes: row?.account_id === accountId ? 1 : 0 } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements) {
      for (const statement of statements) await statement.run();
      return [];
    },
  };
  return { database, notifications, preferences };
}

function request(path: string, method = "GET", body?: unknown): Request {
  return new Request(`https://meet.example${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("BT-V1-007 settings, notifications, and entitlement foundation", () => {
  it("authorizes preference access, saves validated defaults, and exposes non-gating baseline entitlements", async () => {
    const { database, preferences } = settingsDatabase();
    expect((await handlePreferencesRequest(request("/api/preferences"), null, database)).status).toBe(401);

    const initial = await handlePreferencesRequest(request("/api/preferences"), "account-1", database);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      data: {
        preferences: { timeZone: "UTC", timeZoneExplicit: false, defaultDurationMinutes: 60, defaultGuestAccess: "HOST_APPROVAL" },
        entitlement: { planCode: "BASELINE", status: "ACTIVE" },
      },
    });

    const saved = await handlePreferencesRequest(request("/api/preferences", "PUT", {
      timeZone: "Asia/Kolkata",
      defaultDurationMinutes: 90,
      defaultGuestAccess: "OPEN",
      notifyMeetingEvents: false,
      notifyInvitationEvents: true,
    }), "account-1", database);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ data: { timeZone: "Asia/Kolkata", timeZoneExplicit: true } });
    expect(preferences.get("account-1")).toMatchObject({
      time_zone: "Asia/Kolkata",
      time_zone_explicit: 1,
      default_duration_minutes: 90,
      default_guest_access: "OPEN",
      notify_meeting_events: 0,
      notify_invitation_events: 1,
    });
    expect((await handlePreferencesRequest(request("/api/preferences", "PUT", {
      timeZone: "Not/A-Timezone",
      defaultDurationMinutes: 90,
      defaultGuestAccess: "OPEN",
      notifyMeetingEvents: false,
      notifyInvitationEvents: true,
    }), "account-1", database)).status).toBe(400);
  });

  it("stores opted-in meeting updates and RSVP events idempotently and isolates read state by account", async () => {
    const { database, notifications } = settingsDatabase();
    await handlePreferencesRequest(request("/api/preferences"), "account-1", database);
    await handlePreferencesRequest(request("/api/preferences"), "account-2", database);
    const event = {
      accountId: "account-1",
      eventKey: "schedule:btm_example0001:created",
      category: "MEETING" as const,
      title: "Meeting scheduled",
      body: "Planning session was added to your schedule.",
      meetingId: "btm_example0001",
      createdAt: "2026-10-13T00:00:00.000Z",
    };
    await handlePreferencesRequest(request("/api/preferences", "PUT", {
      timeZone: "UTC",
      defaultDurationMinutes: 60,
      defaultGuestAccess: "HOST_APPROVAL",
      notifyMeetingEvents: false,
      notifyInvitationEvents: true,
    }), "account-1", database);
    await createAccountNotification(database, event);
    expect(notifications.size).toBe(0);
    await handlePreferencesRequest(request("/api/preferences", "PUT", {
      timeZone: "UTC",
      defaultDurationMinutes: 60,
      defaultGuestAccess: "HOST_APPROVAL",
      notifyMeetingEvents: true,
      notifyInvitationEvents: true,
    }), "account-1", database);
    await createAccountNotification(database, event);
    await createAccountNotification(database, event);
    await createAccountNotification(database, { ...event, accountId: "account-2", eventKey: "schedule:other:created" });
    expect(notifications.size).toBe(2);

    const ownList = await handleNotificationsRequest(request("/api/notifications"), "account-1", database);
    expect(await ownList.json()).toMatchObject({ data: { unreadCount: 1, notifications: [{ isRead: false, meetingId: "btm_example0001" }] } });
    const otherList = await handleNotificationsRequest(request("/api/notifications"), "account-2", database);
    expect(await otherList.json()).toMatchObject({ data: { unreadCount: 1, notifications: [{ title: "Meeting scheduled" }] } });

    const ownId = [...notifications.values()].find((row) => row.account_id === "account-1")!.notification_id;
    expect((await handleNotificationsRequest(request(`/api/notifications/${ownId}`, "PATCH", { isRead: true }), "account-2", database)).status).toBe(404);
    expect((await handleNotificationsRequest(request(`/api/notifications/${ownId}`, "PATCH", { isRead: true }), "account-1", database)).status).toBe(200);
    expect((await handleNotificationsRequest(request("/api/notifications"), null, database)).status).toBe(401);
    expect(await (await handleNotificationsRequest(request("/api/notifications"), "account-1", database)).json()).toMatchObject({ data: { unreadCount: 0 } });
    await handleNotificationsRequest(request("/api/notifications/read-all", "POST", {}), "account-2", database);
    expect([...notifications.values()].every((row) => row.is_read === 1)).toBe(true);
  });

  it("rejects cross-origin notification and preference writes at the Worker boundary", async () => {
    const crossOrigin = await app.fetch(new Request("https://meet.example/api/preferences", {
      method: "PUT",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));
    expect(crossOrigin.status).toBe(403);
    expect((await handleNotificationsRequest(request("/api/notifications"), null)).status).toBe(503);
  });

  it("renders settings controls, saved scheduler defaults, and the notifications feed in the approved branded surfaces", () => {
    expect(accountPage()).toContain('data-panel="preferences"');
    expect(accountPage()).toContain('name="notifyInvitationEvents"');
    expect(schedulerPreviewPage()).toContain("api('/api/preferences')");
    expect(dashboardPage()).toContain('id="notificationCount"');
    expect(dashboardPage()).toContain('href="/notifications"');
    expect(notificationsPage()).toContain('id="readAll"');
    expect(notificationsPage()).toContain("PATCH");
    expect(notificationsPage()).toContain('href="/schedule">Meetings</a>');
    expect(notificationsPage()).toContain('href="/contacts">Contacts &amp; Invitations</a>');
    expect(notificationsPage()).toContain('href="/notifications" aria-current="page"');
  });
});
