import { resolveAccountSession } from "./api";
import type { D1AccountDatabase } from "./repository";
import type { IdentityResolver } from "../jobs/contracts";

/** Account-owned adapter: only stable subject and a verified-email digest cross the boundary. */
export function jobsIdentity(database?: D1AccountDatabase): IdentityResolver {
  return async (request) => {
    const account = await resolveAccountSession(request, database);
    if (account?.status !== "ACTIVE" || !account.emailVerifiedAt) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(account.email.trim().toLowerCase()));
    return { subject: account.id, recipientHash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('') };
  };
}
