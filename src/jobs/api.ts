import { JobsError, type IdentityResolver, type JobsDatabase } from "./contracts";
import { requireEligible } from "./permissions";
import { JobsPrivacy } from "./privacy";

export function isJobsPath(path: string): boolean { return path === "/jobs" || path.startsWith("/jobs/") || path === "/api/jobs/v1" || path.startsWith("/api/jobs/v1/"); }
function reply(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } });
}
export async function handleJobs(request: Request, enabled: boolean, db: JobsDatabase | undefined, identity: IdentityResolver): Promise<Response> {
  if (!enabled) return reply(404, { error: "not_found" });
  try {
    if (!db) throw new JobsError(503, "jobs_unavailable");
    const gate = await db.prepare("SELECT ready FROM restore_gate WHERE id=1").first<{ ready: number }>();
    if (gate?.ready !== 1) throw new JobsError(503, "restore_pending");
    const actor = await identity(request);
    if (!actor) throw new JobsError(401, "authentication_required");
    const path = new URL(request.url).pathname;
    if (!["GET", "HEAD"].includes(request.method)) {
      if (request.headers.get("Origin") !== new URL(request.url).origin || request.headers.get("Sec-Fetch-Site") === "cross-site" || request.headers.get("X-Jobs-Request") !== "1") throw new JobsError(403, "csrf_rejected");
    }
    if (path === "/api/jobs/v1/eligibility" && request.method === "POST") {
      if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") throw new JobsError(415, "json_required");
      // Bounded streaming read, including chunked requests.
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 256) { await reader.cancel(); throw new JobsError(413, "body_too_large"); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let body: unknown; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new JobsError(400, "invalid_body"); }
      if (!body || typeof body !== "object" || Object.keys(body).join() !== "over18" || typeof (body as { over18: unknown }).over18 !== "boolean") throw new JobsError(400, "invalid_body");
      const eligible = (body as { over18: boolean }).over18;
      // A denied/closed/restricted record cannot be self-reactivated by retrying.
      await db.prepare("INSERT OR IGNORE INTO jobs_users(subject,eligible,attested_at) VALUES(?,?,?)").bind(actor.subject, Number(eligible), Date.now()).run();
      await requireEligible(db, actor);
      return reply(200, { eligible: true });
    }
    await requireEligible(db, actor);
    if (path === "/api/jobs/v1/closure" && request.method === "POST") { await new JobsPrivacy(db).close(actor); return reply(200, { closed: true }); }
    if ((path === "/jobs" || path === "/api/jobs/v1/foundation") && request.method === "GET") return reply(200, { module: "BillionJobs", stage: "foundation", subject: actor.subject });
    return reply(404, { error: "not_found" });
  } catch (error) {
    // Never log raw database errors, request bodies, cookies or account details.
    return error instanceof JobsError ? reply(error.status, { error: error.code }) : reply(503, { error: "jobs_unavailable" });
  }
}
