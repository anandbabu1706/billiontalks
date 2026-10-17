import type { Account } from "../account/domain";
import type { D1AccountDatabase } from "../account/repository";
import { AccountValidationError, normalizeEmail, normalizeFullName } from "../account/validation";

export const FEEDBACK_CATEGORIES = {
  "general-enquiries": "General Enquiries",
  "technical-support": "Technical Support",
  "feature-suggestions": "Feature Suggestions",
  "business-partnerships": "Business & Partnerships",
  feedback: "Feedback",
  "report-issue": "Report an Issue",
} as const;

export type FeedbackCategory = keyof typeof FEEDBACK_CATEGORIES;

const DAY = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16384;
const GUEST_COOKIE = "bt_feedback_guest";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REFERENCE = /^fb_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type FeedbackInput = {
  category: FeedbackCategory;
  name: string;
  email: string;
  message: string;
  rating: number | null;
  affectedFeature: string | null;
  context: string | null;
};

type FeedbackRow = {
  id: string;
  account_id: string | null;
  category: FeedbackCategory;
  name: string;
  email: string;
  message: string;
  rating: number | null;
  affected_feature: string | null;
  context: string | null;
  created_at: string;
  expires_at: string;
};

class FeedbackError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function failure(error: unknown): Response {
  if (error instanceof FeedbackError) return json({ error: error.message }, error.status);
  // Database errors can contain bindings, so never log the error or submitted data.
  console.error("[billiontalks feedback] request failed", { category: "persistence_failure" });
  return json({ error: "Feedback is temporarily unavailable. Please try again later." }, 503);
}

function sameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (request.headers.get("Sec-Fetch-Site") === "cross-site" ||
    (origin !== null && origin !== new URL(request.url).origin) ||
    (request.method !== "GET" && origin === null)) {
    throw new FeedbackError(403, "A same-origin request is required.");
  }
}

function verified(account: Account | null): account is Account {
  return account !== null && account.status === "ACTIVE" && Boolean(account.emailVerifiedAt);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new FeedbackError(415, "A JSON request body is required.");
  }
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    throw new FeedbackError(413, "The request is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new FeedbackError(400, "A JSON request body is required.");
  let size = 0;
  let text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new FeedbackError(413, "The request is too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    const body: unknown = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof FeedbackError) throw error;
    throw new FeedbackError(400, "The request body is invalid.");
  } finally {
    reader.releaseLock();
  }
}

function textField(value: unknown, maximum: number, multiline = false): string {
  if (typeof value !== "string") throw new FeedbackError(400, "A required field is invalid.");
  const text = value.normalize("NFC").trim();
  if (!text || text.length > maximum ||
    (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(text)) {
    throw new FeedbackError(400, "A required field is invalid or too long.");
  }
  return text;
}

function validate(body: Record<string, unknown>): FeedbackInput {
  if (body.website !== undefined && body.website !== "") {
    throw new FeedbackError(400, "Submission rejected as spam.");
  }
  if (Object.keys(body).some((key) => ![
    "category", "name", "email", "message", "rating", "affectedFeature", "context", "website",
  ].includes(key))) throw new FeedbackError(400, "The request contains unsupported fields.");
  if (typeof body.category !== "string" || !Object.hasOwn(FEEDBACK_CATEGORIES, body.category)) {
    throw new FeedbackError(400, "Choose a valid category.");
  }
  const category = body.category as FeedbackCategory;
  if (body.rating !== undefined && (category !== "feedback" || typeof body.rating !== "number" ||
    !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5)) {
    throw new FeedbackError(400, "Rating must be an integer from 1 to 5 and is only available for Feedback.");
  }
  if (category !== "report-issue" && (body.affectedFeature !== undefined || body.context !== undefined)) {
    throw new FeedbackError(400, "Issue fields are only available for Report an Issue.");
  }
  try {
    return {
      category,
      name: normalizeFullName(textField(body.name, 120)),
      email: normalizeEmail(textField(body.email, 254)),
      message: textField(body.message, 5000, true),
      rating: body.rating === undefined ? null : body.rating as number,
      affectedFeature: category === "report-issue" ? textField(body.affectedFeature, 120) : null,
      context: category === "report-issue" && body.context !== undefined ? textField(body.context, 2000, true) : null,
    };
  } catch (error) {
    if (error instanceof AccountValidationError) throw new FeedbackError(400, "Name or email is invalid.");
    throw error;
  }
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function guest(request: Request): { id: string; cookie: string | null } {
  const value = request.headers.get("Cookie")?.split(";")
    .map((entry) => entry.trim()).find((entry) => entry.startsWith(`${GUEST_COOKIE}=`))?.slice(GUEST_COOKIE.length + 1);
  if (value && UUID.test(value)) return { id: value, cookie: null };
  const id = crypto.randomUUID();
  return {
    id,
    cookie: `${GUEST_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
  };
}

function checkResults(results: unknown[]): void {
  if (results.some((result) => !result || typeof result !== "object" ||
    (result as { success?: boolean }).success === false)) throw new Error("Database operation failed.");
}

async function cleanup(database: D1AccountDatabase, now: string): Promise<number> {
  const results = await database.batch([
    database.prepare(`DELETE FROM feedback_submissions WHERE id IN (
      SELECT id FROM feedback_submissions WHERE expires_at <= ? ORDER BY expires_at LIMIT 100
    ) RETURNING id`).bind(now),
    database.prepare(`DELETE FROM feedback_rate_limits WHERE scope_hash IN (
      SELECT scope_hash FROM feedback_rate_limits WHERE updated_at <= ? ORDER BY updated_at LIMIT 100
    ) RETURNING scope_hash`).bind(new Date(Date.parse(now) - DAY).toISOString()),
  ]);
  if (results.length !== 2) throw new Error("Incomplete cleanup.");
  checkResults(results);
  return results.reduce<number>((total, result) => {
    const rows = (result as { results?: unknown[] }).results;
    if (!Array.isArray(rows)) throw new Error("Unconfirmed cleanup.");
    return total + rows.length;
  }, 0);
}

export async function purgeExpiredFeedback(database: D1AccountDatabase | undefined, scheduledTime: number): Promise<void> {
  try {
    if (!database) throw new Error("Database unavailable.");
    const now = new Date(scheduledTime).toISOString();
    let deleted = 0;
    let batch: number;
    do {
      batch = await cleanup(database, now);
      deleted += batch;
    } while (batch > 0);
    console.info("[billiontalks feedback] scheduled cleanup completed", { deleted });
  } catch {
    console.error("[billiontalks feedback] scheduled cleanup failed", { category: "persistence_failure" });
    throw new Error("Scheduled feedback cleanup failed.");
  }
}

async function rateLimit(database: D1AccountDatabase, request: Request, identity: string, now: string): Promise<void> {
  const trustedIp = request.headers.get("CF-Connecting-IP")?.trim();
  const ip = trustedIp && trustedIp.length <= 64 ? trustedIp : "unknown";
  const scopes = await Promise.all([hash(`feedback:ip:${ip}`), hash(`feedback:${identity}`)]);
  const windowStart = new Date(Date.parse(now) - 60 * 60 * 1000).toISOString();
  const results = await database.batch(scopes.map((scope) => database.prepare(
    `INSERT INTO feedback_rate_limits (scope_hash, attempt_count, window_started_at, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(scope_hash) DO UPDATE SET
       attempt_count = CASE WHEN window_started_at <= ? THEN 1 ELSE attempt_count + 1 END,
       window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END,
       updated_at = excluded.updated_at
     RETURNING attempt_count`,
  ).bind(scope, now, now, windowStart, windowStart)));
  if (results.length !== 2) throw new Error("Incomplete counters.");
  checkResults(results);
  const counts = results.map((result) => (result as { results?: { attempt_count: number }[] }).results?.[0]?.attempt_count);
  if (counts.some((count) => typeof count !== "number" || !Number.isSafeInteger(count) || count < 1)) {
    throw new Error("Unconfirmed counters.");
  }
  if (counts[0]! > 20 || counts[1]! > 5) throw new FeedbackError(429, "Too many submissions. Please try again later.");
}

export async function handleFeedbackRequest(
  request: Request, account: Account | null, database?: D1AccountDatabase,
): Promise<Response> {
  let cookie: string | null = null;
  let response: Response;
  try {
    if (new URL(request.url).pathname !== "/api/feedback") throw new FeedbackError(404, "Not found.");
    if (request.method !== "POST") throw new FeedbackError(405, "Only POST is supported.");
    sameOrigin(request);
    if (account !== null && !verified(account)) throw new FeedbackError(401, "A verified active session is required.");
    if (!database) throw new Error("Database unavailable.");
    const now = new Date().toISOString();
    const visitor = account ? null : guest(request);
    cookie = visitor?.cookie ?? null;
    await cleanup(database, now);
    // Count all same-origin attempts, including invalid payloads and honeypot submissions.
    await rateLimit(database, request, account ? `account:${account.id}` : `guest:${visitor!.id}`, now);
    const input = validate(await readBody(request));
    const id = `fb_${crypto.randomUUID()}`;
    const inserted = await database.prepare(
      `INSERT INTO feedback_submissions (
        id, account_id, category, name, email, message, rating, affected_feature, context, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ).bind(id, account?.id ?? null, input.category, input.name, input.email, input.message,
      input.rating, input.affectedFeature, input.context, now, new Date(Date.parse(now) + 90 * DAY).toISOString())
      .first<{ id: string }>();
    if (inserted?.id !== id) throw new Error("Insert was not confirmed.");
    response = json({ referenceId: id }, 201);
  } catch (error) {
    response = failure(error);
  }
  if (cookie) response.headers.append("Set-Cookie", cookie);
  if (response.status === 429) response.headers.set("Retry-After", "3600");
  return response;
}

export async function handleFeedbackAdminRequest(
  request: Request, account: Account | null, database?: D1AccountDatabase,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const id = url.pathname.startsWith("/api/admin/feedback/") ? url.pathname.slice("/api/admin/feedback/".length) : null;
    if (url.pathname !== "/api/admin/feedback" && (!id || !REFERENCE.test(id))) throw new FeedbackError(404, "Not found.");
    if (!((request.method === "GET" && id === null) || (request.method === "DELETE" && id !== null))) {
      throw new FeedbackError(405, "Method not supported.");
    }
    sameOrigin(request);
    if (!verified(account)) throw new FeedbackError(401, "A verified active session is required.");
    if (!database) throw new Error("Database unavailable.");
    const reviewer = await database.prepare(
      "SELECT account_id FROM feedback_reviewers WHERE account_id = ?",
    ).bind(account.id).first<{ account_id: string }>();
    if (reviewer?.account_id !== account.id) throw new FeedbackError(403, "Reviewer access is required.");
    const now = new Date().toISOString();
    await cleanup(database, now);
    if (request.method === "DELETE") {
      const deleted = await database.prepare(
        "DELETE FROM feedback_submissions WHERE id = ? AND expires_at > ? RETURNING id",
      ).bind(id, now).first<{ id: string }>();
      if (deleted?.id !== id) throw new FeedbackError(404, "Feedback not found.");
      return json({ deleted: true });
    }
    const limitValue = url.searchParams.get("limit") ?? "25";
    if (!/^\d{1,2}$/u.test(limitValue) || Number(limitValue) < 1 || Number(limitValue) > 50) {
      throw new FeedbackError(400, "Limit must be between 1 and 50.");
    }
    const limit = Number(limitValue);
    const before = url.searchParams.get("before");
    const beforeId = url.searchParams.get("beforeId");
    if ((before === null) !== (beforeId === null) || (before !== null &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(before) ||
        !Number.isFinite(Date.parse(before)) || !REFERENCE.test(beforeId!)))) {
      throw new FeedbackError(400, "The pagination cursor is invalid.");
    }
    const statement = database.prepare(
      `SELECT id, account_id, category, name, email, message, rating, affected_feature, context, created_at, expires_at
       FROM feedback_submissions WHERE created_at > ? AND expires_at > ?
       ${before ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(...(before
      ? [new Date(Date.parse(now) - 90 * DAY).toISOString(), now, before, before, beforeId, limit + 1]
      : [new Date(Date.parse(now) - 90 * DAY).toISOString(), now, limit + 1]));
    if (!statement.all) throw new Error("Database listing unavailable.");
    const result = await statement.all<FeedbackRow>();
    if ((result as { success?: boolean }).success === false || !Array.isArray(result.results)) throw new Error("Listing failed.");
    const rows = result.results.slice(0, limit);
    const last = rows.at(-1);
    return json({
      submissions: rows.map((row) => ({
        id: row.id, accountId: row.account_id, category: row.category, name: row.name, email: row.email,
        message: row.message, rating: row.rating, affectedFeature: row.affected_feature, context: row.context,
        createdAt: row.created_at, expiresAt: row.expires_at,
      })),
      nextCursor: result.results.length > limit && last ? { before: last.created_at, beforeId: last.id } : null,
    });
  } catch (error) {
    return failure(error);
  }
}
