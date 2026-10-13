import { describe, expect, it } from "vitest";
import type { D1AccountDatabase, D1AccountStatement } from "../src/account/repository";
import app from "../src/index";

function authenticatedAccountDatabase(): D1AccountDatabase {
  const accountRow = {
    id: "acct_homepage_test",
    full_name: "Homepage Test",
    email_normalized: "homepage@example.com",
    country_code: "+1",
    mobile_e164: "+12025550123",
    status: "ACTIVE",
    email_verified_at: "2026-10-14T00:00:00.000Z",
    mobile_verified_at: null,
    terms_accepted_at: "2026-10-14T00:00:00.000Z",
    terms_version: "terms-v1",
    marketing_consent: 0,
    marketing_consent_at: null,
    created_at: "2026-10-14T00:00:00.000Z",
    updated_at: "2026-10-14T00:00:00.000Z",
  };

  const statement: D1AccountStatement = {
    bind: () => statement,
    first: async <T>() => accountRow as T,
    run: async () => ({ meta: { changes: 1 } }),
  };

  return {
    prepare: () => statement,
    batch: async () => [],
  };
}

function sessionStore() {
  const sessions = new Map<string, { sessionId: string; userId: string; displayName: string; createdAt: string; lastSeenAt: string }>();
  return {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      getSession: async (sessionId: string) => sessions.get(sessionId),
      saveSession: async (session: { sessionId: string; userId: string; displayName: string; createdAt: string; lastSeenAt: string }) => {
        sessions.set(session.sessionId, session);
      },
      deleteSession: async (sessionId: string) => { sessions.delete(sessionId); },
    }),
  };
}

describe("V1 homepage routing", () => {
  it("routes unauthenticated ordinary visits to the approved account interface", async () => {
    const response = await app.fetch(new Request("https://billiontalks.example/"));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://billiontalks.example/account");
  });

  it("routes authenticated account users to the dashboard", async () => {
    const response = await app.fetch(
      new Request("https://billiontalks.example/", {
        headers: { Cookie: `bt_account_session=${"A".repeat(43)}` },
      }),
      { ACCOUNT_DB: authenticatedAccountDatabase() },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://billiontalks.example/dashboard");
  });

  it("keeps root meeting links in the meeting UI and preserves the meeting ID", async () => {
    const response = await app.fetch(
      new Request("https://billiontalks.example/?meeting=btm_link_123&tab=chat"),
      { SESSION_STORE: sessionStore() },
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('new URLSearchParams(window.location.search).get(\'meeting\')');
    expect(response.headers.get("Set-Cookie")).toContain("bt_session_v0=");
  });

  it("preserves /ui as the meeting interface", async () => {
    const response = await app.fetch(
      new Request("https://billiontalks.example/ui?meeting=btm_legacy_123"),
      { SESSION_STORE: sessionStore() },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Start or join a meeting");
    expect(response.headers.get("Set-Cookie")).toContain("bt_session_v0=");
  });
});
