# EP-11 local checkpoint

Date: 2026-11-27 (Asia/Calcutta). All work used local synthetic fixtures. The application branch starts at EP-10 `c08591f970a4c977c98286f045145bda58a27474`. No deployment, real data, external AI, email, payment or new resource was used.

## Repository housekeeping

The original `bt-website-favicon-social-correction` worktree and seven pre-existing nested worktrees were inspected and retained. A new EP-11 worktree was created from the exact EP-10 head. The repository-local `.git/info/exclude` now contains `/.worktrees/`; the original worktree reports only `README.txt` as untracked. That file is the approved original BillionTalks logo handoff (target path, dimensions and SHA-256), and was neither edited nor committed. EP-08 is an ancestor of EP-10; EP-04 through EP-10 worktrees and branches were not reset or discarded. The favicon branch was not published.

## Local implementation and verification

Migration `0007_governance.sql` adds product-scoped grants, append-oriented audit, cases, enforcement, appeals, ownership transfer/history, retirement, privacy and consent records, legal holds, incidents, policies, fraud signals, employer verification and a reminder outbox. The local migration runner applies seven Jobs migrations. The existing atomic quota defaults remain 10/day, 30 active, 30-day validity and IST reset; applications remain unlimited as a product policy.

The governance service enforces deny-by-default role checks, a trusted recent MFA claim and recent reauthentication for high-impact actions. Production `jobsIdentity` supplies neither elevated claim; synthetic tests construct them directly. Thus administrative writes and dashboard access are **not enabled for real-data use**. The current API exposes authenticated reporting, own-case status, user appeal submission and MFA-gated administrative read routes. Other governance commands are locally tested service operations, not complete browser workflows.

The two EP-10 Meetings fixture issues were corrected in tests only. The pre-join camera cycle now checks stopped and newly live camera tracks while acknowledging that the joined self tile does not yet exist. The calendar test navigates from the current local month to its fixed October 2026 fixture. No production Meetings code or assertion was weakened. The Jobs profile persistence fixture also now expects seven migrations after EP-11.

Focused verification: TypeScript passed; 13/13 governance tests and 19/19 profile tests passed; governance, marketplace and foundation checks passed 46/46 before later additions. Wrangler 4.149.0 `deploy --dry-run` bundled successfully with no Jobs production binding. The final full regression passed **535/535 tests across 24 files**, including both corrected Meetings fixtures.

## Security and operational limits

Audit triggers prevent SQL update/delete through ordinary app paths, but no cryptographic integrity or off-system write-once storage is claimed. Source code has no production owner bootstrap or MFA service; role seeding in tests is synthetic. Owner transfer uses reauthentication, bound recipient digest and token, expiry, single use, revision check and database triggers; retirement stops recruitment and allows subsequent Jobs-only closure. The initial single-owner model cannot supply independent appeal review.

The existing Meetings activation outbox remains Jobs-local and idempotent. EP-11 adds a bounded local in-app reminder outbox with duplicate and stale-revision handling and caps automatic activation retries. No scheduler, remote dispatcher, monitoring subscription or operations team is provisioned. Privacy export returns only requester-owned Jobs records after review and recent reauthentication in the local service; it is not a public download feature. Legal holds block ordinary purge; jurisdiction-specific retention and incident reporting remain unqualified.
