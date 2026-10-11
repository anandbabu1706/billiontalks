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
  it("renders private dashboard actions and account navigation without unrelated milestones", () => {
    const html = dashboardPage();

    expect(html).toContain("Your meeting workspace");
    expect(html).toContain("Start a meeting");
    expect(html).toContain("Join a meeting");
    expect(html).toContain("Recent meetings");
    expect(html).toContain("Private to your signed-in account");
    expect(html).toContain("/account#profile");
    expect(html).not.toContain("Scheduler");
    expect(html).not.toContain("Calendar");
    expect(html).not.toContain("Billing");
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
