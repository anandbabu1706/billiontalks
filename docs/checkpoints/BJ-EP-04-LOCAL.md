# EP-04 local development and security foundation

Owner-authorized local synthetic development, 2026-11-27 (Asia/Calcutta).
Branch: `bj-ep-04-foundation`. Application baseline: `59223d775418e0adb550f1e9a71c2a7388ae2485`.
Approved requirements source: `d87e65fe5b7243455f6462c5412163346e734e0c` on `docs/bj-doc-001`.
Neither historical reference is asserted to be the active production deployment.

## Run locally

From this worktree, use `npm run jobs:dev`. Jobs stays disabled unless explicitly started with
`npm run jobs:dev -- --enable-jobs`. The listener is `http://127.0.0.1:8794`.
Only these scripts are the EP-04 isolated environment; inherited `dev` and `build` scripts
retain historical Wrangler configuration and are not part of this synthetic workflow.
The local launcher rejects unknown arguments, including remote configuration arguments.

The programmatic Miniflare configuration does not load Wrangler configurations, `.env`,
`.dev.vars`, account credentials, shared local state, remote bindings or existing databases.
It creates separate ephemeral `ACCOUNT_DB` and `JOBS_DB` instances with synthetic IDs, disables
telemetry and CF metadata fetching, and rejects every Worker outbound fetch. No Meetings
Durable Objects, R2, SFU credentials or email bindings are supplied. Restart discards all data.
Never copy real account/applicant data into these fixtures.

Dependencies were reused from the installed/locked tree without downloading or upgrading.
The directly imported local tools are now explicit dev dependencies: Miniflare
`5.20261006.1-alpha` and esbuild `0.21.5`. Runtime tested: workerd `1.20261006.1`,
Wrangler installed `4.149.0`, Vitest `2.1.9`. Miniflare's shipped V4 configuration
adapter is used to construct V5 options. No production runtime compatibility claim.

The synthetic shared identity is `synthetic_candidate` / `synthetic_candidate@example.invalid`.
Its local test cookie is `bt_account_session=` followed by 43 lowercase `s` characters.
There is no password/email flow for this fixture. This is a public test value, not a secret.
Use the cookie on local requests. To attest eligibility, POST `/api/jobs/v1/eligibility`
with body `{"over18":true}`, `Content-Type: application/json`,
`Origin: http://127.0.0.1:8794`, and `X-Jobs-Request: 1`.
GET `/api/jobs/v1/foundation` or `/jobs` returns the authenticated foundation status.
POST `/api/jobs/v1/closure` uses the same origin/header protection and closes Jobs only.
The `/jobs` response is a developer foundation status, not a finished profile screen.

## Implemented boundaries

- Default-off exact `/jobs` and `/api/jobs/v1` route namespaces; no production flags changed.
- Account-owned adapter reuses session resolution and returns only the stable subject ID.
  Jobs receives neither account PII nor the shared environment or account database handle.
- Fresh Jobs eligibility, membership, company-admin, assigned-listing and scoped platform
  privacy-operator checks. Platform/company admin is not unrestricted applicant access.
- Server-authoritative UTC action times, fixed IST daily allowance ledger and atomic
  SQL-trigger listing mutation. 10 actions/company/day, 30 unexpired active listings;
  final-seven-day active renewal adds 30 days to prior expiry; expired renewal and reopening
  add 30 days to action time. Close frees a slot; archive preserves quota/history; edits
  do not spend allowance. Canonical vacancy identity blocks exact active duplicates.
- Company/actor-scoped idempotency stores the original result and rejects changed payloads.
  Membership, limits, revision and duplicate checks run inside the atomic database mutation.
  The quota service is internal foundation code, not a completed recruitment API.
- Sticky 18+ eligibility attestation stores only eligibility/time, not DOB or Aadhaar.
  Denied, closed and restricted records cannot self-reactivate. Support review comes later.
- Private profile defaults; field allowlist, separate public indexing consent, fresh recruiter
  discovery permission, and application-specific submitted-field projection. Submitted
  snapshots must come from trusted server storage with assignment checks, not request JSON.
- Same-origin/custom-header CSRF protection, strict bounded JSON input, parameterized SQL,
  no-store/private responses, noindex and generic errors. Jobs emits no raw request/error logs.
- Configurable 180/30/90-day application/closure/moderation record retention; restricted
  exceptions/legal holds; privacy audit metadata; Jobs-only closure revokes membership and
  ordinary visibility while preserving shared identity and Meetings. These are record-level
  foundations to connect to later profile/application stores, not a complete deletion UI.
- Recovery gate plus independent deletion-ledger replay. Before importing any snapshot,
  stop serving traffic and set `restore_gate.ready=0`. Preserve the deletion ledger separately
  from the snapshot, import it using the trusted recovery method, then reopen only on success.
  Held records stay restricted. Backups/storage provisioning and scheduler wiring are absent.

## Local verification and limitations

`npm run typecheck` checks application and tests.
`npm run test:jobs` runs synthetic integration tests against actual local D1 bindings.
`npm test -- --reporter=json --outputFile=final-tests.json` includes Meetings regressions.
The baseline used the same command with `baseline-tests.json` before shared route edits.
The test runner needs permission to spawn esbuild/workerd processes under this Windows sandbox.

Local D1 evidence demonstrates atomic statement/trigger mutation, failing-batch rollback,
rejection of conventional `BEGIN TRANSACTION`, concurrent limits and replay, IST midnight,
active expiry/renew/reopen rules, denial paths, session expiry/revocation, privacy/retention
and actual outbound rejection. It does not prove deployed Cloudflare behavior, latency,
regional retention, disaster recovery or runtime isolation under adversarial same-process code.
The shared Worker remains a shared failure/security domain even though Jobs code receives
only narrow capabilities. Reassess extraction before real data if that boundary is inadequate.

Baseline: 427 tests, 425 pass, 2 fail. Pre-existing failures are camera cycling at
`tests/browser-ui.test.ts` (live preview assertion) and calendar month/week/day navigation at
`tests/calendar-v1-004.test.ts` (missing rendered value). Neither is repaired in this scope.
Final: 457 tests, 455 pass, 2 fail, 0 skipped. All 30 Jobs integration/security tests pass;
the two failing test names exactly match the baseline. Type checking passes. The local
runtime test bundles the complete Worker with esbuild and starts it successfully. The
inherited Wrangler build/deploy command was deliberately not run. See
`BJ-EP-04-EVIDENCE.json` for counts, exact test names, tool versions and changed-file inventory.

## Remaining qualification and next milestone

BJ-V1-001 can build on these local synthetic foundations. It has not been started. Its work
must implement profile storage/editing/UI, persisted field preferences, consent changes and
their end-to-end tests. Later recruiting work must connect trusted snapshot projection,
membership assignment management, similarity warnings, moderation and operational abuse
controls. No full professional profiles, recruiting, interviews, uploads, payments or emails
were implemented prematurely.

Before real-data/staging/release use: separately authorize and qualify actual D1 concurrency,
bindings/isolation, shared account/email integration, deployment/rollback and recovery; close
existing Meetings regressions; validate legal retention mapping, age-assurance adequacy,
operating owners and launch scope. Step-up for high-impact administration, support exception
review, operational audits/rate limiting and durable external deletion-ledger preservation
remain later qualification. These controls are not final legal compliance or launch approval.

No remote infrastructure access, provisioning, deployment, push, merge, email, purchase or
payment activation occurred. Additional development cash expenditure: ₹0. AI credit usage
was not measured as cash expenditure. Main and the documentation branch were not modified;
the existing root `README.txt` was preserved. The added `.worktrees/` path appears untracked
in the original checkout because its ignore rules were deliberately left unchanged.
