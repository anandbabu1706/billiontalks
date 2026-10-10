import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountEmailSender } from "../src/account/email-delivery";
import { accountPage } from "../src/account/ui";
import app from "../src/index";

const config = { RESEND_API_KEY: "test-key", ACCOUNT_EMAIL_FROM: "BillionTalks <no-reply@example.com>", ACCOUNT_PUBLIC_ORIGIN: "https://example.com/" };
afterEach(() => vi.unstubAllGlobals());

describe("BT-V1-001 transactional email", () => {
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
    expect(html).toContain('name="mobileNumber"');
    expect(html).toContain('pattern="[+][1-9][0-9]{1,14}"');
    expect(html).toContain('name="confirmPassword"');
    expect(html).toContain('data-show');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('autocomplete="new-password"');
    expect(html).not.toContain("Recent Meetings");
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
