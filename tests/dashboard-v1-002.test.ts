import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

import app from "../src/index";
import { dashboardPage } from "../src/dashboard/ui";

let startRequest: { url: string; init?: RequestInit } | undefined;

async function openDashboard(): Promise<JSDOM> {
  startRequest = undefined;
  const dom = new JSDOM(dashboardPage(), {
    runScripts: "dangerously",
    url: "https://dashboard.example/dashboard",
    beforeParse(window) {
      Object.defineProperty(window, "fetch", {
        value: async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.startsWith("/api/schedules/") && url.endsWith("/start")) {
            startRequest = { url, init };
            return { ok: false, status: 409, json: async () => ({ ok: false, error: "Refresh to continue." }) };
          }
          const data = url === "/api/accounts/me"
            ? { account: { fullName: "Dashboard Owner", email: "owner@example.test" } }
            : url === "/api/schedules?upcoming=1"
              ? [{ id: "btm_dashboard_late01", title: "Late planning", startsAt: "2000-01-01T12:00:00.000Z", timeZone: "UTC", status: "SCHEDULED", revision: 4 }]
              : url === "/api/notifications?limit=1"
                ? { unreadCount: 0 }
                : [];
          return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
        },
      });
    },
  });
  for (let attempt = 0; attempt < 20 && !dom.window.document.querySelector("#overdueList [data-action='start-scheduled']"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return dom;
}

function emptyAccountDatabase() {
  const statement = {
    bind() { return statement; },
    async first<T>() { return null as T | null; },
    async run() { return { meta: { changes: 0 } }; },
  };
  return { prepare: () => statement, batch: async () => [] };
}

describe("BT-V1-002 signed-in dashboard", () => {
  it("renders the approved premium dashboard structure without unsupported live features", () => {
    const html = dashboardPage();

    expect(html).toContain("Welcome back,");
    expect(html).toContain("Start Meeting");
    expect(html).toContain("Join Meeting");
    expect(html).toContain("Schedule Meeting");
    expect(html).toContain("Next Meeting");
    expect(html).toContain("Upcoming Meetings");
    expect(html).toContain("Recent Meetings");
    expect(html).toContain("Quick Actions");
    expect(html).toContain("Total Meetings");
    expect(html).toContain("Total Participants");
    expect(html).toContain("Total Meeting Time");
    expect(html).toContain("Meetings This Month");
    expect(html).toContain("#14a66f");
    expect(html).toContain("#7352d1");
    expect(html).toContain("linear-gradient(155deg, #071d49 0%, #0b3d88 58%, #176fd2 100%)");
    expect(html).toContain("linear-gradient(135deg, #176fd2, #318ff0)");
    expect(html).toContain("border-top-color: #4a89ee");
    expect(html).toContain("box-shadow: 0 14px 32px");
    expect(html).toContain("Private to your account");
    expect(html).toContain("/account#preferences");
    expect(html).toContain('id="notificationCount"');
    expect(html).toContain("Coming soon");
    expect(html).toContain("Calendar");
    expect(html).toContain('class="nav-item" href="/calendar"');
    expect(html).toContain("Contacts");
    expect(html).toContain('class="quick-item" href="/contacts"');
    expect(html).toContain('class="nav-item" href="/schedule"');
    expect(html).toContain('class="nav-item" href="/notifications"');
    expect(html).toContain("Recording controls and consent are available in meeting rooms. Playback is not available.");
    expect(html).not.toContain("<strong>Contacts</strong><span>Coming soon</span>");
    expect(html).toContain("Recordings");
    expect(html).not.toContain("Billing");
    expect(html).toContain("sidebarToggle");
    expect(html).toContain("color-scheme: light");
    expect(html).toContain("billiontalks-logo.png");
    expect(html).toContain("History does not expose participant totals");
    expect(html).not.toContain("Upgrade");
    expect(html).not.toContain("Google");
    expect(html).not.toContain("sample meeting");
  });

  it("keeps supported actions wired to authenticated APIs and marks future features unavailable", () => {
    const html = dashboardPage();

    expect(html).toContain("api('/api/meetings'");
    expect(html).toContain("api('/api/meetings/history')");
    expect(html).toContain("api('/api/accounts/me')");
    expect(html).toContain("api('/api/schedules?upcoming=1')");
    expect(html).toContain("data-action=\"start-scheduled\"");
    expect(html).toContain("api('/api/schedules/' + encodeURIComponent(button.dataset.id) + '/start'");
    expect(html).toContain('id="overdueList"');
    expect(html).toContain("Needs start");
    expect(html).toContain("api('/api/accounts/logout'");
    expect(html).toContain("Guest joining remains available");
    expect(html).toContain("Monthly view");
    expect(html).not.toContain("Upcoming meeting filters will be available");
    expect(html).not.toContain("fetch('/api/contacts");
  });

  it("serves the dashboard page without exposing meeting data in the HTML", async () => {
    const response = await app.fetch(new Request("http://localhost/dashboard"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("id=\"historyList\"");
    expect(html).not.toContain("btm_test");
  });

  it("requires account authentication to create meetings when account storage is configured", async () => {
    const response = await app.fetch(new Request("http://localhost/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Unauthenticated host", accessMode: "HOST_APPROVAL" }),
    }), { ACCOUNT_DB: emptyAccountDatabase() });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Sign in to start a meeting." });
  });

  it("requires account authentication to read history when account storage is configured", async () => {
    const response = await app.fetch(new Request("http://localhost/api/meetings/history"), {
      ACCOUNT_DB: emptyAccountDatabase(),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Authentication required." });
  });

  it("keeps an overdue schedule visible and starts that scheduled ID from the Dashboard", async () => {
    const dom = await openDashboard();
    try {
      const { document, MouseEvent } = dom.window;
      const startButton = document.querySelector<HTMLButtonElement>("#overdueList [data-action='start-scheduled']");
      expect(startButton?.textContent).toBe("Start meeting");
      expect(document.getElementById("overdueList")?.textContent).toContain("Late planning");
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      for (let attempt = 0; attempt < 20 && !startRequest; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      for (let attempt = 0; attempt < 20 && document.getElementById("error")?.textContent !== "Refresh to continue."; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(startRequest?.url).toBe("/api/schedules/btm_dashboard_late01/start");
      expect(JSON.parse(String(startRequest?.init?.body))).toEqual({ revision: 4 });
      expect(document.getElementById("error")?.textContent).toBe("Refresh to continue.");
      expect(startButton?.disabled).toBe(false);
    } finally {
      dom.window.close();
    }
  });
});
