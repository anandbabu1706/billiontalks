import { describe, expect, it } from "vitest";

import app from "../src/index";
import { dashboardPage } from "../src/dashboard/ui";

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
    expect(html).toContain("/account#profile");
    expect(html).toContain("Coming soon");
    expect(html).toContain("Calendar");
    expect(html).toContain("Contacts");
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
    expect(html).toContain("api('/api/accounts/logout'");
    expect(html).toContain("Guest joining remains available");
    expect(html).toContain("Scheduling soon");
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
});
