# EP-07 local completion checkpoint

Execution: EP-07 / BJ-V1-003 — Job Posting, Search and Applications  
Date: 2026-11-27 (Asia/Calcutta)  
Baseline: `723f89bd2a0a0101a0776cf1c7d10616648c6d70` on `bj-ep-06-companies-recruiters`  
Branch: `bj-ep-07-jobs-applications`

## Delivered locally

- Jobs-owned D1 migration for structured listing details, saved jobs, candidate-selected application snapshots, application event history, reports and listing audit records.
- Tenant-authorized draft, preview, publish, edit, close, renew, reopen and archive workflows reusing the EP-04 atomic quota and revision controls.
- Anonymous discovery of active, unexpired, unrestricted listings with bounded keyword/filter/sort/pagination inputs and public job detail pages.
- Candidate save/unsave, disclosure preview, idempotent application submission, immutable snapshot history and withdrawal.
- One reapplication after a voluntary withdrawal and a server-enforced 24-hour wait; no third attempt and no reapplication after rejection.
- Server-side assignment checks for recruiter access. Company membership or platform roles alone do not grant application access, and revocation takes effect immediately.
- Candidate reporting with per-day deduplication, no-store responses, strict JSON/body bounds, origin/header CSRF checks, parameterized D1 statements and privacy-safe errors.
- Jobs-only closure restriction, 180-day ended-application retention, hold-compatible purge/deletion replay and preservation of the shared account and Meetings data.
- Responsive, keyboard-usable discovery, listing, saved-job, application-history and listing-management interfaces. Existing `/dashboard` Meetings behavior is unchanged.

## Verification

- `npm run typecheck` — pass.
- `npm run build` — Wrangler dry-run bundle pass; no deployment performed.
- `npm test -- tests/jobs-marketplace.test.ts --reporter=dot` — 13/13 pass.
- `npm run test:jobs -- --reporter=dot` — 67/67 pass.
- `npm test -- --reporter=json --outputFile=ep07-final-tests.json` — 494 total, 492 pass, two unchanged pre-existing Meetings failures.
- `git diff --check` — pass.

The unchanged failures are the camera-cycle browser test and the calendar month/week/day rendering test already recorded at the EP-06 baseline. EP-07 introduced no additional full-suite failure.

## Security and privacy checks

- Candidate identity, company membership, recruiter assignment and eligibility are loaded server-side; request bodies cannot assert ownership, tenant, role or verification.
- Public listing projections contain listing/company presentation data only. Drafts, expired/closed/archived listings, restricted companies, candidate profiles, saved jobs and application records are excluded.
- Application snapshots contain only candidate-selected allowlisted profile fields and remain independent from later profile visibility changes.
- Same-key retries return the original application; active duplicates, concurrent duplicate attempts, stale lifecycle revisions and cross-tenant access fail closed.
- Application event deletion cascades only when the retention workflow writes the durable deletion ledger. Jobs closure does not delete the shared account.

## Deferred and qualification limits

- EP-08 remains responsible for the full recruiter application workspace, assignment-management UI, review stages, shortlist/rejection interfaces and richer audit presentation. EP-07 exposes only the assigned-application read foundation and internal rejection transition needed to verify the no-reapply rule.
- Interviews, messaging, email, résumé upload, ranking/recommendations, administration, payments and production operation remain excluded.
- Production D1 migration, live binding/isolation, backup/restore, capacity, recovery, real-data privacy and operational qualification remain pending explicit authorization.
- No real applicant data, cloud provisioning, deployment, email or paid service was used. Additional cash expenditure: ₹0.

