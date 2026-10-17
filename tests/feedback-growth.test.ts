import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../src/account/domain";
import type { D1AccountDatabase, D1AccountStatement } from "../src/account/repository";
import { FEEDBACK_CATEGORIES, handleFeedbackAdminRequest, handleFeedbackRequest } from "../src/feedback/api";
import app from "../src/index";

// Vite 5 predates node:sqlite; load the Node built-in without Vite resolving it as a package.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const NOW = "2026-10-18T00:00:00.000Z";
const DAY = 86400000;
const payload = { category: "general-enquiries", name: "Visitor Name", email: "visitor@example.com", message: "Please get in touch." };
const accounts: Account[] = Array.from({ length: 22 }, (_, index) => ({
  id: `acct_feedback_${index}`,
  fullName: "Session Name",
  email: `session${index}@example.com`,
  countryCode: "US",
  mobileNumber: `+1202555${String(index).padStart(4, "0")}`,
  status: "ACTIVE",
  emailVerifiedAt: NOW,
  mobileVerifiedAt: null,
  termsAcceptedAt: NOW,
  termsVersion: "v1",
  marketingConsent: false,
  marketingConsentAt: null,
  createdAt: NOW,
  updatedAt: NOW,
}));
const owner = accounts[0]!;
const databases: InstanceType<typeof DatabaseSync>[] = [];

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(readFileSync(new URL("../migrations/0001_accounts.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0009_contact_feedback.sql", import.meta.url), "utf8"));
  for (const account of accounts) {
    sqlite.prepare(`INSERT INTO accounts
      (id, full_name, email_normalized, country_code, mobile_e164, status, email_verified_at,
       terms_accepted_at, terms_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      account.id, account.fullName, account.email, account.countryCode, account.mobileNumber,
      account.status, account.emailVerifiedAt, NOW, account.termsVersion, NOW, NOW,
    );
  }
  const executions = new WeakMap<D1AccountStatement, () => unknown>();
  const database: D1AccountDatabase = {
    prepare(query) {
      let values: unknown[] = [];
      const statement: D1AccountStatement = {
        bind(...bound) { values = bound; return statement; },
        async first<T>() { return sqlite.prepare(query).get(...values as never[]) as T ?? null; },
        async all<T>() { return { results: sqlite.prepare(query).all(...values as never[]) as T[] }; },
        async run() {
          const result = sqlite.prepare(query).run(...values as never[]);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      };
      executions.set(statement, () => ({
        success: true,
        results: sqlite.prepare(query).all(...values as never[]),
      }));
      return statement;
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => executions.get(statement)!());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  function count(table = "feedback_submissions"): number {
    return (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  }
  function allow(account = owner) {
    sqlite.prepare("INSERT INTO feedback_reviewers (account_id) VALUES (?)").run(account.id);
  }
  return { sqlite, database, count, allow };
}

function post(body: unknown = payload, headers: Record<string, string> = {}): Request {
  return new Request("https://billiontalks.com/api/feedback", {
    method: "POST",
    headers: { Origin: "https://billiontalks.com", "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.1", ...headers },
    body: JSON.stringify(body),
  });
}

function admin(path = "", method = "GET", headers: Record<string, string> = {}): Request {
  return new Request(`https://billiontalks.com/api/admin/feedback${path}`, {
    method, headers: { Origin: "https://billiontalks.com", ...headers },
  });
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
});

describe("centralized contact and feedback submissions", () => {
  it("exports stable category IDs with the six exact labels", () => {
    expect(FEEDBACK_CATEGORIES).toEqual({
      "general-enquiries": "General Enquiries", "technical-support": "Technical Support",
      "feature-suggestions": "Feature Suggestions", "business-partnerships": "Business & Partnerships",
      feedback: "Feedback", "report-issue": "Report an Issue",
    });
  });

  it("persists editable contact details separately from immutable verified account identity", async () => {
    const f = fixture();
    const response = await handleFeedbackRequest(post({ ...payload, email: "EDITED@example.com" }), owner, f.database);
    expect(response.status).toBe(201);
    const { referenceId } = await response.json() as { referenceId: string };
    expect(referenceId).toMatch(/^fb_/u);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(f.sqlite.prepare("SELECT * FROM feedback_submissions").get()).toMatchObject({
      id: referenceId, account_id: owner.id, name: payload.name, email: "edited@example.com",
      rating: null, affected_feature: null, context: null, created_at: NOW,
      expires_at: new Date(Date.parse(NOW) + 90 * DAY).toISOString(),
    });
    expect(() => f.sqlite.prepare("UPDATE feedback_submissions SET account_id = ?").run(accounts[1]!.id)).toThrow(/immutable/u);
    expect(() => f.sqlite.prepare("UPDATE feedback_submissions SET account_id = NULL").run()).toThrow(/immutable/u);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it.each(Object.keys(FEEDBACK_CATEGORIES))("accepts the %s category and only its applicable fields", async (category) => {
    const f = fixture();
    const fields = category === "report-issue" ? { affectedFeature: "Meeting chat" } : category === "feedback" ? { rating: 5 } : {};
    const result = await handleFeedbackRequest(post({ ...payload, category, ...fields }), null, f.database);
    expect(result.status).toBe(201);
    expect(f.sqlite.prepare("SELECT * FROM feedback_submissions").get()).toMatchObject({
      category, account_id: null, context: null,
    });
  });

  it("accepts optional feedback rating and user-provided issue context without diagnostics", async () => {
    const f = fixture();
    expect((await handleFeedbackRequest(post({ ...payload, category: "feedback" }), owner, f.database)).status).toBe(201);
    expect((await handleFeedbackRequest(post({
      ...payload, category: "report-issue", affectedFeature: "Audio", context: "Only after joining.\nNo diagnostics attached.",
    }), owner, f.database)).status).toBe(201);
    expect(f.sqlite.prepare("SELECT context FROM feedback_submissions WHERE category = 'report-issue'").get()).toEqual({
      context: "Only after joining.\nNo diagnostics attached.",
    });
  });

  it.each([
    null, [], "text", {}, { ...payload, category: "unknown" }, { ...payload, category: "toString" },
    { ...payload, name: "" }, { ...payload, name: "a".repeat(121) }, { ...payload, email: "bad" },
    { ...payload, message: "" }, { ...payload, message: "a".repeat(5001) }, { ...payload, message: "bad\u0000" },
    { ...payload, rating: 5 }, { ...payload, category: "feedback", rating: 0 },
    { ...payload, category: "feedback", rating: 6 }, { ...payload, category: "feedback", rating: 1.5 },
    { ...payload, category: "feedback", rating: "5" }, { ...payload, category: "feedback", rating: null },
    { ...payload, category: "report-issue" }, { ...payload, category: "report-issue", affectedFeature: "" },
    { ...payload, category: "report-issue", affectedFeature: "a".repeat(121) },
    { ...payload, category: "report-issue", affectedFeature: "Chat", context: "a".repeat(2001) },
    { ...payload, affectedFeature: "Chat" }, { ...payload, context: "No" },
    { ...payload, accountId: owner.id }, { ...payload, diagnostics: { userAgent: "automatic" } },
  ])("rejects invalid or unsupported payload %#", async (body) => {
    const f = fixture();
    expect((await handleFeedbackRequest(post(body), owner, f.database)).status).toBe(400);
    expect(f.count()).toBe(0);
  });

  it("explicitly rejects honeypot spam instead of pretending to save it", async () => {
    const f = fixture();
    const response = await handleFeedbackRequest(post({ ...payload, website: "https://spam.example" }), null, f.database);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Submission rejected as spam." });
    expect(f.count()).toBe(0);
    expect((await handleFeedbackRequest(post({ ...payload, website: "" }), null, f.database)).status).toBe(201);
  });

  it("bounds both streamed UTF-8 bytes and declared length, and rejects malformed JSON/media types", async () => {
    const f = fixture();
    const send = (body: string, headers: Record<string, string> = {}) => handleFeedbackRequest(new Request(
      "https://billiontalks.com/api/feedback", {
        method: "POST", headers: { Origin: "https://billiontalks.com", "Content-Type": "application/json", ...headers }, body,
      },
    ), owner, f.database);
    expect((await send(JSON.stringify({ ...payload, message: "💡".repeat(5000) }))).status).toBe(413);
    expect((await send("{}", { "Content-Length": "16385" })).status).toBe(413);
    expect((await send("{")).status).toBe(400);
    expect((await send("{}", { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await send("{}", { "Content-Type": "application/json-bogus" })).status).toBe(415);
    expect(f.count()).toBe(0);
  });

  it("never exposes public records or permits unsupported methods", async () => {
    const f = fixture();
    for (const method of ["GET", "DELETE", "PUT"]) {
      const response = await handleFeedbackRequest(new Request("https://billiontalks.com/api/feedback", { method }), owner, f.database);
      expect(response.status).toBe(405);
      expect(await response.text()).not.toContain("submissions");
    }
    expect((await handleFeedbackRequest(new Request("https://billiontalks.com/api/feedback/anything"), null, f.database)).status).toBe(404);
  });

  it("rejects cross-origin, null-origin, missing origin, and cross-site metadata before database access", async () => {
    const f = fixture();
    for (const headers of [
      { Origin: "https://evil.example" }, { Origin: "null" },
      { Origin: "https://billiontalks.com.evil.example" }, { "Sec-Fetch-Site": "cross-site" },
    ] as Record<string, string>[]) expect((await handleFeedbackRequest(post(payload, headers), owner, f.database)).status).toBe(403);
    const missing = post(); missing.headers.delete("Origin");
    expect((await handleFeedbackRequest(missing, null, f.database)).status).toBe(403);
    expect(f.count("feedback_rate_limits")).toBe(0);
  });

  it.each([
    { ...owner, status: "SUSPENDED" as const },
    { ...owner, status: "PENDING_EMAIL_VERIFICATION" as const },
    { ...owner, emailVerifiedAt: null },
  ])("does not treat an invalid account as a guest", async (account) => {
    const f = fixture();
    expect((await handleFeedbackRequest(post(), account, f.database)).status).toBe(401);
    expect(f.count()).toBe(0);
  });
});

describe("atomic feedback abuse controls", () => {
  it("enforces the per-account limit under concurrent requests, independent of name/email/IP", async () => {
    const f = fixture();
    const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => handleFeedbackRequest(
      post({ ...payload, name: `Name ${index}`, email: `edit${index}@example.com` }, { "CF-Connecting-IP": `203.0.113.${index}` }),
      owner, f.database,
    )));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(5);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(7);
    expect(responses.find((response) => response.status === 429)?.headers.get("Retry-After")).toBe("3600");
    expect(f.count()).toBe(5);
  });

  it("limits a guest session across different IPs, stores only hashes, and sets a secure cookie", async () => {
    const f = fixture();
    const first = await handleFeedbackRequest(post(), null, f.database);
    const cookie = first.headers.get("Set-Cookie")!;
    expect(cookie).toContain("HttpOnly; SameSite=Strict; Max-Age=86400; Secure");
    for (let index = 1; index <= 5; index++) {
      const response = await handleFeedbackRequest(post(payload, {
        Cookie: cookie.split(";")[0]!, "CF-Connecting-IP": `203.0.113.${index + 1}`,
      }), null, f.database);
      expect(response.status).toBe(index < 5 ? 201 : 429);
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }
    const counters = f.sqlite.prepare("SELECT scope_hash FROM feedback_rate_limits").all() as { scope_hash: string }[];
    expect(counters.every((row) => /^[0-9a-f]{64}$/u.test(row.scope_hash))).toBe(true);
    expect(JSON.stringify(counters)).not.toContain(cookie.split(";")[0]!.split("=")[1]);
  });

  it("enforces the shared missing-IP fallback and never trusts x-forwarded-for", async () => {
    const f = fixture();
    const responses: Response[] = [];
    for (let index = 0; index <= 20; index++) {
      const request = post(payload, { "x-forwarded-for": `203.0.113.${index}` });
      request.headers.delete("CF-Connecting-IP");
      responses.push(await handleFeedbackRequest(request, accounts[index]!, f.database));
    }
    expect(responses.slice(0, 20).every((response) => response.status === 201)).toBe(true);
    expect(responses[20]!.status).toBe(429);
  });

  it("cannot bypass the trusted-IP limit by rotating guest cookies", async () => {
    const f = fixture();
    const responses = await Promise.all(Array.from({ length: 21 }, () => handleFeedbackRequest(post(), null, f.database)));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(20);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
  });

  it("resets the one-hour fixed window and purges stale hashes in bounded batches", async () => {
    const f = fixture();
    for (let index = 0; index < 5; index++) expect((await handleFeedbackRequest(post(), owner, f.database)).status).toBe(201);
    expect((await handleFeedbackRequest(post(), owner, f.database)).status).toBe(429);
    vi.setSystemTime(Date.parse(NOW) + 60 * 60 * 1000);
    expect((await handleFeedbackRequest(post(), owner, f.database)).status).toBe(201);
    for (let index = 0; index < 105; index++) {
      f.sqlite.prepare("INSERT INTO feedback_rate_limits VALUES (?, 1, ?, ?)").run(`stale${index}`, "2026-10-01", "2026-10-01");
    }
    expect((await handleFeedbackRequest(post(), owner, f.database)).status).toBe(201);
    expect(f.sqlite.prepare("SELECT COUNT(*) AS count FROM feedback_rate_limits WHERE updated_at = '2026-10-01'").get())
      .toEqual({ count: 5 });
  });
});

describe("fail-closed reviewer access and retention", () => {
  it("requires a verified active account and the explicit database allowlist, not contact email", async () => {
    const f = fixture();
    expect(f.count("feedback_reviewers")).toBe(0);
    expect((await handleFeedbackAdminRequest(admin(), null, f.database)).status).toBe(401);
    expect((await handleFeedbackAdminRequest(admin(), { ...owner, emailVerifiedAt: null }, f.database)).status).toBe(401);
    expect((await handleFeedbackAdminRequest(admin(), { ...owner, status: "CLOSED" }, f.database)).status).toBe(401);
    expect((await handleFeedbackAdminRequest(admin(), owner, f.database)).status).toBe(403);
    f.allow(accounts[1]!);
    expect((await handleFeedbackAdminRequest(admin(), { ...owner, email: accounts[1]!.email }, f.database)).status).toBe(403);
    expect((await handleFeedbackAdminRequest(admin(), accounts[1]!, f.database)).status).toBe(200);
    expect((await handleFeedbackAdminRequest(admin("", "POST"), accounts[1]!, f.database)).status).toBe(405);
  });

  it("uses bounded keyset pagination even when creation timestamps tie", async () => {
    const f = fixture(); f.allow();
    for (let index = 0; index < 3; index++) await handleFeedbackRequest(post(), owner, f.database);
    const first = await handleFeedbackAdminRequest(admin("?limit=2"), owner, f.database);
    const body = await first.json() as { submissions: { id: string; accountId: string }[]; nextCursor: { before: string; beforeId: string } };
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    expect(body.submissions).toHaveLength(2);
    expect(body.submissions[0]!.accountId).toBe(owner.id);
    const second = await handleFeedbackAdminRequest(admin(`?limit=2&${new URLSearchParams(body.nextCursor)}`), owner, f.database);
    const rest = await second.json() as { submissions: { id: string }[]; nextCursor: unknown };
    expect(rest.submissions).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
    expect(new Set([...body.submissions, ...rest.submissions].map((row) => row.id)).size).toBe(3);
    for (const query of ["?limit=0", "?limit=51", "?limit=abc", "?before=bad", "?beforeId=bad", "?before=bad&beforeId=bad"]) {
      expect((await handleFeedbackAdminRequest(admin(query), owner, f.database)).status).toBe(400);
    }
  });

  it("allows only authorized same-origin deletion and never offers detail reads", async () => {
    const f = fixture(); f.allow();
    const created = await handleFeedbackRequest(post(), owner, f.database);
    const { referenceId } = await created.json() as { referenceId: string };
    expect((await handleFeedbackAdminRequest(admin(`/${referenceId}`, "DELETE"), accounts[1]!, f.database)).status).toBe(403);
    expect((await handleFeedbackAdminRequest(admin(`/${referenceId}`, "DELETE", { Origin: "https://evil.example" }), owner, f.database)).status).toBe(403);
    const missing = admin(`/${referenceId}`, "DELETE"); missing.headers.delete("Origin");
    expect((await handleFeedbackAdminRequest(missing, owner, f.database)).status).toBe(403);
    expect((await handleFeedbackAdminRequest(admin("", "GET", { Origin: "https://evil.example" }), owner, f.database)).status).toBe(403);
    expect((await handleFeedbackAdminRequest(admin(`/${referenceId}`), owner, f.database)).status).toBe(405);
    expect((await handleFeedbackAdminRequest(admin(`/${referenceId}`, "DELETE"), owner, f.database)).status).toBe(200);
    expect((await handleFeedbackAdminRequest(admin(`/${referenceId}`, "DELETE"), owner, f.database)).status).toBe(404);
    expect(f.count()).toBe(0);
  });

  it("hides expired rows even if a purge backlog exceeds its indexed batch limit", async () => {
    const f = fixture(); f.allow();
    for (let index = 0; index < 105; index++) {
      f.sqlite.prepare(`INSERT INTO feedback_submissions
        (id, category, name, email, message, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        `fb_${crypto.randomUUID()}`, "feedback", "Expired", "expired@example.com", "Must not be visible", "2026-01-01", NOW,
      );
    }
    const expiredId = (f.sqlite.prepare("SELECT id FROM feedback_submissions ORDER BY expires_at DESC LIMIT 1").get() as { id: string }).id;
    const response = await handleFeedbackAdminRequest(admin(), owner, f.database);
    expect(await response.json()).toEqual({ submissions: [], nextCursor: null });
    expect(f.count()).toBe(5);
    expect((await handleFeedbackAdminRequest(admin(`/${expiredId}`, "DELETE"), owner, f.database)).status).toBe(404);
    expect(f.count()).toBe(0);
    expect(f.sqlite.prepare("EXPLAIN QUERY PLAN SELECT id FROM feedback_submissions WHERE expires_at <= ? ORDER BY expires_at LIMIT 100")
      .all(NOW).some((row) => String(row.detail).includes("feedback_submissions_expiry"))).toBe(true);
  });

  it("purges expired submissions on new submissions, not only reviews", async () => {
    const f = fixture();
    await handleFeedbackRequest(post(), owner, f.database);
    vi.setSystemTime(Date.parse(NOW) + 90 * DAY);
    expect((await handleFeedbackRequest(post(), owner, f.database)).status).toBe(201);
    expect(f.count()).toBe(1);
  });

  it("keeps the schema additive with enforced foreign keys and account deletion cleanup", async () => {
    const f = fixture(); f.allow();
    await handleFeedbackRequest(post(), owner, f.database);
    expect(f.count("accounts")).toBe(22);
    expect(() => f.sqlite.prepare("INSERT INTO feedback_reviewers VALUES ('missing')").run()).toThrow(/FOREIGN KEY/u);
    f.sqlite.prepare("DELETE FROM accounts WHERE id = ?").run(owner.id);
    expect(f.count()).toBe(0);
    expect(f.count("feedback_reviewers")).toBe(0);
  });
});

describe("safe database failures", () => {
  it("never reports success for missing, throwing, or unconfirmed insertion", async () => {
    const f = fixture();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await handleFeedbackRequest(post(), owner)).status).toBe(503);
    for (const behavior of ["throw", "null", "different"] as const) {
      const broken: D1AccountDatabase = {
        ...f.database,
        prepare(query) {
          if (!query.includes("INSERT INTO feedback_submissions")) return f.database.prepare(query);
          const statement: D1AccountStatement = {
            bind() { return statement; },
            async first<T>() {
              if (behavior === "throw") throw new Error(`secret binding ${payload.email}`);
              return (behavior === "null" ? null : { id: "different" }) as T | null;
            },
            async run() { throw new Error("Unexpected run"); },
          };
          return statement;
        },
      };
      const response = await handleFeedbackRequest(post(), owner, broken);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(payload.email);
    }
    expect(f.count()).toBe(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain(payload.email);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  describe("traffic-independent scheduled retention", () => {
    it("drains multiple expired batches at the exact deadline without deleting current rows or reviewer grants", async () => {
      const f = fixture(); f.allow();
      for (let index = 0; index < 205; index++) {
        f.sqlite.prepare(`INSERT INTO feedback_submissions
          (id, category, name, email, message, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          `fb_${crypto.randomUUID()}`, "feedback", "Expired", "expired@example.invalid", "Expired fixture",
          new Date(Date.parse(NOW) - 90 * DAY).toISOString(), NOW,
        );
        f.sqlite.prepare("INSERT INTO feedback_rate_limits VALUES (?, 1, ?, ?)").run(
          `expired_${index}`, NOW, new Date(Date.parse(NOW) - DAY).toISOString(),
        );
      }
      f.sqlite.prepare(`INSERT INTO feedback_submissions
        (id, category, name, email, message, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        `fb_${crypto.randomUUID()}`, "feedback", "Current", "current@example.invalid", "Keep this fixture", NOW,
        new Date(Date.parse(NOW) + 1).toISOString(),
      );
      f.sqlite.prepare("INSERT INTO feedback_rate_limits VALUES ('current', 1, ?, ?)").run(NOW, NOW);
      await app.scheduled({ scheduledTime: Date.parse(NOW) }, { ACCOUNT_DB: f.database });
      expect(f.count()).toBe(1);
      expect(f.count("feedback_rate_limits")).toBe(1);
      expect(f.count("feedback_reviewers")).toBe(1);
      await app.scheduled({ scheduledTime: Date.parse(NOW) }, { ACCOUNT_DB: f.database });
      expect(f.count()).toBe(1);
    });

    it("logs a non-sensitive failure and rejects missing, throwing, incomplete or unconfirmed cleanup", async () => {
      const f = fixture();
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      for (const database of [
        undefined,
        { ...f.database, batch: async () => { throw new Error("secret submitted content"); } },
        { ...f.database, batch: async () => [] },
        { ...f.database, batch: async () => [{ success: false }, { success: false }] },
        { ...f.database, batch: async () => [{ success: true }, { success: true }] },
      ]) {
        await expect(app.scheduled({ scheduledTime: Date.parse(NOW) }, { ACCOUNT_DB: database })).rejects.toThrow("Scheduled feedback cleanup failed.");
      }
      expect(log).toHaveBeenCalledTimes(5);
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    });
  });

  it("fails closed on missing counters, failed batches, cleanup errors and reviewer lookup errors", async () => {
    const f = fixture(); f.allow();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const mode of ["throw", "empty", "failed", "uncounted"] as const) {
      let batches = 0;
      const broken: D1AccountDatabase = {
        ...f.database,
        async batch(statements) {
          batches++;
          if (mode === "throw") throw new Error("Database unavailable");
          if (mode === "empty") return [];
          if (mode === "failed") return [{ success: false }, { success: false }];
          if (batches === 1) return f.database.batch(statements);
          return [{ success: true, results: [] }, { success: true, results: [] }];
        },
      };
      expect((await handleFeedbackRequest(post(), owner, broken)).status).toBe(503);
    }
    const throwing: D1AccountDatabase = {
      ...f.database, prepare() { throw new Error("Lookup failed"); },
    };
    expect((await handleFeedbackAdminRequest(admin(), owner, throwing)).status).toBe(503);
    expect(f.count()).toBe(0);
  });
});
