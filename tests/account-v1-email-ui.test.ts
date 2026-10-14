import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { createAccountEmailSender } from "../src/account/email-delivery";
import { accountPage } from "../src/account/ui";
import app from "../src/index";

const config = { RESEND_API_KEY: "test-key", ACCOUNT_EMAIL_FROM: "BillionTalks <no-reply@example.com>", ACCOUNT_PUBLIC_ORIGIN: "https://example.com/" };
afterEach(() => vi.unstubAllGlobals());

describe("BT-V1-001 transactional email", () => {
  it("declares complete production email configuration", () => {
    const productionConfig = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")) as {
      vars?: Record<string, string>;
    };
    expect(productionConfig.vars?.ACCOUNT_EMAIL_FROM).toBe("BillionTalks <no-reply@mail.billiontalks.com>");
    expect(productionConfig.vars?.ACCOUNT_PUBLIC_ORIGIN).toBe("https://billiontalks.com/");
    expect(createAccountEmailSender({
      RESEND_API_KEY: "configured-secret",
      ACCOUNT_EMAIL_FROM: productionConfig.vars?.ACCOUNT_EMAIL_FROM,
      ACCOUNT_PUBLIC_ORIGIN: productionConfig.vars?.ACCOUNT_PUBLIC_ORIGIN,
    })).not.toBeNull();
  });

  it("does not enable email without complete configuration", () => {
    expect(createAccountEmailSender({})).toBeNull();
    expect(createAccountEmailSender({ ...config, ACCOUNT_PUBLIC_ORIGIN: "http://example.com/" })).toBeNull();
    expect(createAccountEmailSender({ ...config, ACCOUNT_PUBLIC_ORIGIN: "https://example.com/other" })).toBeNull();
  });
  it("delivers a verification link without embedding credentials in the link", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await createAccountEmailSender(config)!.sendVerification("person@example.com", "sample-verification-token");
    const [endpoint, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe("https://api.resend.com/emails");
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const mail = JSON.parse(options.body as string) as { from: string; to: string[]; text: string };
    expect(mail.from).toBe(config.ACCOUNT_EMAIL_FROM);
    expect(mail.to).toEqual(["person@example.com"]);
    expect(mail.text).toContain("https://example.com/account?token=sample-verification-token");
    expect(mail.text).not.toContain("test-key");
  });
  it("delivers a distinct reset link and suppresses provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(createAccountEmailSender(config)!.sendPasswordReset("person@example.com", "secret-token")).rejects.toThrow("Transactional email delivery failed.");
  });
  it("marks password reset links as reset flow", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await createAccountEmailSender(config)!.sendPasswordReset("person@example.com", "secret-token");
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(options.body as string).text).toContain("flow=reset");
  });
});

describe("BT-V1-001 account UI", () => {
  it("includes login, registration, verification, recovery and profile panels", () => {
    const html = accountPage();
    for (const panel of ["login", "register", "verify", "forgot", "reset", "profile"]) {
      expect(html).toContain('data-panel="' + panel + '"');
    }
    expect(html).toContain('name="acceptedTerms"');
    expect(html).toContain('name="marketingConsent"');
    expect(html).toContain('name="emailConfirm"');
    expect(html).toContain('name="country"');
    expect(html).toContain('name="mobileNumber"');
    expect(html).toContain('value="India (IN) +91"');
    expect(html).toContain('data-dialing-code="91"');
    expect(html.match(/data-dialing-code="/gu)?.length).toBeGreaterThan(200);
    expect(html).toContain('toE164');
    expect(html).toContain('Email addresses do not match.');
    expect(html).toContain('name="confirmPassword"');
    expect(html).toContain('data-show');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('autocomplete="new-password"');
    expect(html).toContain('class="brand-panel"');
    expect(html).toContain('class="logo-surface"');
    expect(html).toContain('billiontalks-logo.png');
    expect(html).toContain('main[data-page="login"]');
    expect(html).toContain('color-scheme: light');
    expect(html).not.toContain("Recent Meetings");
  });

  it("keeps only the selected primary account page navigation item active", () => {
    const dom = new JSDOM(accountPage(), {
      runScripts: "dangerously",
      url: "https://example.com/account#register",
    });
    const navigation = [...dom.window.document.querySelectorAll("nav [data-page]")];
    const activePage = () => navigation.filter((button) => button.getAttribute("aria-current") === "page").map((button) => button.getAttribute("data-page"));

    expect(activePage()).toEqual(["register"]);
    dom.window.document.querySelector('nav [data-page="login"]')?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect(activePage()).toEqual(["login"]);
    dom.window.document.querySelector('[data-page="forgot"]')?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect(activePage()).toEqual([]);
    const recoveryBack = dom.window.document.getElementById("accountBackLink");
    expect(recoveryBack?.textContent).toBe("← Back to sign in");
    expect(recoveryBack?.getAttribute("href")).toBe("/account#login");
    recoveryBack?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(dom.window.document.querySelector('section[data-panel="login"]')?.hasAttribute("hidden")).toBe(false);
    expect(recoveryBack?.textContent).toBe("← Back to meetings");
    expect(dom.window.document.querySelectorAll("#publicAccountNavigation [data-page]")).toHaveLength(2);
    expect(dom.window.document.querySelector("#publicAccountNavigation a[href='/notifications']")).toBeNull();
    expect(dom.window.document.querySelector("#workspaceAccountNavigation a[data-page='profile'][href='/account#profile']")).not.toBeNull();
    expect(dom.window.document.querySelector("#workspaceAccountNavigation a[data-page='preferences'][href='/account#preferences']")).not.toBeNull();
    expect(dom.window.document.querySelector('section[data-panel="preferences"] a[data-page="profile"][href="/account#profile"]')?.textContent).toBe("Manage profile");
    expect(accountPage()).toContain("if (initialPage === 'login' || initialPage === 'register') location.replace('/dashboard');");
    dom.window.close();

    const resetDom = new JSDOM(accountPage(), {
      runScripts: "dangerously",
      url: `https://example.com/account?token=${"R".repeat(43)}&flow=reset`,
    });
    const resetBack = resetDom.window.document.getElementById("accountBackLink");
    expect(resetDom.window.document.querySelector("main")?.dataset.page).toBe("reset");
    expect(resetBack?.textContent).toBe("← Back to sign in");
    resetBack?.dispatchEvent(new resetDom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(resetDom.window.document.querySelector('section[data-panel="login"]')?.hasAttribute("hidden")).toBe(false);
    resetDom.window.close();
  });

  it("uses the premium sign-in treatment with only relevant public navigation", () => {
    const dom = new JSDOM(accountPage(), {
      runScripts: "dangerously",
      url: "https://example.com/account#login",
    });
    const main = dom.window.document.querySelector("main");
    expect(main?.dataset.page).toBe("login");
    expect(main?.querySelectorAll('.logo-surface img[alt="BillionTalks"]').length).toBe(2);
    expect(main?.querySelector('nav [data-page="login"]')?.getAttribute("aria-current")).toBe("page");
    expect(main?.querySelector('nav [data-page="register"]')?.hasAttribute("aria-current")).toBe(false);
    expect(main?.querySelector("#publicAccountNavigation [data-page='profile']")).toBeNull();
    expect(main?.querySelector("#publicAccountNavigation [data-page='preferences']")).toBeNull();
    dom.window.close();
  });

  it("shows session-verified workspace navigation to signed-in users", async () => {
    const dom = new JSDOM(accountPage(), {
      runScripts: "dangerously",
      url: "https://example.com/account#preferences",
      beforeParse(window) {
        window.fetch = vi.fn(async (input) => {
          const path = String(input);
          if (path === "/api/accounts/me") {
            return { status: 200, ok: true, json: async () => ({ ok: true, data: { account: { id: "acct_test" } } }) } as Response;
          }
          return { status: 200, ok: true, json: async () => ({ ok: true, data: { preferences: {}, entitlement: {} } }) } as Response;
        });
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dom.window.document.getElementById("publicAccountNavigation")?.hidden).toBe(true);
    expect(dom.window.document.getElementById("workspaceAccountNavigation")?.hidden).toBe(false);
    expect(dom.window.document.querySelector('#workspaceAccountNavigation a[data-account-workspace-page="preferences"]')?.getAttribute("aria-current")).toBe("page");
    const profileLink = dom.window.document.querySelector('#workspaceAccountNavigation a[data-page="profile"]');
    profileLink?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(dom.window.document.querySelector('section[data-panel="profile"]')?.hasAttribute("hidden")).toBe(false);
    expect(profileLink?.getAttribute("aria-current")).toBe("page");
    const settingsLink = dom.window.document.querySelector('#workspaceAccountNavigation a[data-page="preferences"]');
    settingsLink?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(dom.window.document.querySelector('section[data-panel="preferences"]')?.hasAttribute("hidden")).toBe(false);
    expect(settingsLink?.getAttribute("aria-current")).toBe("page");
    dom.window.close();
  });

  it("fails closed when account email delivery is not configured", async () => {
    const response = await app.fetch(new Request("https://example.com/api/accounts/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }), {});
    expect(response.status).toBe(503);
  });

  it("rejects cross-origin account mutations before authentication or storage access", async () => {
    const response = await app.fetch(new Request("https://example.com/api/accounts/me", {
      method: "PATCH",
      headers: {
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fullName: "Attacker" }),
    }), {});
    expect(response.status).toBe(403);
  });
});
