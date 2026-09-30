import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Account, AccountId } from "../src/account/domain";
import { D1EmailVerificationRepository, EmailVerificationService } from "../src/account/email-verification";
import { AccountAuthenticationService } from "../src/account/authentication";
import { D1PasswordResetRepository, PasswordResetService } from "../src/account/password-reset";
import { hashPassword, verifyPassword } from "../src/account/password";
import { AccountIdentityConflictError, D1AccountRepository, type AccountRepository, type D1AccountDatabase, type D1AccountStatement } from "../src/account/repository";
import { AccountService } from "../src/account/service";
import {
  AccountValidationError,
  normalizeCountryCode,
  normalizeEmail,
  normalizeMobileNumber,
  validatePassword,
} from "../src/account/validation";
import app from "../src/index";

function createAccountDatabaseFixture() {
  const emails = new Set<string>();
  const mobiles = new Set<string>();
  const credentials = new Map<string, string>();
  const accounts = new Map<string, Record<string, unknown>>();
  const tokens = new Map<string, Record<string, unknown>>();
  const resetTokens = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, Record<string, unknown>>();
  const loginRateLimits = new Map<string, { window_started_at: string; attempt_count: number; updated_at: string }>();
  let database: D1AccountDatabase;
  database = {
    prepare(query) {
      const statement = { query, values: [] as unknown[] };
      let prepared: D1AccountStatement & { statement: typeof statement };
      prepared = {
        bind(...values: unknown[]) {
          statement.values = values;
          return prepared;
        },
        first: async <T>() => {
          if (query.includes("INSERT INTO account_login_rate_limits")) {
            const [scopeHash, now, _createdAt, windowResetBefore] = statement.values as [string, string, string, string];
            const existing = loginRateLimits.get(scopeHash);
            const expired = existing !== undefined && existing.window_started_at <= windowResetBefore;
            const next = {
              window_started_at: !existing || expired ? now : existing.window_started_at,
              attempt_count: !existing || expired ? 1 : existing.attempt_count + 1,
              updated_at: now,
            };
            loginRateLimits.set(scopeHash, next);
            return { attempt_count: next.attempt_count } as T;
          }
          if (query.includes("FROM accounts a") && query.includes("password_hash")) {
            const account = [...accounts.values()].find((row) => row.email_normalized === statement.values[0]);
            if (!account) return null;
            return { ...account, password_hash: credentials.get(account.id as string) } as T;
          }
          if (query.includes("FROM account_sessions s")) {
            const session = sessions.get(statement.values[0] as string);
            const account = session ? accounts.get(session.account_id as string) : undefined;
            if (
              !session || !account || session.revoked_at !== null || String(session.expires_at) <= String(statement.values[1]) ||
              account.status !== "ACTIVE" || account.email_verified_at === null
            ) return null;
            return account as T;
          }
          if (query.includes("FROM account_password_reset_tokens")) {
            const token = [...resetTokens.values()].find((row) =>
              row.token_hash === statement.values[0] && row.purpose === "PASSWORD_RESET" &&
              row.consumed_at === null && row.revoked_at === null && String(row.expires_at) > String(statement.values[1]),
            );
            return token ? { id: token.id } as T : null;
          }
          const match = query.includes("WHERE email_normalized = ?")
            ? [...accounts.values()].find((account) => account.email_normalized === statement.values[0])
            : query.includes("WHERE mobile_e164 = ?")
              ? [...accounts.values()].find((account) => account.mobile_e164 === statement.values[0])
              : undefined;
          return (match ?? null) as T | null;
        },
        run: async () => {
          const results = await database.batch([prepared]);
          return results[0];
        },
        statement,
      };
      return prepared;
    },
    async batch(batchStatements) {
      const results: Array<{ meta: { changes: number } }> = [];
      for (const batchStatement of batchStatements) {
        const { query, values } = (batchStatement as unknown as { statement: { query: string; values: unknown[] } }).statement;
        let changes = 0;
        if (query.includes("INSERT INTO accounts")) {
          const accountId = values[0] as string;
          const email = values[2] as string;
          const mobile = values[4] as string;
          if (emails.has(email)) throw new Error("UNIQUE constraint failed: accounts.email_normalized");
          if (mobiles.has(mobile)) throw new Error("UNIQUE constraint failed: accounts.mobile_e164");
          accounts.set(accountId, {
            id: accountId,
            full_name: values[1],
            email_normalized: email,
            country_code: values[3],
            mobile_e164: mobile,
            status: values[5],
            email_verified_at: values[6],
            mobile_verified_at: values[7],
            terms_accepted_at: values[8],
            terms_version: values[9],
            marketing_consent: values[10],
            marketing_consent_at: values[11],
            created_at: values[12],
            updated_at: values[13],
          });
          emails.add(email);
          mobiles.add(mobile);
          changes = 1;
        } else if (query.includes("INSERT INTO account_password_credentials")) {
          credentials.set(values[0] as string, values[1] as string);
          changes = 1;
        } else if (query.includes("INSERT INTO email_verification_tokens")) {
          const isInitialInsert = query.includes("VALUES (?, ?, ?, ?, ?, ?)");
          const [tokenId, accountId, tokenHash, purpose, createdAt, expiresAt] = values as [string, string, string, string, string, string];
          const cooldownSince = isInitialInsert ? null : values[9] as string;
          const account = accounts.get(accountId);
          const recentToken = cooldownSince && [...tokens.values()].some((token) =>
            token.account_id === accountId && token.purpose === purpose && String(token.created_at) > cooldownSince,
          );
          if (!account || account.email_verified_at !== null || recentToken) {
            results.push({ meta: { changes: 0 } });
            continue;
          }
          tokens.set(tokenId, {
            id: tokenId,
            account_id: accountId,
            token_hash: tokenHash,
            purpose,
            created_at: createdAt,
            expires_at: expiresAt,
            consumed_at: null,
            consumed_operation_id: null,
            revoked_at: null,
            superseded_by_token_id: null,
          });
          changes = 1;
        } else if (query.includes("INSERT INTO account_password_reset_tokens")) {
          const [tokenId, accountId, tokenHash, purpose, createdAt, expiresAt, , , , cooldownSince] = values as [string, string, string, string, string, string, string, string, string, string];
          const account = accounts.get(accountId);
          const recentlyRequested = [...resetTokens.values()].some((token) =>
            token.account_id === accountId && token.purpose === purpose && String(token.created_at) > cooldownSince,
          );
          if (!account || account.status !== "ACTIVE" || account.email_verified_at === null || recentlyRequested) {
            results.push({ meta: { changes: 0 } });
            continue;
          }
          resetTokens.set(tokenId, {
            id: tokenId,
            account_id: accountId,
            token_hash: tokenHash,
            purpose,
            created_at: createdAt,
            expires_at: expiresAt,
            consumed_at: null,
            consumed_operation_id: null,
            revoked_at: null,
            superseded_by_token_id: null,
          });
          changes = 1;
        } else if (query.includes("SET revoked_at = ?") && query.includes("account_password_reset_tokens")) {
          const [revokedAt, replacementId, accountId, purpose, excludedId] = values as [string, string, string, string, string];
          if (resetTokens.has(replacementId)) {
            for (const token of resetTokens.values()) {
              if (
                token.account_id === accountId && token.purpose === purpose && token.id !== excludedId &&
                token.consumed_at === null && token.revoked_at === null
              ) {
                token.revoked_at = revokedAt;
                token.superseded_by_token_id = replacementId;
                changes += 1;
              }
            }
          }
        } else if (query.includes("SET consumed_at = ?") && query.includes("account_password_reset_tokens")) {
          const [consumedAt, operationId, tokenHash, now] = values as [string, string, string, string];
          const token = [...resetTokens.values()].find((row) => row.token_hash === tokenHash);
          if (token && token.purpose === "PASSWORD_RESET" && token.consumed_at === null && token.revoked_at === null && String(token.expires_at) > now) {
            token.consumed_at = consumedAt;
            token.consumed_operation_id = operationId;
            changes = 1;
          }
        } else if (query.includes("UPDATE account_password_credentials")) {
          const [passwordHash, changedAt, tokenHash, operationId, consumedAt] = values as [string, string, string, string, string];
          const token = [...resetTokens.values()].find((row) =>
            row.token_hash === tokenHash && row.consumed_operation_id === operationId && row.consumed_at === consumedAt,
          );
          if (token) {
            credentials.set(token.account_id as string, passwordHash);
            changes = 1;
          }
          void changedAt;
        } else if (query.includes("UPDATE account_sessions") && query.includes("account_password_reset_tokens")) {
          const [revokedAt, tokenHash, operationId, consumedAt] = values as [string, string, string, string];
          const token = [...resetTokens.values()].find((row) =>
            row.token_hash === tokenHash && row.consumed_operation_id === operationId && row.consumed_at === consumedAt,
          );
          if (token) {
            for (const session of sessions.values()) {
              if (session.account_id === token.account_id) session.revoked_at ??= revokedAt;
            }
            changes = 1;
          }
        } else if (query.includes("SET revoked_at = ?")) {
          const [revokedAt, replacementId, accountId, purpose, excludedId] = values as [string, string, string, string, string];
          if (tokens.has(replacementId)) {
            for (const token of tokens.values()) {
              if (
                token.account_id === accountId && token.purpose === purpose && token.id !== excludedId &&
                token.consumed_at === null && token.revoked_at === null
              ) {
                token.revoked_at = revokedAt;
                token.superseded_by_token_id = replacementId;
                changes += 1;
              }
            }
          }
        } else if (query.includes("SET consumed_at = ?")) {
          const [consumedAt, operationId, tokenHash, now] = values as [string, string, string, string];
          const token = [...tokens.values()].find((row) => row.token_hash === tokenHash);
          if (token && token.purpose === "EMAIL_VERIFICATION" && token.consumed_at === null && token.revoked_at === null && String(token.expires_at) > now) {
            token.consumed_at = consumedAt;
            token.consumed_operation_id = operationId;
            changes = 1;
          }
        } else if (query.includes("UPDATE accounts")) {
          const [verifiedAt, updatedAt, tokenHash, operationId, consumedAt] = values as [string, string, string, string, string];
          const token = [...tokens.values()].find((row) =>
            row.token_hash === tokenHash && row.consumed_operation_id === operationId && row.consumed_at === consumedAt,
          );
          const account = token ? accounts.get(token.account_id as string) : undefined;
          if (account) {
            account.email_verified_at ??= verifiedAt;
            if (account.status === "PENDING_EMAIL_VERIFICATION") account.status = "ACTIVE";
            account.updated_at = updatedAt;
            changes = 1;
          }
        } else if (query.includes("DELETE FROM account_login_rate_limits")) {
          if (query.includes("updated_at <")) {
            const cutoff = values[0] as string;
            for (const [scopeHash, record] of loginRateLimits) {
              if (record.updated_at < cutoff) loginRateLimits.delete(scopeHash);
            }
          } else {
            changes = loginRateLimits.delete(values[0] as string) ? 1 : 0;
          }
        } else if (query.includes("INSERT INTO account_sessions")) {
          const [tokenHash, accountId, createdAt, expiresAt, lastUsedAt] = values as [string, string, string, string, string];
          const account = accounts.get(accountId);
          if (!account || account.status !== "ACTIVE" || account.email_verified_at === null) {
            results.push({ meta: { changes: 0 } });
            continue;
          }
          sessions.set(tokenHash, {
            token_hash: tokenHash,
            account_id: accountId,
            created_at: createdAt,
            expires_at: expiresAt,
            last_used_at: lastUsedAt,
            revoked_at: null,
          });
          changes = 1;
        } else if (query.includes("UPDATE account_sessions SET last_used_at")) {
          const [lastUsedAt, tokenHash, now] = values as [string, string, string];
          const session = sessions.get(tokenHash);
          const account = session ? accounts.get(session.account_id as string) : undefined;
          if (
            session && account && session.revoked_at === null && String(session.expires_at) > now &&
            account.status === "ACTIVE" && account.email_verified_at !== null
          ) {
            session.last_used_at = lastUsedAt;
            changes = 1;
          }
        } else if (query.includes("UPDATE account_sessions SET revoked_at")) {
          const [revokedAt, tokenHash] = values as [string, string];
          const session = sessions.get(tokenHash);
          if (session) {
            session.revoked_at ??= revokedAt;
            changes = 1;
          }
        } else {
          throw new Error(`Unexpected account SQL: ${query}`);
        }
        results.push({ meta: { changes } });
      }
      return results;
    },
  };
  return { database, emails, mobiles, credentials, accounts, tokens, resetTokens, sessions, loginRateLimits };
}

let verifiedAccountPasswordHash = "";
beforeAll(async () => {
  verifiedAccountPasswordHash = await hashPassword("a long passphrase");
});

function seedVerifiedAccount(
  fixture: ReturnType<typeof createAccountDatabaseFixture>,
  status: Account["status"] = "ACTIVE",
  emailVerifiedAt: string | null = "2026-09-30T12:00:00.000Z",
): Account {
  const account: Account = {
    id: "acct_login_test" as AccountId,
    fullName: "Jane Doe",
    email: "jane.doe@example.com",
    countryCode: "US",
    mobileNumber: "+14155550100",
    status,
    emailVerifiedAt,
    mobileVerifiedAt: null,
    termsAcceptedAt: "2026-09-30T12:00:00.000Z",
    termsVersion: "terms-v1",
    marketingConsent: false,
    marketingConsentAt: null,
    createdAt: "2026-09-30T12:00:00.000Z",
    updatedAt: "2026-09-30T12:00:00.000Z",
  };
  fixture.accounts.set(account.id, {
    id: account.id,
    full_name: account.fullName,
    email_normalized: account.email,
    country_code: account.countryCode,
    mobile_e164: account.mobileNumber,
    status: account.status,
    email_verified_at: account.emailVerifiedAt,
    mobile_verified_at: account.mobileVerifiedAt,
    terms_accepted_at: account.termsAcceptedAt,
    terms_version: account.termsVersion,
    marketing_consent: 0,
    marketing_consent_at: null,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  });
  fixture.emails.add(account.email);
  fixture.mobiles.add(account.mobileNumber);
  fixture.credentials.set(account.id, verifiedAccountPasswordHash);
  return account;
}

function registrationRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/accounts/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function accountRequest(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function loginRequest(email: string, password: string, ip = "203.0.113.10"): Request {
  return new Request("https://localhost/api/accounts/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify({ email, password }),
  });
}

function accountCookie(response: Response): string {
  const cookie = response.headers.get("Set-Cookie")?.split(";")[0];
  if (!cookie) throw new Error("Account session cookie was not issued.");
  return cookie;
}

function meRequest(cookie?: string): Request {
  return new Request("https://localhost/api/accounts/me", {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function logoutRequest(cookie?: string): Request {
  return new Request("https://localhost/api/accounts/logout", {
    method: "POST",
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function forgotPasswordRequest(email: string, ip = "203.0.113.40"): Request {
  return new Request("http://localhost/api/accounts/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ email }),
  });
}

function resetPasswordRequest(token: string, newPassword: string): Request {
  return new Request("http://localhost/api/accounts/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
}

function validRegistration(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Jane Doe",
    email: "Jane.Doe@example.com",
    country: "US",
    mobileNumber: "+1 (415) 555-0100",
    password: "a long passphrase",
    acceptedTerms: true,
    ...overrides,
  };
}

async function registerFixtureAccount(fixture: ReturnType<typeof createAccountDatabaseFixture>): Promise<Account> {
  const response = await app.fetch(registrationRequest(validRegistration()), { ACCOUNT_DB: fixture.database });
  const payload = await response.json() as { data: { account: Account } };
  if (response.status !== 201) throw new Error("Account fixture registration failed.");
  return payload.data.account;
}

describe("account identity validation", () => {
  it("normalizes email without removing plus tags or dots", () => {
    expect(normalizeEmail("  Jane.Doe+talks@BÜCHER.de ")).toBe("jane.doe+talks@xn--bcher-kva.de");
  });

  it("rejects malformed email, country, and mobile values", () => {
    expect(() => normalizeEmail("not-an-email")).toThrow(AccountValidationError);
    expect(() => normalizeEmail("jane@example.com/path")).toThrow(AccountValidationError);
    expect(() => normalizeCountryCode("ZZ")).toThrow(AccountValidationError);
    expect(() => normalizeMobileNumber("415 555 0100")).toThrow(AccountValidationError);
  });

  it("normalizes country and international mobile formatting", () => {
    expect(normalizeCountryCode(" us ")).toBe("US");
    expect(normalizeMobileNumber("+1 (415) 555-0100")).toBe("+14155550100");
  });

  it("accepts simple and long passphrases without composition rules", () => {
    expect(() => validatePassword("correct horse battery staple")).not.toThrow();
    expect(() => validatePassword("password")).not.toThrow();
    expect(() => validatePassword("short")).toThrow(AccountValidationError);
    expect(() => validatePassword("a".repeat(1025))).toThrow(AccountValidationError);
  });
});

describe("account service", () => {
  it("persists normalized account data and returns no credential fields", async () => {
    const create = vi.fn(async (_account: Account, _passwordHash: string) => {});
    const repository: AccountRepository = {
      create,
      findByEmail: async () => null,
      findByMobileNumber: async () => null,
    };
    const service = new AccountService(
      repository,
      async (password) => `hash:${password}`,
      () => new Date("2026-09-30T12:00:00.000Z"),
      () => "acct_test" as AccountId,
    );

    const account = await service.create({
      fullName: " Jane Doe ",
      email: "Jane.Doe@example.com",
      countryCode: "us",
      mobileNumber: "+1 (415) 555-0100",
      password: "password",
      acceptedTerms: true,
      termsVersion: "2026-09",
      marketingConsent: true,
    });

    expect(account).toMatchObject({
      id: "acct_test",
      fullName: "Jane Doe",
      email: "jane.doe@example.com",
      countryCode: "US",
      mobileNumber: "+14155550100",
      status: "PENDING_EMAIL_VERIFICATION",
      emailVerifiedAt: null,
      mobileVerifiedAt: null,
      termsAcceptedAt: "2026-09-30T12:00:00.000Z",
      termsVersion: "2026-09",
      marketingConsent: true,
      marketingConsentAt: "2026-09-30T12:00:00.000Z",
    });
    expect(Object.keys(account)).not.toContain("password");
    expect(Object.keys(account)).not.toContain("passwordHash");
    expect(create).toHaveBeenCalledWith(account, "hash:password");
  });

  it("requires explicit Terms acceptance and uses one conflict type for duplicate identities", async () => {
    const repository: AccountRepository = {
      create: async () => { throw new AccountIdentityConflictError(); },
      findByEmail: async () => null,
      findByMobileNumber: async () => null,
    };
    const service = new AccountService(repository, async () => "test-hash");
    const input = {
      fullName: "Jane Doe",
      email: "jane@example.com",
      countryCode: "US",
      mobileNumber: "+14155550100",
      password: "password",
      acceptedTerms: false,
      termsVersion: "2026-09",
    };

    await expect(service.create(input)).rejects.toBeInstanceOf(AccountValidationError);
    await expect(service.create({ ...input, acceptedTerms: true })).rejects.toBeInstanceOf(AccountIdentityConflictError);
  });
});

describe("password hashing", () => {
  it("uses a salted, self-describing PBKDF2 hash instead of returning the password", async () => {
    const password = "a long passphrase without symbols";
    const hash = await hashPassword(password);
    expect(hash).toMatch(/^pbkdf2-sha256\$600000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u);
    expect(hash).not.toContain(password);
  });
});

describe("account registration API", () => {
  it("creates an unverified account and returns only safe public data", async () => {
    const fixture = createAccountDatabaseFixture();
    const password = "a long passphrase";
    const response = await app.fetch(registrationRequest(validRegistration({ password, marketingConsent: true })), {
      ACCOUNT_DB: fixture.database,
    });
    const payload = await response.json() as { ok: boolean; data: { account: Account; emailVerificationRequired: boolean } };

    expect(response.status).toBe(201);
    expect(payload.data.emailVerificationRequired).toBe(true);
    expect(payload.data.account).toMatchObject({
      id: expect.stringMatching(/^acct_/u),
      email: "jane.doe@example.com",
      countryCode: "US",
      mobileNumber: "+14155550100",
      status: "PENDING_EMAIL_VERIFICATION",
      emailVerifiedAt: null,
      mobileVerifiedAt: null,
      marketingConsent: true,
    });
    expect(JSON.stringify(payload)).not.toContain(password);
    expect(JSON.stringify(payload)).not.toContain("passwordHash");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const storedHash = [...fixture.credentials.values()][0];
    expect(storedHash).toMatch(/^pbkdf2-sha256\$600000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u);
    expect(storedHash).not.toContain(password);
    expect(fixture.tokens.size).toBe(1);
    const verificationRecord = [...fixture.tokens.values()][0];
    expect(verificationRecord.token_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Date.parse(verificationRecord.expires_at as string) - Date.parse(verificationRecord.created_at as string)).toBe(24 * 60 * 60 * 1000);
    expect(JSON.stringify(payload)).not.toContain(verificationRecord.token_hash as string);
    expect(Object.keys(payload.data.account)).not.toContain("verificationToken");
    expect(Object.keys(payload.data.account)).not.toContain("tokenHash");
  });

  it("stores marketing consent as false when it is omitted", async () => {
    const fixture = createAccountDatabaseFixture();
    const response = await app.fetch(registrationRequest(validRegistration()), { ACCOUNT_DB: fixture.database });
    const payload = await response.json() as { data: { account: Account } };
    expect(response.status).toBe(201);
    expect(payload.data.account.marketingConsent).toBe(false);
    expect(payload.data.account.marketingConsentAt).toBeNull();
  });

  it.each([
    ["invalid country", { country: "ZZ" }],
    ["invalid mobile", { mobileNumber: "4155550100" }],
    ["short password", { password: "short" }],
    ["Terms not accepted", { acceptedTerms: false }],
  ])("rejects %s", async (_caseName, override) => {
    const fixture = createAccountDatabaseFixture();
    const response = await app.fetch(registrationRequest(validRegistration(override)), { ACCOUNT_DB: fixture.database });
    expect(response.status).toBe(400);
    expect(fixture.credentials.size).toBe(0);
  });

  it("rejects duplicate normalized email and duplicate mobile with generic conflicts", async () => {
    const emailFixture = createAccountDatabaseFixture();
    const firstEmail = await app.fetch(registrationRequest(validRegistration()), { ACCOUNT_DB: emailFixture.database });
    const duplicateEmail = await app.fetch(registrationRequest(validRegistration({ email: " jane.doe@EXAMPLE.com " })), { ACCOUNT_DB: emailFixture.database });
    expect(firstEmail.status).toBe(201);
    expect(duplicateEmail.status).toBe(409);

    const mobileFixture = createAccountDatabaseFixture();
    const firstMobile = await app.fetch(registrationRequest(validRegistration()), { ACCOUNT_DB: mobileFixture.database });
    const duplicateMobile = await app.fetch(registrationRequest(validRegistration({ email: "other@example.com" })), { ACCOUNT_DB: mobileFixture.database });
    expect(firstMobile.status).toBe(201);
    expect(duplicateMobile.status).toBe(409);
    expect(await duplicateMobile.json()).toEqual({ ok: false, error: "An account with these details could not be registered." });
  });

  it("allows at most one of concurrent registrations with the same email", async () => {
    const fixture = createAccountDatabaseFixture();
    const responses = await Promise.all([
      app.fetch(registrationRequest(validRegistration()), { ACCOUNT_DB: fixture.database }),
      app.fetch(registrationRequest(validRegistration({ mobileNumber: "+442071838750" })), { ACCOUNT_DB: fixture.database }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(fixture.emails.size).toBe(1);
    expect(fixture.credentials.size).toBe(1);
  });

  it("verifies an account with a valid token and consumes it", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = await registerFixtureAccount(fixture);
    const now = new Date(Date.parse(account.createdAt) + 61_000);
    const verification = new EmailVerificationService(
      new D1AccountRepository(fixture.database),
      new D1EmailVerificationRepository(fixture.database),
      () => now,
      () => "V".repeat(43),
      () => "ev_valid",
    );
    const token = await verification.issueForAccount(account.id);
    expect(token).toBe("V".repeat(43));

    const response = await app.fetch(accountRequest("/api/accounts/verify-email", { token: token! }), { ACCOUNT_DB: fixture.database });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { emailVerified: true } });
    expect(fixture.accounts.get(account.id)?.email_verified_at).not.toBeNull();
    expect(fixture.accounts.get(account.id)?.status).toBe("ACTIVE");
    expect([...fixture.tokens.values()].find((record) => record.id === "ev_valid")?.consumed_at).not.toBeNull();
  });

  it("rejects invalid and expired verification tokens", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = await registerFixtureAccount(fixture);
    const invalidResponse = await app.fetch(accountRequest("/api/accounts/verify-email", { token: "not-a-valid-token" }), { ACCOUNT_DB: fixture.database });
    expect(invalidResponse.status).toBe(400);

    const storedToken = [...fixture.tokens.values()][0];
    storedToken.expires_at = "2020-01-01T00:00:00.000Z";
    const token = "E".repeat(43);
    const verification = new EmailVerificationService(
      new D1AccountRepository(fixture.database),
      new D1EmailVerificationRepository(fixture.database),
      () => new Date(Date.parse(account.createdAt) + 61_000),
      () => token,
      () => "ev_expired",
    );
    const expiredToken = await verification.issueForAccount(account.id);
    expect(expiredToken).toBe(token);
    const expiredRecord = [...fixture.tokens.values()].find((record) => record.id === "ev_expired")!;
    expiredRecord.expires_at = "2020-01-01T00:00:00.000Z";
    const expiredResponse = await app.fetch(accountRequest("/api/accounts/verify-email", { token }), { ACCOUNT_DB: fixture.database });
    expect(expiredResponse.status).toBe(400);
    expect(fixture.accounts.get(account.id)?.email_verified_at).toBeNull();
  });

  it("does not allow a consumed token to be reused", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = await registerFixtureAccount(fixture);
    const token = "C".repeat(43);
    const verification = new EmailVerificationService(
      new D1AccountRepository(fixture.database),
      new D1EmailVerificationRepository(fixture.database),
      () => new Date(Date.parse(account.createdAt) + 61_000),
      () => token,
      () => "ev_consumed",
    );
    await verification.issueForAccount(account.id);

    const first = await app.fetch(accountRequest("/api/accounts/verify-email", { token }), { ACCOUNT_DB: fixture.database });
    const second = await app.fetch(accountRequest("/api/accounts/verify-email", { token }), { ACCOUNT_DB: fixture.database });
    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
  });

  it("supersedes the previous token on resend and stores no plaintext token", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = await registerFixtureAccount(fixture);
    const original = [...fixture.tokens.values()][0];
    const plaintextToken = "R".repeat(43);
    const resendTime = new Date(Date.parse(account.createdAt) + 61_000);
    const verification = new EmailVerificationService(
      new D1AccountRepository(fixture.database),
      new D1EmailVerificationRepository(fixture.database),
      () => resendTime,
      () => plaintextToken,
      () => "ev_resend",
    );
    expect(await verification.resend(account.email)).toBe(plaintextToken);
    expect(original.revoked_at).not.toBeNull();
    expect(original.superseded_by_token_id).toBe("ev_resend");
    expect(JSON.stringify([...fixture.tokens.values()])).not.toContain(plaintextToken);
    expect([...fixture.tokens.values()].every((record) => !Object.values(record).includes(plaintextToken))).toBe(true);

    const supersededResponse = await app.fetch(accountRequest("/api/accounts/verify-email", { token: "S".repeat(43) }), { ACCOUNT_DB: fixture.database });
    expect(supersededResponse.status).toBe(400);
    const validResponse = await app.fetch(accountRequest("/api/accounts/verify-email", { token: plaintextToken }), { ACCOUNT_DB: fixture.database });
    expect(validResponse.status).toBe(200);
  });

  it("returns a generic resend response for existing and unknown accounts", async () => {
    const fixture = createAccountDatabaseFixture();
    await registerFixtureAccount(fixture);
    const existing = await app.fetch(accountRequest("/api/accounts/resend-verification", { email: "jane.doe@example.com" }), { ACCOUNT_DB: fixture.database });
    const unknown = await app.fetch(accountRequest("/api/accounts/resend-verification", { email: "missing@example.com" }), { ACCOUNT_DB: fixture.database });
    expect(existing.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await existing.json()).toEqual(await unknown.json());
    expect(fixture.tokens.size).toBe(1);
  });

  it("does not issue another token to a verified account", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = await registerFixtureAccount(fixture);
    const token = "A".repeat(43);
    const initialVerification = new EmailVerificationService(
      new D1AccountRepository(fixture.database),
      new D1EmailVerificationRepository(fixture.database),
      () => new Date(Date.parse(account.createdAt) + 61_000),
      () => token,
      () => "ev_verify_before_resend",
    );
    await initialVerification.issueForAccount(account.id);
    await app.fetch(accountRequest("/api/accounts/verify-email", { token }), { ACCOUNT_DB: fixture.database });

    const countBeforeResend = fixture.tokens.size;
    const verifiedAccountResend = new EmailVerificationService(
      new D1AccountRepository(fixture.database),
      new D1EmailVerificationRepository(fixture.database),
      () => new Date(Date.parse(account.createdAt) + 120_000),
      () => "B".repeat(43),
      () => "ev_should_not_exist",
    );
    expect(await verifiedAccountResend.resend(account.email)).toBeNull();
    expect(fixture.tokens.size).toBe(countBeforeResend);
  });

  it("atomically allows only one concurrent verification to consume a token", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = await registerFixtureAccount(fixture);
    const token = "Q".repeat(43);
    const verification = new EmailVerificationService(
      new D1AccountRepository(fixture.database),
      new D1EmailVerificationRepository(fixture.database),
      () => new Date(Date.parse(account.createdAt) + 61_000),
      () => token,
      () => "ev_concurrent",
    );
    await verification.issueForAccount(account.id);

    const responses = await Promise.all([
      app.fetch(accountRequest("/api/accounts/verify-email", { token }), { ACCOUNT_DB: fixture.database }),
      app.fetch(accountRequest("/api/accounts/verify-email", { token }), { ACCOUNT_DB: fixture.database }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 400]);
    expect(fixture.accounts.get(account.id)?.email_verified_at).not.toBeNull();
  });
});

describe("account login and session APIs", () => {
  it("logs in a verified account, issues a secure cookie, and stores only the token hash", async () => {
    const fixture = createAccountDatabaseFixture();
    seedVerifiedAccount(fixture);
    const response = await app.fetch(loginRequest(" Jane.Doe@EXAMPLE.com ", "a long passphrase"), { ACCOUNT_DB: fixture.database });
    const payload = await response.json() as { data: { account: Account } };
    const cookie = accountCookie(response);
    const token = cookie.slice(cookie.indexOf("=") + 1);

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
    expect(response.headers.get("Set-Cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("Set-Cookie")).toContain("Path=/api/accounts");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=604800");
    expect(payload.data.account.email).toBe("jane.doe@example.com");
    expect(JSON.stringify(payload)).not.toContain("password");
    expect(JSON.stringify(payload)).not.toContain("passwordHash");
    expect(JSON.stringify(payload)).not.toContain(token);
    expect(fixture.sessions.size).toBe(1);
    expect([...fixture.sessions.keys()][0]).toMatch(/^[a-f0-9]{64}$/u);
    expect([...fixture.sessions.keys()]).not.toContain(token);
  });

  it("returns the same generic failure for unknown emails, wrong passwords, unverified, and disabled accounts", async () => {
    const wrongPasswordFixture = createAccountDatabaseFixture();
    seedVerifiedAccount(wrongPasswordFixture);
    const wrongPassword = await app.fetch(loginRequest("jane.doe@example.com", "incorrect password"), { ACCOUNT_DB: wrongPasswordFixture.database });

    const unknownFixture = createAccountDatabaseFixture();
    const unknownEmail = await app.fetch(loginRequest("missing@example.com", "incorrect password"), { ACCOUNT_DB: unknownFixture.database });

    const unverifiedFixture = createAccountDatabaseFixture();
    seedVerifiedAccount(unverifiedFixture, "PENDING_EMAIL_VERIFICATION", null);
    const unverified = await app.fetch(loginRequest("jane.doe@example.com", "a long passphrase"), { ACCOUNT_DB: unverifiedFixture.database });

    const disabledFixture = createAccountDatabaseFixture();
    seedVerifiedAccount(disabledFixture, "SUSPENDED");
    const disabled = await app.fetch(loginRequest("jane.doe@example.com", "a long passphrase"), { ACCOUNT_DB: disabledFixture.database });

    const responses = [wrongPassword, unknownEmail, unverified, disabled];
    expect(responses.map(({ status }) => status)).toEqual([401, 401, 401, 401]);
    const payloads = await Promise.all(responses.map((response) => response.json()));
    expect(payloads).toEqual(Array(4).fill({ ok: false, error: "Invalid email or password." }));
    expect(responses.every((response) => !response.headers.has("Set-Cookie"))).toBe(true);
  });

  it("serves /me only for an active, unexpired, unrevoked session", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = seedVerifiedAccount(fixture);
    const login = await app.fetch(loginRequest(account.email, "a long passphrase"), { ACCOUNT_DB: fixture.database });
    const cookie = accountCookie(login);
    const me = await app.fetch(meRequest(cookie), { ACCOUNT_DB: fixture.database });
    const payload = await me.json() as { data: { account: Account } };
    expect(me.status).toBe(200);
    expect(payload.data.account.id).toBe(account.id);
    expect(JSON.stringify(payload)).not.toMatch(/password_hash|token_hash|passwordHash|sessionToken/iu);

    expect((await app.fetch(meRequest(), { ACCOUNT_DB: fixture.database })).status).toBe(401);
    const session = [...fixture.sessions.values()][0];
    session.expires_at = "2020-01-01T00:00:00.000Z";
    expect((await app.fetch(meRequest(cookie), { ACCOUNT_DB: fixture.database })).status).toBe(401);
  });

  it("logout revokes a session, clears the cookie, and is idempotent", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = seedVerifiedAccount(fixture);
    const login = await app.fetch(loginRequest(account.email, "a long passphrase"), { ACCOUNT_DB: fixture.database });
    const cookie = accountCookie(login);
    const firstLogout = await app.fetch(logoutRequest(cookie), { ACCOUNT_DB: fixture.database });
    const secondLogout = await app.fetch(logoutRequest(cookie), { ACCOUNT_DB: fixture.database });

    expect(firstLogout.status).toBe(200);
    expect(secondLogout.status).toBe(200);
    expect(firstLogout.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(firstLogout.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(firstLogout.headers.get("Set-Cookie")).toContain("Secure");
    expect([...fixture.sessions.values()][0].revoked_at).not.toBeNull();
    expect((await app.fetch(meRequest(cookie), { ACCOUNT_DB: fixture.database })).status).toBe(401);
  });

  it("keeps simultaneous sessions independent for multiple devices", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = seedVerifiedAccount(fixture);
    const firstLogin = await app.fetch(loginRequest(account.email, "a long passphrase", "203.0.113.11"), { ACCOUNT_DB: fixture.database });
    const secondLogin = await app.fetch(loginRequest(account.email, "a long passphrase", "203.0.113.12"), { ACCOUNT_DB: fixture.database });
    const firstCookie = accountCookie(firstLogin);
    const secondCookie = accountCookie(secondLogin);
    expect(firstCookie).not.toBe(secondCookie);
    expect(fixture.sessions.size).toBe(2);

    await app.fetch(logoutRequest(firstCookie), { ACCOUNT_DB: fixture.database });
    expect((await app.fetch(meRequest(firstCookie), { ACCOUNT_DB: fixture.database })).status).toBe(401);
    expect((await app.fetch(meRequest(secondCookie), { ACCOUNT_DB: fixture.database })).status).toBe(200);
  });

  it("limits repeated attempts in a resettable window without storing raw identifiers", async () => {
    const fixture = createAccountDatabaseFixture();
    let now = new Date("2026-09-30T12:00:00.000Z");
    const authentication = new AccountAuthenticationService(
      new D1AccountRepository(fixture.database),
      () => now,
      () => "T".repeat(43),
      () => "sess_test",
      async () => false,
    );
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(authentication.login("missing@example.com", "wrong password", "203.0.113.20")).resolves.toBeNull();
    }
    expect(fixture.loginRateLimits.size).toBe(2);
    expect([...fixture.loginRateLimits.keys()].every((key) => /^[a-f0-9]{64}$/u.test(key))).toBe(true);
    await expect(authentication.login("missing@example.com", "wrong password", "203.0.113.20")).resolves.toBeNull();
    expect([...fixture.loginRateLimits.values()].every((record) => record.attempt_count === 11)).toBe(true);

    now = new Date(now.getTime() + 15 * 60 * 1000 + 1);
    await expect(authentication.login("missing@example.com", "wrong password", "203.0.113.20")).resolves.toBeNull();
    expect([...fixture.loginRateLimits.values()].every((record) => record.attempt_count === 1)).toBe(true);
  });
});

describe("password reset APIs", () => {
  it("creates an internal reset token for known accounts but returns the same generic response for unknown addresses", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = seedVerifiedAccount(fixture);
    const now = new Date();
    const plaintextToken = "P".repeat(43);
    const reset = new PasswordResetService(
      new D1AccountRepository(fixture.database),
      new D1PasswordResetRepository(fixture.database),
      () => now,
      () => plaintextToken,
      () => "prt_known",
    );
    expect(await reset.requestReset(account.email, "203.0.113.41")).toBe(plaintextToken);

    const knownResponse = await app.fetch(forgotPasswordRequest(account.email), { ACCOUNT_DB: fixture.database });
    const unknownFixture = createAccountDatabaseFixture();
    const unknownResponse = await app.fetch(forgotPasswordRequest("missing@example.com"), { ACCOUNT_DB: unknownFixture.database });
    expect(knownResponse.status).toBe(202);
    expect(unknownResponse.status).toBe(202);
    const knownPayload = await knownResponse.json();
    expect(knownPayload).toEqual(await unknownResponse.json());
    expect(JSON.stringify(knownPayload)).not.toContain(plaintextToken);

    const record = [...fixture.resetTokens.values()][0];
    expect(record.token_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(record.purpose).toBe("PASSWORD_RESET");
    expect(Date.parse(record.expires_at as string) - Date.parse(record.created_at as string)).toBe(45 * 60 * 1000);
    expect(JSON.stringify(record)).not.toContain(plaintextToken);
    expect(Object.values(record)).not.toContain(plaintextToken);
  });

  it("resets the password, consumes the token, and revokes all account sessions", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = seedVerifiedAccount(fixture);
    const oldHash = fixture.credentials.get(account.id)!;
    fixture.sessions.set("session-hash-one", {
      token_hash: "session-hash-one",
      account_id: account.id,
      expires_at: "2026-10-07T12:00:00.000Z",
      revoked_at: null,
    });
    fixture.sessions.set("session-hash-two", {
      token_hash: "session-hash-two",
      account_id: account.id,
      expires_at: "2026-10-07T12:00:00.000Z",
      revoked_at: null,
    });
    const token = "V".repeat(43);
    const resetService = new PasswordResetService(
      new D1AccountRepository(fixture.database),
      new D1PasswordResetRepository(fixture.database),
      () => new Date(),
      () => token,
      () => "prt_valid",
    );
    await resetService.requestReset(account.email, "203.0.113.42");

    const response = await app.fetch(resetPasswordRequest(token, "new secure passphrase"), { ACCOUNT_DB: fixture.database });
    const payload = await response.json();
    const newHash = fixture.credentials.get(account.id)!;
    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, data: { passwordReset: true } });
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(newHash).not.toBe(oldHash);
    expect(newHash).toMatch(/^pbkdf2-sha256\$600000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u);
    expect(await verifyPassword("new secure passphrase", newHash)).toBe(true);
    expect(await verifyPassword("a long passphrase", newHash)).toBe(false);
    expect([...fixture.sessions.values()].every((session) => session.revoked_at !== null)).toBe(true);
    expect([...fixture.resetTokens.values()][0].consumed_at).not.toBeNull();
    expect(JSON.stringify(payload)).not.toMatch(/password_hash|passwordHash|token_hash|resetToken/iu);
    expect(JSON.stringify(payload)).not.toContain(token);

    const replay = await app.fetch(resetPasswordRequest(token, "another secure passphrase"), { ACCOUNT_DB: fixture.database });
    expect(replay.status).toBe(400);
  });

  it("rejects invalid and expired reset tokens", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = seedVerifiedAccount(fixture);
    const invalid = await app.fetch(resetPasswordRequest("invalid-token", "new secure passphrase"), { ACCOUNT_DB: fixture.database });
    expect(invalid.status).toBe(400);

    const token = "E".repeat(43);
    const resetService = new PasswordResetService(
      new D1AccountRepository(fixture.database),
      new D1PasswordResetRepository(fixture.database),
      () => new Date(),
      () => token,
      () => "prt_expired",
    );
    await resetService.requestReset(account.email, "203.0.113.43");
    [...fixture.resetTokens.values()][0].expires_at = "2020-01-01T00:00:00.000Z";
    const expired = await app.fetch(resetPasswordRequest(token, "new secure passphrase"), { ACCOUNT_DB: fixture.database });
    expect(expired.status).toBe(400);
    expect([...fixture.resetTokens.values()][0].consumed_at).toBeNull();
  });

  it("enforces the password minimum without consuming a valid reset token", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = seedVerifiedAccount(fixture);
    const token = "M".repeat(43);
    const resetService = new PasswordResetService(
      new D1AccountRepository(fixture.database),
      new D1PasswordResetRepository(fixture.database),
      () => new Date(),
      () => token,
      () => "prt_short_password",
    );
    await resetService.requestReset(account.email, "203.0.113.44");
    const response = await app.fetch(resetPasswordRequest(token, "short"), { ACCOUNT_DB: fixture.database });
    expect(response.status).toBe(400);
    expect([...fixture.resetTokens.values()][0].consumed_at).toBeNull();
    expect(fixture.credentials.get(account.id)).toBe(verifiedAccountPasswordHash);
  });

  it("supersedes older tokens and enforces the per-account request cooldown", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = seedVerifiedAccount(fixture);
    let now = new Date();
    let nextToken = "O".repeat(43);
    let nextId = "prt_old";
    const resetService = new PasswordResetService(
      new D1AccountRepository(fixture.database),
      new D1PasswordResetRepository(fixture.database),
      () => now,
      () => nextToken,
      () => nextId,
    );
    expect(await resetService.requestReset(account.email, "203.0.113.45")).toBe(nextToken);
    expect(await resetService.requestReset(account.email, "203.0.113.45")).toBeNull();
    expect(fixture.resetTokens.size).toBe(1);

    now = new Date(now.getTime() + 61_000);
    nextToken = "N".repeat(43);
    nextId = "prt_new";
    expect(await resetService.requestReset(account.email, "203.0.113.45")).toBe(nextToken);
    const oldToken = fixture.resetTokens.get("prt_old")!;
    expect(oldToken.revoked_at).not.toBeNull();
    expect(oldToken.superseded_by_token_id).toBe("prt_new");
    expect((await app.fetch(resetPasswordRequest("O".repeat(43), "new secure passphrase"), { ACCOUNT_DB: fixture.database })).status).toBe(400);
    expect((await app.fetch(resetPasswordRequest(nextToken, "new secure passphrase"), { ACCOUNT_DB: fixture.database })).status).toBe(200);
  });

  it("does not allow concurrent reset requests to both consume one token", async () => {
    const fixture = createAccountDatabaseFixture();
    const account = seedVerifiedAccount(fixture);
    const token = "C".repeat(43);
    const resetService = new PasswordResetService(
      new D1AccountRepository(fixture.database),
      new D1PasswordResetRepository(fixture.database),
      () => new Date(),
      () => token,
      () => "prt_concurrent",
    );
    await resetService.requestReset(account.email, "203.0.113.46");

    const responses = await Promise.all([
      app.fetch(resetPasswordRequest(token, "first new secure passphrase"), { ACCOUNT_DB: fixture.database }),
      app.fetch(resetPasswordRequest(token, "second new secure passphrase"), { ACCOUNT_DB: fixture.database }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 400]);
    expect([...fixture.resetTokens.values()][0].consumed_at).not.toBeNull();
    const currentHash = fixture.credentials.get(account.id)!;
    expect(await verifyPassword("first new secure passphrase", currentHash) || await verifyPassword("second new secure passphrase", currentHash)).toBe(true);
  });

  it("rate-limits reset requests by email and IP without exposing account existence", async () => {
    const fixture = createAccountDatabaseFixture();
    const resetService = new PasswordResetService(
      new D1AccountRepository(fixture.database),
      new D1PasswordResetRepository(fixture.database),
      () => new Date(),
      () => "L".repeat(43),
      () => "prt_rate_limited",
    );
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await resetService.requestReset(`missing-${attempt}@example.com`, "203.0.113.47");
    }
    const account = seedVerifiedAccount(fixture);
    expect(await resetService.requestReset(account.email, "203.0.113.47")).toBeNull();

    const limited = await app.fetch(forgotPasswordRequest(account.email, "203.0.113.47"), { ACCOUNT_DB: fixture.database });
    const unknown = await app.fetch(forgotPasswordRequest("another-missing@example.com", "203.0.113.47"), { ACCOUNT_DB: fixture.database });
    expect(limited.status).toBe(202);
    expect(await limited.json()).toEqual(await unknown.json());
  });
});