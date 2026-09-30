import type { Account } from "./domain";
import type { AccountRepository, D1AccountDatabase } from "./repository";
import { normalizeEmail } from "./validation";

const TOKEN_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MILLISECONDS = 60 * 1000;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type EmailVerificationTokenRecord = {
  id: string;
  accountId: Account["id"];
  tokenHash: string;
  purpose: "EMAIL_VERIFICATION";
  createdAt: string;
  expiresAt: string;
};

export type PreparedEmailVerificationToken = {
  token: string;
  record: EmailVerificationTokenRecord;
};

export interface EmailVerificationRepository {
  issue(record: EmailVerificationTokenRecord, cooldownSince: string): Promise<boolean>;
  consume(tokenHash: string, now: string, operationId: string): Promise<boolean>;
}

type D1MutationResult = { meta?: { changes?: number } };

function mutationChanges(result: unknown): number {
  if (typeof result !== "object" || result === null || !("meta" in result)) return 0;
  const meta = (result as D1MutationResult).meta;
  return typeof meta?.changes === "number" ? meta.changes : 0;
}

async function hashVerificationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeToken(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export class D1EmailVerificationRepository implements EmailVerificationRepository {
  constructor(private readonly database: D1AccountDatabase) {}

  async issue(record: EmailVerificationTokenRecord, cooldownSince: string): Promise<boolean> {
    const results = await this.database.batch([
      this.database.prepare(
        `INSERT INTO email_verification_tokens (
          id, account_id, token_hash, purpose, created_at, expires_at
        )
        SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM accounts WHERE id = ? AND email_verified_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM email_verification_tokens
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
        `UPDATE email_verification_tokens
         SET revoked_at = ?, superseded_by_token_id = ?
         WHERE account_id = ? AND purpose = ? AND id <> ?
           AND consumed_at IS NULL AND revoked_at IS NULL
           AND EXISTS (SELECT 1 FROM email_verification_tokens WHERE id = ?)`,
      ).bind(record.createdAt, record.id, record.accountId, record.purpose, record.id, record.id),
    ]);
    return mutationChanges(results[0]) === 1;
  }

  async consume(tokenHash: string, now: string, operationId: string): Promise<boolean> {
    const results = await this.database.batch([
      this.database.prepare(
        `UPDATE email_verification_tokens
         SET consumed_at = ?, consumed_operation_id = ?
         WHERE token_hash = ? AND purpose = 'EMAIL_VERIFICATION'
           AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      ).bind(now, operationId, tokenHash, now),
      this.database.prepare(
        `UPDATE accounts
         SET email_verified_at = COALESCE(email_verified_at, ?),
             status = CASE WHEN status = 'PENDING_EMAIL_VERIFICATION' THEN 'ACTIVE' ELSE status END,
             updated_at = ?
         WHERE id = (
           SELECT account_id FROM email_verification_tokens
           WHERE token_hash = ? AND consumed_operation_id = ? AND consumed_at = ?
         )`,
      ).bind(now, now, tokenHash, operationId, now),
    ]);
    return mutationChanges(results[0]) === 1;
  }
}

export class EmailVerificationService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly tokens: EmailVerificationRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly generateToken: () => string = () => encodeToken(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))),
    private readonly createId: () => string = () => `ev_${crypto.randomUUID()}`,
  ) {}

  async prepareToken(accountId: Account["id"], createdAt = this.clock().toISOString()): Promise<PreparedEmailVerificationToken> {
    const token = this.generateToken();
    const tokenHash = await hashVerificationToken(token);
    return {
      token,
      record: {
        id: this.createId(),
        accountId,
        tokenHash,
        purpose: "EMAIL_VERIFICATION",
        createdAt,
        expiresAt: new Date(Date.parse(createdAt) + TOKEN_TTL_MILLISECONDS).toISOString(),
      },
    };
  }

  async verify(token: string): Promise<boolean> {
    if (!TOKEN_PATTERN.test(token)) return false;
    const tokenHash = await hashVerificationToken(token);
    return this.tokens.consume(tokenHash, this.clock().toISOString(), crypto.randomUUID());
  }

  async resend(email: string): Promise<string | null> {
    let account: Account | null;
    try {
      account = await this.accounts.findByEmail(normalizeEmail(email));
    } catch {
      return null;
    }
    if (!account || account.emailVerifiedAt) return null;

    const now = this.clock();
    const prepared = await this.prepareToken(account.id, now.toISOString());
    const cooldownSince = new Date(now.getTime() - RESEND_COOLDOWN_MILLISECONDS).toISOString();
    const issued = await this.tokens.issue(prepared.record, cooldownSince);
    return issued ? prepared.token : null;
  }

  async issueForAccount(accountId: Account["id"], createdAt?: string): Promise<string | null> {
    const now = createdAt ? new Date(createdAt) : this.clock();
    const prepared = await this.prepareToken(accountId, now.toISOString());
    const cooldownSince = new Date(now.getTime() - RESEND_COOLDOWN_MILLISECONDS).toISOString();
    return await this.tokens.issue(prepared.record, cooldownSince) ? prepared.token : null;
  }
}