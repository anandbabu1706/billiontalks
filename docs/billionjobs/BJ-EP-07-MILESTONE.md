# EP-07 job marketplace and applications completion

EP-07 / BJ-V1-003 is complete for authorized local synthetic development only. The isolated application branch is [`bj-ep-07-jobs-applications`](https://github.com/anandbabu1706/billiontalks/tree/bj-ep-07-jobs-applications) at final commit [`ddce9f16e483e07848cd7bd30b9c00c0570972d8`](https://github.com/anandbabu1706/billiontalks/commit/ddce9f16e483e07848cd7bd30b9c00c0570972d8), based on the required EP-06 baseline `723f89bd2a0a0101a0776cf1c7d10616648c6d70`.

The pushed remote reference was read independently and matched the full commit SHA. A baseline-to-final `git diff --name-only` produced the same 13-file inventory recorded by the committed machine evidence:

1. `docs/checkpoints/BJ-EP-07-EVIDENCE.json`
2. `docs/checkpoints/BJ-EP-07-LOCAL.md`
3. `migrations/jobs/0004_marketplace.sql`
4. `package.json`
5. `scripts/jobs-runtime.mjs`
6. `src/jobs/api.ts`
7. `src/jobs/company-ui.ts`
8. `src/jobs/marketplace-ui.ts`
9. `src/jobs/marketplace.ts`
10. `src/jobs/profile-ui.ts`
11. `src/jobs/quota.ts`
12. `tests/jobs-marketplace.test.ts`
13. `tests/jobs-profiles.test.ts`

Pinned implementation evidence: [local checkpoint](https://github.com/anandbabu1706/billiontalks/blob/ddce9f16e483e07848cd7bd30b9c00c0570972d8/docs/checkpoints/BJ-EP-07-LOCAL.md) and [machine-readable results](https://github.com/anandbabu1706/billiontalks/blob/ddce9f16e483e07848cd7bd30b9c00c0570972d8/docs/checkpoints/BJ-EP-07-EVIDENCE.json).

## Completed functionality and verification

- Company-authorized draft/preview/publish/edit/close/renew/reopen/archive workflows reuse EP-04 atomic IST daily/active quota, expiry, duplicate and revision enforcement.
- Active-job search/detail supports bounded filters, sorting and pagination; drafts and unavailable/restricted listings are excluded.
- Eligible candidates can save jobs, preview selected disclosure, submit an immutable server-generated snapshot, view history and withdraw.
- Same-key application retries are idempotent. Concurrent duplicates, a second active application, reapplication before 24 hours, third attempts and post-rejection reapplication fail closed.
- Assigned-listing access is server-side and tenant-scoped. Membership/administration alone does not expose applicants, and revocation is immediate.
- Listing reports, redacted audit events, no-store responses, CSRF/origin checks, parameterized SQL, bounded bodies, closure restriction and retention/deletion replay are included.
- Responsive discovery, detail, saved-job, application-history and listing-management screens preserve the existing Meetings `/dashboard` behavior and avoid the deferred parent redesign.

Verification results:

- TypeScript and Wrangler non-deploying dry-run bundle: pass.
- EP-07 focused suite: 13/13 pass.
- Complete BillionJobs suite: 67/67 pass.
- Full suite: 492/494 pass. The camera-cycle browser test and calendar month/week/day rendering test are exactly the two pre-existing Meetings failures from EP-06; no new failure was introduced.
- `git diff --check`: pass.

## Security/privacy limits and EP-08 dependencies

No real applicant data, email, remote infrastructure, migration, deployment, merge, paid dependency or production change was used. Local fixtures do not qualify remote D1 behavior, backup/restore, capacity, performance, real-data privacy, legal adequacy, manual WCAG conformance or operations. The two Meetings defects remain unresolved and outside EP-07.

EP-08 requires separate authorization and should consume the existing assignment checks, immutable snapshots and event history. Its minimum scope is a tenant-isolated recruiter workspace with assignment management, review/status transitions, immediate revocation, candidate-safe errors and audit presentation. It must not grant company administrators a general applicant/candidate browser. Interview scheduling remains EP-10; company transfer/retirement and full moderation remain later approved milestones.

Additional cash expenditure incurred: ₹0.
