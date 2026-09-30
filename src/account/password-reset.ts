import type { Account } from "./domain";
import { hashPassword } from "./password";
import { D1AccountRepository, type AccountRepository, type D1AccountDatabase } from "./repository";
import { normalizeEmail, validatePassword } from "./validation";

const RESET_TOKEN_TTL_MILLISECONDS = 45 * 60 * 1000;
const RESET_REQUEST_COOLDOWN_MILLISECONDS = 60 * 1000;
const RESET_REQUEST_WINDOW_MILLISECONDS = 15 * 60 * 1000;
const MAX_RESET_REQUESTS = 10;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type PasswordResetTokenRecord = {
  id: string;
  accountId: Account["id"];
  tokenHash: string;
  purpose: "PASSWORD_RESET";
  createdAt: string;
  expiresAt: string;
};

export interface PasswordResetRepository {
  issue(record: PasswordResetTokenRecord, cooldownSince: string): Promise<boolean>;
  hasUsableToken(tokenHash: string, now: string): Promise<boolean>;
  resetPassword(tokenHash: string, passwordHash: string, now: string, operationId: string): Promise<boolean>;
}

type D1MutationResult = { meta?: { changes?: number } };

function mutationChanges(result: unknown): number {
  if (typeof result !== "object" || result === null || !("meta" in result)) return 0;
  return (result as D1MutationResult).meta?.changes ?? 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeToken(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export class D1PasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly database: D1AccountDatabase) {}

  async issue(record: PasswordResetTokenRecord, cooldownSince: string): Promise<boolean> {
    const results = await this.database.batch([
      this.database.prepare(
        `INSERT INTO account_password_reset_tokens (
          id, account_id, token_hash, purpose, created_at, expires_at
        )
        SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM accounts
          WHERE id = ? AND status = 'ACTIVE' AND email_verified_at IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM account_password_reset_tokens
          WHERE account_id = ? AND purpose = ? AND created_at > ?
        )`,
      ).bind(
        record.id,
        record.accountId,
        record.tokenHash,
        record.purpose,
        record.createdAt,
        record.expiresAt,
        record.accountId,
        record.accountId,
        record.purpose,
        cooldownSince,
      ),
      this.database.prepare(
        `UPDATE account_password_reset_tokens
         SET revoked_at = ?, superseded_by_token_id = ?
         WHERE account_id = ? AND purpose = ? AND id <> ?
           AND consumed_at IS NULL AND revoked_at IS NULL
           AND EXISTS (
             SELECT 1 FROM account_password_reset_tokens WHERE id = ?
           )`,
      ).bind(record.createdAt, record.id, record.accountId, record.purpose, record.id, record.id),
    ]);
    return mutationChanges(results[0]) === 1;
  }

  async hasUsableToken(tokenHash: string, now: string): Promise<boolean> {
    const row = await this.database.prepare(
      `SELECT id FROM account_password_reset_tokens
       WHERE token_hash = ? AND purpose = 'PASSWORD_RESET'
         AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    ).bind(tokenHash, now).first<{ id: string }>();
    return row !== null;
  }

  async resetPassword(tokenHash: string, passwordHash: string, now: string, operationId: string): Promise<boolean> {
    const results = await this.database.batch([
      this.database.prepare(
        `UPDATE account_password_reset_tokens
         SET consumed_at = ?, consumed_operation_id = ?
         WHERE token_hash = ? AND purpose = 'PASSWORD_RESET'
           AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      ).bind(now, operationId, tokenHash, now),
      this.database.prepare(
        `UPDATE account_password_credentials
         SET password_hash = ?, changed_at = ?
         WHERE account_id = (
           SELECT account_id FROM account_password_reset_tokens
           WHERE token_hash = ? AND consumed_operation_id = ? AND consumed_at = ?
         )`,
      ).bind(passwordHash, now, tokenHash, operationId, now),
      this.database.prepare(
        `UPDATE account_sessions
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE account_id = (
           SELECT account_id FROM account_password_reset_tokens
           WHERE token_hash = ? AND consumed_operation_id = ? AND consumed_at = ?
         )`,
      ).bind(now, tokenHash, operationId, now),
    ]);
    return mutationChanges(results[0]) === 1 && mutationChanges(results[1]) === 1;
  }
}

export class PasswordResetService {
  constructor(
    private readonly accounts: AccountRepository & Pick<D1AccountRepository, "recordLoginAttempt">,
    private readonly tokens: PasswordResetRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly generateToken: () => string = () => encodeToken(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))),
    private readonly createId: () => string = () => `prt_${crypto.randomUUID()}`,
    private readonly passwordHasher: (password: string) => Promise<string> = hashPassword,
  ) {}

  async requestReset(email: string, clientIp: string): Promise<string | null> {
    let normalizedEmail: string | null = null;
    try {
      normalizedEmail = normalizeEmail(email);
    } catch {
      normalizedEmail = null;
    }

    const emailScope = await sha256Hex(`password-reset-email:${normalizedEmail ?? email.trim().normalize("NFKC").toLowerCase()}`);
    const ipScope = await sha256Hex(`password-reset-ip:${clientIp || "unknown"}`);
    const now = this.clock();
    const createdAt = now.toISOString();
    const cooldownSince = new Date(now.getTime() - RESET_REQUEST_COOLDOWN_MILLISECONDS).toISOString();
    const windowStartedAt = new Date(now.getTime() - RESET_REQUEST_WINDOW_MILLISECONDS).toISOString();
    const attemptCounts = await Promise.all([
      this.accounts.recordLoginAttempt(emailScope, createdAt, windowStartedAt),
      this.accounts.recordLoginAttempt(ipScope, createdAt, windowStartedAt),
    ]);
    if (attemptCounts.some((attemptCount) => attemptCount > MAX_RESET_REQUESTS) || !normalizedEmail) return null;

    const account = await this.accounts.findByEmail(normalizedEmail);
    if (!account || account.status !== "ACTIVE" || !account.emailVerifiedAt) return null;

    const token = this.generateToken();
    if (!TOKEN_PATTERN.test(token)) throw new Error("Password reset token generator returned an invalid token.");
    const tokenHash = await sha256Hex(token);
    const record: PasswordResetTokenRecord = {
      id: this.createId(),
      accountId: account.id,
      tokenHash,
      purpose: "PASSWORD_RESET",
      createdAt,
      expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MILLISECONDS).toISOString(),
    };
    return await this.tokens.issue(record, cooldownSince) ? token : null;
  }

  async reset(token: string, newPassword: string): Promise<boolean> {
    validatePassword(newPassword);
    if (!TOKEN_PATTERN.test(token)) return false;

    const tokenHash = await sha256Hex(token);
    const now = this.clock().toISOString();
    if (!await this.tokens.hasUsableToken(tokenHash, now)) return false;

    const passwordHash = await this.passwordHasher(newPassword);
    return this.tokens.resetPassword(tokenHash, passwordHash, now, crypto.randomUUID());
  }
}