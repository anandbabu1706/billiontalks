import { identifier, JobsError, type Identity, type JobsDatabase } from "./contracts";
import { requireCompany } from "./permissions";

export type PostingAction = { company: string; listing: string; key: string; operation: "CREATE" | "RENEW" | "REOPEN" | "CLOSE" | "ARCHIVE" | "EDIT"; revision: number; vacancy?: { position: string; location: string; department: string; arrangement: string } };
export function vacancyFingerprint(vacancy: PostingAction["vacancy"]): string {
  if (!vacancy || Object.keys(vacancy).sort().join() !== "arrangement,department,location,position") throw new JobsError(400, "invalid_vacancy");
  return JSON.stringify([vacancy.position, vacancy.location, vacancy.department, vacancy.arrangement].map(value => {
    if (typeof value !== "string" || !value.trim() || value.length > 200) throw new JobsError(400, "invalid_vacancy");
    return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  }));
}
export function istDate(now: number): string { return new Date(now + 19_800_000).toISOString().slice(0, 10); }

/** Internal foundation service. Clock is supplied by server composition, never request JSON. */
export class PostingQuota {
  constructor(private readonly db: JobsDatabase, private readonly clock: () => number = Date.now) {}
  async apply(actor: Identity, action: PostingAction): Promise<{ expiresAt: number; revision: number }> {
    identifier(action.company); identifier(action.listing); identifier(action.key);
    if (!["CREATE", "RENEW", "REOPEN", "CLOSE", "ARCHIVE", "EDIT"].includes(action.operation) || !Number.isSafeInteger(action.revision) || action.revision < 0) throw new JobsError(400, "invalid_action");
    const fingerprint = ["CREATE", "EDIT"].includes(action.operation) ? vacancyFingerprint(action.vacancy) : "";
    const payload = JSON.stringify([action.listing, action.operation, action.revision, fingerprint]);
    await requireCompany(this.db, actor, action.company);
    try {
      // One SQL statement plus its trigger is the atomic unit. No BEGIN/COMMIT assumption.
      await this.db.prepare(`INSERT INTO posting_actions(company,actor,request_key,payload,listing,operation,fingerprint,expected_revision,at)
        SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM posting_actions WHERE company=? AND actor=? AND request_key=?)`)
        .bind(action.company, actor.subject, action.key, payload, action.listing, action.operation, fingerprint, action.revision, this.clock(), action.company, actor.subject, action.key).run();
    } catch (error) {
      const match = String(error).match(/jobs_(forbidden|conflict|daily_limit|active_limit|duplicate)/);
      if (match) throw new JobsError(match[1] === "forbidden" ? 403 : 409, match[1]);
      throw new JobsError(503, "jobs_unavailable");
    }
    const result = await this.db.prepare("SELECT payload,result_expiry,result_revision FROM posting_actions WHERE company=? AND actor=? AND request_key=?").bind(action.company, actor.subject, action.key).first<{ payload: string; result_expiry: number; result_revision: number }>();
    if (!result || result.payload !== payload) throw new JobsError(409, "idempotency_conflict");
    return { expiresAt: result.result_expiry, revision: result.result_revision };
  }
}
