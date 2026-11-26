import { resolveAccountSession } from "./api";
import type { D1AccountDatabase } from "./repository";
import type { IdentityResolver } from "../jobs/contracts";

/** Account-owned adapter: no account PII, credentials or database handles cross it. */
export function jobsIdentity(database?: D1AccountDatabase): IdentityResolver {
  return async (request) => {
    const account = await resolveAccountSession(request, database);
    return account?.status === "ACTIVE" && account.emailVerifiedAt ? { subject: account.id } : null;
  };
}
