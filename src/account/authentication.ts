import type { Account, AccountId } from "./domain";
import { verifyPasswordOrDummy } from "./password";
import type { AccountLoginRepository, AccountSessionRepository } from "./repository";
import { normalizeEmail } from "./validation";

const SESSION_TTL_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const LOGIN_WINDOW_MILLISECONDS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const ACCOUNT_SESSION_COOKIE = "bt_account_session";

type LoginCredential = { account: Account; passwordHash: string };

export type AccountAuthenticationRepository = AccountLoginRepository & AccountSessionRepository;

function encodeToken(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function extractCookie(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== ACCOUNT_SESSION_COOKIE) continue;
    return entry.slice(separator + 1).trim() || null;
  }
  return null;
}

function secureCookie(request: Request, token: string | null, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const value = token ?? "";
  const expiration = maxAgeSeconds === 0 ? "; Expires=Thu, 01 Jan 1970 00:00:00 GMT" : "";
  return `${ACCOUNT_SESSION_COOKIE}=${value}; Path=/api/accounts; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${expiration}${secure}`;
}

export function setAccountSessionCookie(response: Response, request: Request, token: string): Response {
  response.headers.append("Set-Cookie", secureCookie(request, token, SESSION_TTL_MILLISECONDS / 1000));
  return response;
}

export function clearAccountSessionCookie(response: Response, request: Request): Response {
  response.headers.append("Set-Cookie", secureCookie(request, null, 0));
  return response;
}

export class AccountAuthenticationService {
  constructor(
    private readonly repository: AccountAuthenticationRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly generateToken: () => string = () => encodeToken(crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES))),
    private readonly generateSessionId: () => string = () => `sess_${crypto.randomUUID()}`,
    private readonly passwordVerifier: (password: string, encodedHash: string | null) => Promise<boolean> = verifyPasswordOrDummy,
  ) {}

  async login(email: string, password: string, clientIp: string): Promise<{ account: Account; sessionToken: string } | null> {
    let normalizedEmail: string | null = null;
    try {
      normalizedEmail = normalizeEmail(email);
    } catch {
      normalizedEmail = null;
    }

    const emailScope = await sha256Hex(`email:${normalizedEmail ?? email.trim().normalize("NFKC").toLowerCase()}`);
    const ipScope = await sha256Hex(`ip:${clientIp || "unknown"}`);
    const now = this.clock();
    const timestamp = now.toISOString();
    const windowStart = new Date(now.getTime() - LOGIN_WINDOW_MILLISECONDS).toISOString();
    const counts = await Promise.all([
      this.repository.recordLoginAttempt(emailScope, timestamp, windowStart),
      this.repository.recordLoginAttempt(ipScope, timestamp, windowStart),
    ]);
    if (counts.some((attemptCount) => attemptCount > MAX_LOGIN_ATTEMPTS)) {
      return null;
    }

    const credential: LoginCredential | null = normalizedEmail
      ? await this.repository.findLoginCredential(normalizedEmail)
      : null;
    const passwordMatches = await this.passwordVerifier(password, credential?.passwordHash ?? null);
    const account = credential?.account;
    if (
      !account ||
      !passwordMatches ||
      account.status !== "ACTIVE" ||
      !account.emailVerifiedAt
    ) {
      return null;
    }

    await this.repository.clearLoginAttempts([emailScope, ipScope]);
    const sessionToken = this.generateToken();
    if (!SESSION_TOKEN_PATTERN.test(sessionToken)) {
      throw new Error("Session token generator returned an invalid token.");
    }
    const tokenHash = await sha256Hex(sessionToken);
    const sessionCreated = await this.repository.createSession({
      tokenHash,
      accountId: account.id as AccountId,
      createdAt: timestamp,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MILLISECONDS).toISOString(),
    });
    if (!sessionCreated) return null;
    return { account, sessionToken };
  }

  async resolve(request: Request): Promise<Account | null> {
    const token = extractCookie(request);
    if (!token || !SESSION_TOKEN_PATTERN.test(token)) return null;
    return this.repository.resolveSession(await sha256Hex(token), this.clock().toISOString());
  }

  async revoke(request: Request): Promise<void> {
    const token = extractCookie(request);
    if (!token || !SESSION_TOKEN_PATTERN.test(token)) return;
    await this.repository.revokeSession(await sha256Hex(token), this.clock().toISOString());
  }
}