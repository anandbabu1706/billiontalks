# EP-11 local checkpoint

## Final local verification on 2026-11-28

All 557 regression tests passed in 24 files. The focused run passed 35 governance tests and 19 profile and persistence tests. TypeScript validation, the Wrangler 4.149.0 dry-run bundle and the whitespace check passed. Fourteen Jobs migrations apply once across a local runtime restart. The two prior Meetings fixture corrections are included in the full suite.

The Chrome harness completed reporter submission, company membership revocation, employer verification, recipient-bound ownership acceptance, retirement, separate-identity appeals, role changes, evidence review, account enforcement and closure, notice publication and consent, reviewed export completion, incident transitions, policy revision and reminder dispatch. Responsive and initial keyboard checks covered 14 routes at two viewport widths.

The final acceptance tests exercise rollback under an injected audit failure, temporary suspension and expiry across four access paths, combined Jobs deletion replay, and adapter success followed by a lost response, cancellation, restart and revocation. The reporter concurrency test also verifies that five submissions succeed and two are rate-limited. The database enforces quotas and admission checks independently of client controls. Historical qualification results follow.

## Historical checkpoints

Date: 2026-11-27 (Asia/Calcutta). All work used local synthetic fixtures. The application branch starts at EP-10 `c08591f970a4c977c98286f045145bda58a27474`. No deployment, real data, external AI, email, payment or new resource was used.

## Repository housekeeping

The original `bt-website-favicon-social-correction` worktree and seven pre-existing nested worktrees were inspected and retained. A new EP-11 worktree was created from the exact EP-10 head. The repository-local `.git/info/exclude` now contains `/.worktrees/`; the original worktree reports only `README.txt` as untracked. That file is the approved original BillionTalks logo handoff (target path, dimensions and SHA-256), and was neither edited nor committed. EP-08 is an ancestor of EP-10; EP-04 through EP-10 worktrees and branches were not reset or discarded. The favicon branch was not published.

## Local implementation and verification

Migration `0007_governance.sql` adds product-scoped grants, append-oriented audit, cases, enforcement, appeals, ownership transfer/history, retirement, privacy and consent records, legal holds, incidents, policies, fraud signals, employer verification and a reminder outbox. The local migration runner applies seven Jobs migrations. The existing atomic quota defaults remain 10/day, 30 active, 30-day validity and IST reset; applications remain unlimited as a product policy.

The governance service enforces deny-by-default role checks, a trusted recent MFA claim and recent reauthentication for high-impact actions. Production `jobsIdentity` supplies neither elevated claim; synthetic tests construct them directly. Thus administrative writes and dashboard access are **not enabled for real-data use**. The current API exposes authenticated reporting, own-case status, user appeal submission and MFA-gated administrative read routes. Other governance commands are locally tested service operations, not complete browser workflows.

The two EP-10 Meetings fixture issues were corrected in tests only. The pre-join camera cycle now checks stopped and newly live camera tracks while acknowledging that the joined self tile does not yet exist. The calendar test navigates from the current local month to its fixed October 2026 fixture. No production Meetings code or assertion was weakened. The Jobs profile persistence fixture also now expects seven migrations after EP-11.

Focused verification: TypeScript passed; 14/14 governance tests and 19/19 profile tests passed; governance, marketplace and foundation checks passed 46/46 before later additions. Wrangler 4.149.0 `deploy --dry-run` bundled successfully with no Jobs production binding. The final full regression passed **536/536 tests across 24 files**, including both corrected Meetings fixtures.

## Security and operational limits

Audit triggers prevent SQL update/delete through ordinary app paths, but no cryptographic integrity or off-system write-once storage is claimed. Source code has no production owner bootstrap or MFA service; role seeding in tests is synthetic. Owner transfer uses reauthentication, bound recipient digest and token, expiry, single use, revision check and database triggers; retirement stops recruitment and allows subsequent Jobs-only closure. The initial single-owner model cannot supply independent appeal review.

The existing Meetings activation outbox remains Jobs-local and idempotent. EP-11 adds a bounded local in-app reminder outbox with duplicate and stale-revision handling and caps automatic activation retries. No scheduler, remote dispatcher, monitoring subscription or operations team is provisioned. Privacy export returns only requester-owned Jobs records after review and recent reauthentication in the local service; it is not a public download feature. Legal holds block ordinary purge; jurisdiction-specific retention and incident reporting remain unqualified.

## Continuation from 35ca767

Synthetic role management uses the existing trusted identity resolver injection point in tests. The JSDOM form calls the Jobs router with the normal Origin and X-Jobs-Request protections and persists through local D1. The separate employer lifecycle test uses the same router, including a concurrent approval conflict. These tests do not establish full-browser or production identity qualification. Directory reads support literal percent and underscore searches. The application milestone register records open work per component.

Migration 0008 adds available-owner protections and is recorded exactly once across a local runtime restart. The synthetic runtime accepts one accountable initial owner through its in-process bootstrap handle. Production has no route or binding for it. The focused governance and persistence run passed 36/36 (17 governance, 19 profile). Headless Chrome exercised grant and revocation against the real Jobs router with local D1 at 375px and 1280px, checked initial Tab focus, and verified no horizontal page overflow on the roles page. The test intercepts browser requests and supplies a synthetic server identity outside the deployed bundle. Remaining browser workflows and accessibility checks are open.

## 2026-11-28 local verification

The full regression suite passed 553 of 553 tests in 24 files with zero skipped tests, including 31 governance tests. The local runtime applied 14 Jobs migrations. TypeScript and the Wrangler dry-run bundle passed. Chrome completed role, employer, enforcement, appeal, consent, export, incident, policy and recovery workflows and checked 14 routes at 375 and 1280 pixels. See [the requirement and limitation register](BJ-EP-11-MILESTONE.md) and [the suite inventory](BJ-EP-11-EVIDENCE.json).
