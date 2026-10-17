import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../src/account/domain";
import type { D1AccountDatabase, D1AccountStatement } from "../src/account/repository";
import app from "../src/index";
import { publicPages } from "../src/website/content";
import { websiteResponse } from "../src/website/ui";
import { dashboardPage } from "../src/dashboard/ui";
import { accountPage } from "../src/account/ui";

vi.mock("../src/assets/brand/billiontalks-logo.png", () => ({ default: new Uint8Array([137, 80, 78, 71]).buffer }));

const enabled = {
  PUBLIC_WEBSITE_ENABLED: "true",
  SESSION_STORE: {
    idFromName: (name: string) => name,
    get: () => ({ getSession: async () => undefined, saveSession: async () => undefined, deleteSession: async () => undefined }),
  },
};
const account: Account = {
  id: "acct_growth_test", fullName: '<img src=x onerror="alert(1)">', email: "growth@example.com",
  countryCode: "US", mobileNumber: "+12025550101", status: "ACTIVE", emailVerifiedAt: "2026-10-17T00:00:00Z",
  mobileVerifiedAt: null, termsAcceptedAt: "2026-10-17T00:00:00Z", termsVersion: "terms-v1",
  marketingConsent: false, marketingConsentAt: null, createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z",
};
const doms: JSDOM[] = [];
afterEach(() => { doms.splice(0).forEach((dom) => dom.window.close()); vi.restoreAllMocks(); });

function accountDb(fail = false): D1AccountDatabase {
  const row = {
    id: account.id, full_name: account.fullName, email_normalized: account.email, country_code: "US",
    mobile_e164: account.mobileNumber, status: "ACTIVE", email_verified_at: account.emailVerifiedAt,
    mobile_verified_at: null, terms_accepted_at: account.termsAcceptedAt, terms_version: "terms-v1",
    marketing_consent: 0, marketing_consent_at: null, created_at: account.createdAt, updated_at: account.updatedAt,
  };
  const statement: D1AccountStatement = {
    bind: () => statement,
    first: async <T>() => { if (fail) throw new Error("storage failed"); return row as T; },
    run: async () => ({ meta: { changes: 1 } }),
  };
  return { prepare: () => statement, batch: async () => [] };
}

function parse(html: string): Document {
  const dom = new JSDOM(html);
  doms.push(dom);
  return dom.window.document;
}

async function contactBrowser(signedIn = false) {
  const page = publicPages.find((entry) => entry.path === "/contact")!;
  const html = await websiteResponse(page, signedIn ? account : null, false).text();
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, json: async () => ({ referenceId: "fb_test_reference" }) }));
  const dom = new JSDOM(html, {
    url: "https://staging.example/contact", runScripts: "dangerously",
    beforeParse(window) {
      Object.defineProperty(window, "fetch", { value: fetch, configurable: true });
      Object.defineProperty(window, "matchMedia", { value: () => ({ matches: true }) });
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
    },
  });
  doms.push(dom);
  const { document } = dom.window;
  return { dom, document, fetch };
}

describe("BT-GROWTH-001 public website", () => {
  it.each(publicPages)("renders approved semantic copy and unique SEO for $path", async (page) => {
    const response = await app.fetch(new Request(`https://billiontalks.com${page.path}`), enabled);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const document = parse(await response.text());
    expect(document.title).toBe(page.title);
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")?.textContent).toBe(page.heading);
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(page.description);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(`https://billiontalks.com${page.path}`);
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("index,follow");
    expect([...document.querySelectorAll("#publicNavigation a")].map((a) => a.textContent)).toEqual(["Home", "About", "How It Works", "Features", "Solutions", "Contact"]);
    expect(document.querySelectorAll('#publicNavigation [aria-current="page"]')).toHaveLength(1);
    expect(document.querySelector('.account-actions a[href="/account#register"]')?.textContent).toBe("Create Free Account");
    expect(document.querySelector('.account-actions a[href="/account#login"]')?.textContent).toBe("Sign In");
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(page.title);
    expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe("summary_large_image");
    const schema = JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(schema.publisher.name).toBe("BillionTalks");
    expect(schema).not.toHaveProperty("aggregateRating");
  });

  it("keeps the legacy root routing gated off outside the staging activation", async () => {
    const response = await app.fetch(new Request("https://billiontalks.com/"));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://billiontalks.com/account");
    expect((await app.fetch(new Request("https://billiontalks.com/about"))).status).toBe(404);
  });

  it("preserves meeting deep links and keeps private app content out of indexing", async () => {
    for (const path of ["/?meeting=btm_existing_123&tab=chat", "/ui?meeting=btm_existing_123", "/dashboard", "/account", "/schedule", "/calendar", "/contacts", "/notifications"]) {
      const response = await app.fetch(new Request("https://billiontalks.com" + path), enabled);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
      if (path.includes("meeting=")) expect(await response.text()).toContain("Start or join a meeting");
    }
  });

  it("preserves canonical redirects including meeting query strings", async () => {
    const response = await app.fetch(new Request("https://www.billiontalks.com/?meeting=btm_keep_123&tab=chat"), enabled);
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("https://billiontalks.com/?meeting=btm_keep_123&tab=chat");
  });

  it("uses existing session identity for navigation and editable contact prefill without XSS", async () => {
    const response = await app.fetch(new Request("https://billiontalks.com/contact", {
      headers: { Cookie: `bt_account_session=${"A".repeat(43)}` },
    }), { ...enabled, ACCOUNT_DB: accountDb() });
    const document = parse(await response.text());
    expect(document.querySelector(".profile summary")?.textContent).toBe(account.fullName);
    expect(document.querySelector("#contactName")?.getAttribute("value")).toBe(account.fullName);
    expect(document.querySelector("#contactEmail")?.getAttribute("value")).toBe(account.email);
    expect(document.querySelectorAll("img[onerror]")).toHaveLength(0);
    expect(document.querySelector('.account-actions a[href="/dashboard"]')?.textContent).toBe("Dashboard");
    expect(document.getElementById("publicSignOut")).not.toBeNull();
    expect(document.querySelector('.account-actions a[href="/account#register"]')).toBeNull();
    expect(document.querySelector("#contactEmail")?.hasAttribute("readonly")).toBe(false);
  });

  it("does not silently downgrade an account storage failure into guest state", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await app.fetch(new Request("https://billiontalks.com/contact", {
      headers: { Cookie: `bt_account_session=${"A".repeat(43)}` },
    }), { ...enabled, ACCOUNT_DB: accountDb(true) });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("temporarily unavailable");
  });

  it("serves a valid six-page sitemap and appropriate production/staging robots", async () => {
    const response = await app.fetch(new Request("https://billiontalks.com/sitemap.xml"), enabled);
    expect(response.headers.get("Content-Type")).toContain("application/xml");
    const dom = new JSDOM(await response.text(), { contentType: "application/xml" });
    doms.push(dom);
    expect([...dom.window.document.querySelectorAll("loc")].map((entry) => entry.textContent)).toEqual(publicPages.map((page) => "https://billiontalks.com" + page.path));
    const robots = await (await app.fetch(new Request("https://billiontalks.com/robots.txt"), enabled)).text();
    expect(robots).toContain("Sitemap: https://billiontalks.com/sitemap.xml");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Disallow: /*?meeting=");
    const staging = await app.fetch(new Request("https://staging.example/contact"), enabled);
    expect(staging.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(await (await app.fetch(new Request("https://staging.example/robots.txt"), enabled)).text()).toBe("User-agent: *\nDisallow: /\n");
    expect(new Set(publicPages.map((page) => page.title)).size).toBe(6);
    expect(new Set(publicPages.map((page) => page.description)).size).toBe(6);
  });

  it("links Dashboard and Settings to the same centralized workflow", () => {
    expect(parse(dashboardPage()).querySelector('.sidebar-footer a[href="/contact"]')?.textContent).toBe("Contact & Feedback");
    expect(parse(accountPage()).querySelector('[data-panel="preferences"] a[href="/contact"]')?.textContent).toBe("Contact & Feedback");
  });

  it("keeps account return navigation on the meeting interface when marketing owns root", async () => {
    const response = await app.fetch(new Request("https://staging.example/account"), enabled);
    const dom = new JSDOM(await response.text(), { url: "https://staging.example/account#register", runScripts: "dangerously" });
    doms.push(dom);
    expect(dom.window.document.getElementById("accountBackLink")?.getAttribute("href")).toBe("/ui");
    expect(dom.window.document.querySelector('[data-panel="register"]')?.hasAttribute("hidden")).toBe(false);
    dom.window.document.querySelector<HTMLButtonElement>('[data-page="forgot"]')?.click();
    expect(dom.window.document.getElementById("accountBackLink")?.getAttribute("href")).toBe("/account#login");
  });

  it("keeps review data behind API authorization and explicitly handles unavailable persistence", async () => {
    expect((await app.fetch(new Request("https://staging.example/api/admin/feedback"), enabled)).status).toBe(401);
    const response = await app.fetch(new Request("https://staging.example/admin/feedback"), enabled);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    const html = await response.text();
    expect(html).toContain("explicitly authorized reviewers");
    expect(html).not.toContain("growth@example.com");
    const submit = await app.fetch(new Request("https://staging.example/api/feedback", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://staging.example" }, body: "{}",
    }), enabled);
    expect(submit.status).toBe(503);
  });

  it("loads the exact official logo through a cacheable self-hosted endpoint", async () => {
    const response = await app.fetch(new Request("https://staging.example/assets/website/logo.png"), enabled);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    const head = await app.fetch(new Request("https://staging.example/assets/website/logo.png", { method: "HEAD" }), enabled);
    expect(await head.text()).toBe("");
    const cached = await app.fetch(new Request("https://staging.example/assets/website/logo.png", { headers: { "If-None-Match": head.headers.get("ETag")! } }), enabled);
    expect(cached.status).toBe(304);
  });
});

describe("BT-GROWTH-001 centralized form", () => {
  it("opens exactly one focused form for all six categories and switches optional fields", async () => {
    const { document } = await contactBrowser();
    expect(document.querySelectorAll("form")).toHaveLength(1);
    expect(document.getElementById("feedbackPanel")?.hidden).toBe(true);
    const topics = [...document.querySelectorAll<HTMLButtonElement>("[data-topic]")];
    expect(topics).toHaveLength(6);
    for (const topic of topics) {
      topic.click();
      expect(document.getElementById("feedbackPanel")?.hidden).toBe(false);
      expect(document.activeElement?.id).toBe("feedbackHeading");
      expect((document.getElementById("contactCategory") as HTMLSelectElement).value).toBe(topic.dataset.topic);
      expect(document.querySelectorAll('[data-topic][aria-pressed="true"]')).toHaveLength(1);
      expect(document.getElementById("feedbackRating")?.hidden).toBe(topic.dataset.topic !== "feedback");
      expect(document.getElementById("issueDetails")?.hidden).toBe(topic.dataset.topic !== "report-issue");
    }
    document.getElementById("changeTopic")?.click();
    expect(document.getElementById("feedbackPanel")?.hidden).toBe(true);
    expect(document.activeElement?.getAttribute("data-topic")).toBe("report-issue");
  });

  it("submits only the edited contact fields, waits for confirmation and prevents duplicate requests", async () => {
    const { document, dom, fetch } = await contactBrowser(true);
    document.querySelector<HTMLButtonElement>('[data-topic="report-issue"]')!.click();
    (document.getElementById("contactName") as HTMLInputElement).value = "Edited name";
    (document.getElementById("contactEmail") as HTMLInputElement).value = "edited@example.com";
    (document.getElementById("affectedFeature") as HTMLSelectElement).value = "Meetings";
    (document.getElementById("contactMessage") as HTMLTextAreaElement).value = "A useful issue description.";
    let resolve!: (value: { ok: boolean; json: () => Promise<{ referenceId: string }> }) => void;
    fetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const form = document.getElementById("contactForm")!;
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    expect(fetch).toHaveBeenCalledOnce();
    expect(document.getElementById("contactStatus")?.textContent).not.toContain("received");
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/feedback");
    expect(JSON.parse(String(options?.body))).toEqual({
      category: "report-issue", name: "Edited name", email: "edited@example.com", affectedFeature: "Meetings",
      message: "A useful issue description.", website: "",
    });
    resolve({ ok: true, json: async () => ({ referenceId: "fb_confirmed" }) });
    await new Promise((done) => setTimeout(done, 0));
    expect(document.getElementById("contactStatus")?.textContent).toContain("Reference: fb_confirmed");
    expect((document.getElementById("contactMessage") as HTMLTextAreaElement).value).toBe("");
    expect((document.getElementById("contactEmail") as HTMLInputElement).value).toBe("edited@example.com");
  });

  it("shows explicit failure and preserves the message instead of claiming success", async () => {
    const { document, dom, fetch } = await contactBrowser();
    fetch.mockRejectedValue(new Error("Network unavailable"));
    document.querySelector<HTMLButtonElement>('[data-topic="feedback"]')!.click();
    (document.getElementById("contactName") as HTMLInputElement).value = "A guest";
    (document.getElementById("contactEmail") as HTMLInputElement).value = "guest@example.com";
    (document.getElementById("contactMessage") as HTMLTextAreaElement).value = "Please keep my feedback.";
    document.querySelector<HTMLInputElement>('input[name="rating"][value="4"]')!.checked = true;
    document.getElementById("contactForm")!.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await new Promise((done) => setTimeout(done, 0));
    expect(document.getElementById("contactStatus")?.textContent).toContain("We couldn't submit your message");
    expect(document.getElementById("contactStatus")?.classList.contains("error")).toBe(true);
    expect((document.getElementById("contactMessage") as HTMLTextAreaElement).value).toBe("Please keep my feedback.");
    expect((document.getElementById("contactSubmit") as HTMLButtonElement).disabled).toBe(false);
  });
});
