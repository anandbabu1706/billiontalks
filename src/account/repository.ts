import type { Account } from "./domain";
import type { EmailVerificationTokenRecord } from "./email-verification";

export class AccountIdentityConflictError extends Error {
  constructor() {
    super("An account with these identity details already exists.");
    this.name = "AccountIdentityConflictError";
  }
}

export interface AccountRepository {
  create(account: Account, passwordHash: string, verificationToken?: EmailVerificationTokenRecord): Promise<void>;
  findByEmail(normalizedEmail: string): Promise<Account | null>;
  findByMobileNumber(e164Number: string): Promise<Account | null>;
}

export interface AccountLoginRepository {
  findLoginCredential(normalizedEmail: string): Promise<{ account: Account; passwordHash: string } | null>;
  recordLoginAttempt(scopeHash: string, now: string, windowStartedAt: string): Promise<number>;
  clearLoginAttempts(scopeHashes: string[]): Promise<void>;
}

export interface AccountSessionRepository {
  createSession(record: {
    tokenHash: string;
    accountId: Account["id"];
    createdAt: string;
    expiresAt: string;
  }): Promise<boolean>;
  resolveSession(tokenHash: string, now: string): Promise<Account | null>;
  revokeSession(tokenHash: string, now: string): Promise<void>;
}

type AccountRow = {
  id: Account["id"];
  full_name: string;
  email_normalized: string;
  country_code: string;
  mobile_e164: string;
  status: Account["status"];
  email_verified_at: string | null;
  mobile_verified_at: string | null;
  terms_accepted_at: string;
  terms_version: string;
  marketing_consent: number;
  marketing_consent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type D1AccountStatement = {
  bind: (...values: unknown[]) => D1AccountStatement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

export type D1AccountDatabase = {
  prepare: (query: string) => D1AccountStatement;
  batch: (statements: D1AccountStatement[]) => Promise<unknown[]>;
};

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email_normalized,
    countryCode: row.country_code,
    mobileNumber: row.mobile_e164,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    mobileVerifiedAt: row.mobile_verified_at,
    termsAcceptedAt: row.terms_accepted_at,
    termsVersion: row.terms_version,
    marketingConsent: row.marketing_consent === 1,
    marketingConsentAt: row.marketing_consent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class D1AccountRepository implements AccountRepository, AccountLoginRepository, AccountSessionRepository {
  constructor(private readonly database: D1AccountDatabase) {}

  async create(account: Account, passwordHash: string, verificationToken?: EmailVerificationTokenRecord): Promise<void> {
    try {
      const statements = [
        this.database.prepare(
          `INSERT INTO accounts (
            id, full_name, email_normalized, country_code, mobile_e164, status,
            email_verified_at, mobile_verified_at, terms_accepted_at, terms_version,
            marketing_consent, marketing_consent_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          account.id,
          account.fullName,
          account.email,
          account.countryCode,
          account.mobileNumber,
          account.status,
          account.emailVerifiedAt,
          account.mobileVerifiedAt,
          account.termsAcceptedAt,
          account.termsVersion,
          Number(account.marketingConsent),
          account.marketingConsentAt,
          account.createdAt,
          account.updatedAt,
        ),
        this.database.prepare(
          `INSERT INTO account_password_credentials (account_id, password_hash, changed_at)
           VALUES (?, ?, ?)`,
        ).bind(account.id, passwordHash, account.createdAt),
      ];
      if (verificationToken) {
        statements.push(this.database.prepare(
          `INSERT INTO email_verification_tokens (
            id, account_id, token_hash, purpose, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          verificationToken.id,
          verificationToken.accountId,
          verificationToken.tokenHash,
          verificationToken.purpose,
          verificationToken.createdAt,
          verificationToken.expiresAt,
        ));
      }
      await this.database.batch(statements);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: accounts\.(email_normalized|mobile_e164)/u.test(error.message)) {
        throw new AccountIdentityConflictError();
      }
      throw error;
    }
  }

  async findByEmail(normalizedEmail: string): Promise<Account | null> {
    const row = await this.database.prepare(
      `SELECT id, full_name, email_normalized, country_code, mobile_e164, status,
        email_verified_at, mobile_verified_at, terms_accepted_at, terms_version,
        marketing_consent, marketing_consent_at, created_at, updated_at
       FROM accounts WHERE email_normalized = ?`,
    ).bind(normalizedEmail).first<AccountRow>();
    return row ? mapAccount(row) : null;
  }

  async findByMobileNumber(e164Number: string): Promise<Account | null> {
    const row = await this.database.prepare(
      `SELECT id, full_name, email_normalized, country_code, mobile_e164, status,
        email_verified_at, mobile_verified_at, terms_accepted_at, terms_version,
        marketing_consent, marketing_consent_at, created_at, updated_at
       FROM accounts WHERE mobile_e164 = ?`,
    ).bind(e164Number).first<AccountRow>();
    return row ? mapAccount(row) : null;
  }

  async findLoginCredential(normalizedEmail: string): Promise<{ account: Account; passwordHash: string } | null> {
    const row = await this.database.prepare(
      `SELECT a.id, a.full_name, a.email_normalized, a.country_code, a.mobile_e164, a.status,
        a.email_verified_at, a.mobile_verified_at, a.terms_accepted_at, a.terms_version,
        a.marketing_consent, a.marketing_consent_at, a.created_at, a.updated_at,
        c.password_hash
       FROM accounts a
       INNER JOIN account_password_credentials c ON c.account_id = a.id
       WHERE a.email_normalized = ?`,
    ).bind(normalizedEmail).first<AccountRow & { password_hash: string }>();
    return row ? { account: mapAccount(row), passwordHash: row.password_hash } : null;
  }

  async recordLoginAttempt(scopeHash: string, now: string, windowStartedAt: string): Promise<number> {
    await this.database.prepare(
      "DELETE FROM account_login_rate_limits WHERE updated_at < ?",
    ).bind(new Date(Date.parse(now) - 24 * 60 * 60 * 1000).toISOString()).run();
    const row = await this.database.prepare(
      `INSERT INTO account_login_rate_limits (scope_hash, window_started_at, attempt_count, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(scope_hash) DO UPDATE SET
         attempt_count = CASE
           WHEN account_login_rate_limits.window_started_at <= ? THEN 1
           ELSE account_login_rate_limits.attempt_count + 1
         END,
         window_started_at = CASE
           WHEN account_login_rate_limits.window_started_at <= ? THEN excluded.window_started_at
           ELSE account_login_rate_limits.window_started_at
         END,
         updated_at = excluded.updated_at
       RETURNING attempt_count`,
    ).bind(scopeHash, now, now, windowStartedAt, windowStartedAt).first<{ attempt_count: number }>();
    return row?.attempt_count ?? Number.MAX_SAFE_INTEGER;
  }

  async clearLoginAttempts(scopeHashes: string[]): Promise<void> {
    if (!scopeHashes.length) return;
    await this.database.batch(scopeHashes.map((scopeHash) =>
      this.database.prepare("DELETE FROM account_login_rate_limits WHERE scope_hash = ?").bind(scopeHash),
    ));
  }

  async createSession(record: {
    tokenHash: string;
    accountId: Account["id"];
    createdAt: string;
    expiresAt: string;
  }): Promise<boolean> {
    const result = await this.database.prepare(
      `INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at, last_used_at)
       SELECT ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM accounts
         WHERE id = ? AND email_verified_at IS NOT NULL AND status = 'ACTIVE'
       )`,
    ).bind(
      record.tokenHash,
      record.accountId,
      record.createdAt,
      record.expiresAt,
      record.createdAt,
      record.accountId,
    ).run() as { meta?: { changes?: number } };
    return result.meta?.changes === 1;
  }

  async resolveSession(tokenHash: string, now: string): Promise<Account | null> {
    const touch = await this.database.prepare(
      `UPDATE account_sessions SET last_used_at = ?
       WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
         AND EXISTS (
           SELECT 1 FROM accounts
           WHERE accounts.id = account_sessions.account_id
             AND accounts.email_verified_at IS NOT NULL
             AND accounts.status = 'ACTIVE'
         )`,
    ).bind(now, tokenHash, now).run() as { meta?: { changes?: number } };
    if (touch.meta?.changes !== 1) return null;

    const row = await this.database.prepare(
      `SELECT a.id, a.full_name, a.email_normalized, a.country_code, a.mobile_e164, a.status,
        a.email_verified_at, a.mobile_verified_at, a.terms_accepted_at, a.terms_version,
        a.marketing_consent, a.marketing_consent_at, a.created_at, a.updated_at
       FROM account_sessions s
       INNER JOIN accounts a ON a.id = s.account_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
         AND a.email_verified_at IS NOT NULL AND a.status = 'ACTIVE'`,
    ).bind(tokenHash, now).first<AccountRow>();
    return row ? mapAccount(row) : null;
  }

  async revokeSession(tokenHash: string, now: string): Promise<void> {
    await this.database.prepare(
      "UPDATE account_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?",
    ).bind(now, tokenHash).run();
  }
}