# BJ-V0-001: Existing Architecture Audit

**Current review: 2026-11-27, Asia/Calcutta — BJ-V0-001A.** Authorized live metadata inspection is complete within accessible permissions. Production identity, resource separation and sampled usage are verified below; billing, complete capacity qualification and release readiness remain open. The earlier sections are historical evidence, superseded where the dated addendum supplies live results. No production or application changes were made.

## Verified repository evidence

| Evidence | Verified fact and scope |
|---|---|
| E1 | [V0 sign-off commit](https://github.com/anandbabu1706/billiontalks/commit/e5cd35bc30120125f82069b5a665be3daa276c23) is the verified `main` head at documentation branching. The [V0 checkpoint](../checkpoints/BT-V0-FINAL.md) names the historical qualified application source `2471d8f...` and records V0 test and device results. These are historical; this audit did not rerun them. |
| E2 | A later [website release record](https://github.com/anandbabu1706/billiontalks/blob/bt-website-favicon-production-release/docs/checkpoints/BT-WEBSITE-FAVICON-CORRECTION.md) identifies release source `59223d775418e0adb550f1e9a71c2a7388ae2485`. That is the latest production source supported by the reviewed release evidence, not proof of the current deployment. The V1 public operational closure does not mean all media, recording or reliability items were physically qualified. |
| E3 | [Account session source at the recorded release](https://github.com/anandbabu1706/billiontalks/blob/59223d775418e0adb550f1e9a71c2a7388ae2485/src/account/authentication.ts) supports host-only cookie handling. Reuse of its authenticated account ID is viable in principle; a subdomain cannot be assumed to receive that cookie. |
| E4 | [Baseline Worker configuration](https://github.com/anandbabu1706/billiontalks/blob/e5cd35bc30120125f82069b5a665be3daa276c23/wrangler.jsonc), [Worker entry point](https://github.com/anandbabu1706/billiontalks/blob/e5cd35bc30120125f82069b5a665be3daa276c23/src/index.ts), [Meeting state](https://github.com/anandbabu1706/billiontalks/blob/e5cd35bc30120125f82069b5a665be3daa276c23/src/meeting.ts), and [package/tooling](https://github.com/anandbabu1706/billiontalks/blob/e5cd35bc30120125f82069b5a665be3daa276c23/package.json) establish the existing Worker, account persistence, Durable Objects and test stack. Repository bindings are not a live account inventory. The release-era scheduling interface remains a candidate, not an already qualified Jobs contract. |

Prior bounded GitHub search found no BJ-V0-001 branch or issue and did not establish implementation status beyond the inspected refs. A separate Windows capability check inspected `package.json` in VS Code on a different local branch and observed Codex UI, but did not submit a new Codex task. The BJ-V0-002 consolidation did not operate VS Code; a fresh command-line recheck was blocked before execution. No local checkout is the documentation branch base.

## Open checks

- **REQUIRES VERIFICATION:** Actual production/staging deployed SHAs, routes, bindings, isolation, peak usage, product quotas and Cloudflare bill. Historical samples of 33,790 production and 8,780 staging Worker requests over 30 days are not a current capacity or spend check. Do not infer conducted meetings from scheduled records, web traffic or Worker invocations.
- **BLOCKED:** Full staging registration, email verification, login and recovery qualification is on hold pending renewed authorization and access to an approved test mailbox. No live test was authorized here.
- **REQUIRES VERIFICATION:** Current media/admission regression evidence, authenticated scheduling compatibility, revocation, and invitee-only join for interviews.
- **CONDITIONALLY APPROVED DESIGN:** Use a stable verified account ID rather than email, separate Jobs data, and qualify Meetings before enabling interviews (BJ-D03/BJ-D26). See the [design](BJ-V0-002-ARCHITECTURE-DESIGN.md).

## BJ-V0-001A: Source findings and release evidence still required

- **Verified source, not live configuration:** Documentation baseline [`576b46b`](https://github.com/anandbabu1706/billiontalks/commit/576b46b50bb0442cfa4a91e3248734bb4f05b3df) is based on historical `main`. The recorded release `59223d7` declares account D1, SQLite-backed meeting Durable Object and recordings R2 in [production source](https://github.com/anandbabu1706/billiontalks/blob/59223d775418e0adb550f1e9a71c2a7388ae2485/wrangler.jsonc) and [staging source](https://github.com/anandbabu1706/billiontalks/blob/59223d775418e0adb550f1e9a71c2a7388ae2485/wrangler.v1-staging.jsonc). The [scheduler API](https://github.com/anandbabu1706/billiontalks/blob/59223d775418e0adb550f1e9a71c2a7388ae2485/src/scheduler/api.ts) exists; that does not qualify eligibility, invitee admission or integration.
- **Live evidence pending:** Dated authenticated read-only snapshot of actual production/staging Worker versions, source SHAs, traffic and routes; deployed bindings and environment separation; existing entitlements/subscriptions, plan and bills; remaining database slots and measured peak capacity; Workers CPU/requests, D1 rows/storage, DO requests/duration/storage, R2 operations, Realtime egress and email volumes/quotas. No account-level evidence was obtained by BJ-PLAN-001; prior access was denied and a public homepage fetch was inconclusive, not outage evidence.
- **Staging access blocked:** Obtain separate authorization and appropriate test mailbox/account access for synthetic qualification. Confirm live onboarding, email, recovery, invitee-only join, cancellation and regression separately. Preserve production; do not infer conducted interviews from schedules.
- **Financial boundary, REV-006:** Target ₹0 new development cash; no unavoidable incremental vendor charge proven. Verify actual usage, existing subscriptions, remaining capacity and billing before approving any additional spend. Published plan caps are comparison inputs only: [Workers/DO](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/limits/), [R2](https://developers.cloudflare.com/r2/pricing/), [Realtime](https://developers.cloudflare.com/realtime/sfu/platform/pricing/) and [Resend](https://www.resend.com/pricing?product=transactional). At an illustrative ₹90/USD before tax, conditional scenarios only: Workers Paid ₹450/month if needed, Resend Pro ₹1,800/month if needed, 100 GB of billable Realtime overage ₹450, 1 GB-month plus 1M writes above included D1 paid limits about ₹158. None of these are confirmed charges or authorizations.

## EP-03: Infrastructure and security readiness (2026-11-26)

**Read-only evidence and limits.** Incoming documentation head was [`ab19be0`](https://github.com/anandbabu1706/billiontalks/commit/ab19be0e2ec51db9eb620d2795f55b30094415e8), with `main` still at the historical V0 sign-off `e5cd35b`. The [release checkpoint](https://github.com/anandbabu1706/billiontalks/blob/bt-website-favicon-production-release/docs/checkpoints/BT-WEBSITE-FAVICON-CORRECTION.md) records production source `59223d775418e0adb550f1e9a71c2a7388ae2485` / Worker version `e6a55a3e-79bc-4845-a0fa-783d42a5e2ca` at 100% at its October release, and staging source `63fedc381e12f355dd364ad977e885c3ffdeecf6` / Worker version `6249cd70-aac8-4142-ae9a-752a9179096d` for the recorded qualification. Neither now-active deployment was verified.

| Area | Confirmed in recorded source / historical evidence | Missing live proof |
|---|---|---|
| Workers, D1, Durable Objects and R2 | Production/staging Wrangler files name distinct Workers and declare different D1 database and recordings bucket values. Both declare a SQLite-backed meeting object class; source names are not namespace or access proof. No Jobs database inferred. | Active routes and version mappings/traffic weights; actual binding identity and namespace IDs, resource permissions/isolation, D1 rows/storage/free slots, DO requests/duration and R2 operations/storage. |
| Meetings and email | [Realtime source](https://github.com/anandbabu1706/billiontalks/blob/59223d775418e0adb550f1e9a71c2a7388ae2485/src/realtime.ts) implements Cloudflare Realtime integration; [email adapter](https://github.com/anandbabu1706/billiontalks/blob/59223d775418e0adb550f1e9a71c2a7388ae2485/src/account/email-delivery.ts) supports Resend. | Actual project/configuration and staging separation, egress/allowances, verified sender, plan, quotas and delivery. Do not test live/email in EP-03. |
| Authentication and administration | [Session source](https://github.com/anandbabu1706/billiontalks/blob/59223d775418e0adb550f1e9a71c2a7388ae2485/src/account/authentication.ts) shows email verification for login, SHA-256 of session tokens at rest, seven-day expiry, revocation, host-only HttpOnly SameSite=Lax cookie and Secure over HTTPS. This is a source observation, not a live security test. | Effective HTTPS cookie/rotation/invalidation and route protections, Cloudflare/GitHub administrative membership, MFA, least privilege and deployment permissions. Do not assume a source binding proves safe live isolation. |
| Consumption, plan and billing | Earlier 30-day Worker counts in the audit are historical, with no invoices or current headroom verified. | Current subscriptions, invoices and charges; per-environment usage, 30-day totals/peaks and residual capacity across every resource including email/media. No verified estimate of current bill. |

**Exact access blocker and minimum next action.** No authenticated Cloudflare/Resend connector was available. Checking for an existing signed-in browser session timed out. A local tool-availability check was rejected before execution because the Windows sandbox could not start under its networking configuration. Earlier official Cloudflare browser access returned HTTP 403. No repeated access attempts and no sign-in performed in EP-03. To close live verification, the owner can make an existing official signed-in dashboard session available in a supported browser, with scoped [metadata read-only](https://developers.cloudflare.com/workers/authorization/) visibility for these resources and read access to billing, plus existing email-dashboard metadata or a redacted equivalent. No token, password or write role needed. If a dashboard has only version IDs, match deployment annotation or build manifest independently to GitHub artifact/commit evidence rather than guessing.

**EP-04 scope recommendation (not authorization).** Use recorded production-compatible source `59223d7` as a pinned historical reference for a separately authorized local-only Codex worktree. Do not start from docs or stale `main`; before shared code integration, reconcile against the currently deployed commit and explicit staging target. Use synthetic fixtures only, no remote bindings, secrets, real accounts, recordings or applicant data. Preserve Meetings routes and rollback. Live verification is not a blocker for this isolated scope.

**Remaining Codex checks:** Prove D1 atomic quota/application semantics under concurrent synthetic tests and IST boundaries without assuming interactive transactions; test session/verification/revocation, secure cookies, mutating-request origin/CSRF checks, private-cache boundaries and per-company/object/field authorization; verify isolation, minimum bindings/permissions, feature-off and rollback in authorized staging; implement and test the 18+ gate, retention/hold and restore behavior and minimum incident evidence once requirements are validated. Keep the interview adapter gated until isolated staging proves authenticated invitee admission, cancellation and Meetings regression. This is a future defensive verification checklist; no testing, code or resources changed in EP-03.

## BJ-V0-001A follow-up: OAuth connected, live inspection still blocked (2026-11-26)

The owner approved Cloudflare's OAuth prompt. The Windows Codex CLI confirmed sign-in with exit code 0. In a subsequent read-only audit at approximately 17:56 UTC, Cloudflare MCP API specification discovery worked, but the first account discovery request (a zone metadata GET for BillionTalks) was stopped by Codex before Cloudflare received it: **MCP tool call requires approval, but approval policy is never**. This is the noninteractive Codex session's approval gate, not a Cloudflare HTTP 401/403 or evidence of a missing Cloudflare scope. No live account data was returned; no second live request was made. OAuth success alone does not confirm the scope or effectiveness of access.

| Area | Readiness after this check |
|---|---|
| Production and staging versions, source mapping, routes, traffic and rollback history | Unverified live; the existing release checkpoint references production `59223d7` and staging `63fedc3` as historical only. |
| Workers, D1, DO, R2, Realtime, triggers, binding and environment isolation | Recorded source only; live inventory and reuse eligibility not established. |
| Administrative/MFA, SSL/TLS, WAF, rate limits, access controls, secret presence and recovery | Not queried live; no conclusion on actual configuration, gaps or backup status. |
| Subscriptions, current/previous costs, resource usage and headroom | Not retrieved. No actual USD or INR total, and no verified headroom against pilot or 10× load. Existing planning scenarios remain projections, not bills or zero usage. |
| Email | Resend was not authenticated or inspected in this follow-up; separate dependency. |

**Smallest remaining unblock:** In an interactive Codex session that allows tool approvals, permit the explicitly read-only Cloudflare MCP request(s) for the BillionTalks account only, or use an official signed-in Cloudflare dashboard with equivalent read-only metadata and billing access. Do not globally trust the generic execute tool or grant write scopes; no password, token, new subscription or repeat OAuth sign-in is requested at this stage.

**Stage gates:** Conditional GO for separately authorized local-only synthetic EP-04 using pinned historical reference `59223d7`, without remote bindings or production access. NO-GO for shared staging integration until live source and binding isolation, recovery/rollback and permission evidence are obtained; NO-GO for real applicant data until legal and privacy gates plus security validation close; NO-GO for production release until those gates, capacity/billing and Meetings regression are cleared. No mandatory new spend demonstrated for local work; actual operating and incremental costs are not verified. No implementation, settings, deployments or spend occurred.

## BJ-V0-001A live verification — 2026-11-27

Evidence collected through the existing authenticated Cloudflare MCP integration, finishing approximately 2026-11-26 21:50 UTC (2026-11-27 IST). Account `2d48323814fb300c94661daac9ee80bf`; zone `122670098217536c11f46e03cc22d3cd`. Only configuration metadata and aggregate analytics were read: no database SQL/content, object content, secret values, applicant data or live user workflows. GET endpoints covered Workers scripts/settings/deployments/versions/domains/routes/subdomains/schedules, D1 database metadata, DO namespaces, R2 bucket configuration, account/user/membership, zone security settings/ruleset entrypoints and email settings. POST `/graphql` was used only for read-only schema/aggregate analytics. Earlier approval-policy failures are resolved; financial API access is a separate remaining limitation.

### Deployment and source provenance

| Item | Live evidence |
|---|---|
| Production | `billiontalks-realtime-backend`; deployment `ab5c4309-25b6-4d07-bc3d-6d6902180499`, created 2026-10-19T19:04:35.7141Z; version `e6a55a3e-79bc-4845-a0fa-783d42a5e2ca` receives 100% traffic. |
| Source mapping | Version 40 annotation names full source `59223d775418e0adb550f1e9a71c2a7388ae2485`, tag `bt-favicon-59223d7`. The [committed release checkpoint](https://github.com/anandbabu1706/billiontalks/blob/ecdfc3175fe546e3daf965a4553f976026fbd8ee/docs/checkpoints/BT-WEBSITE-FAVICON-CORRECTION.md) independently matches that deployed version/source. This is reliable metadata/release-record mapping, not a newly repeated binary reproducibility attestation. EP-04 is not deployed. |
| Rollback | Previous version `d9102cb2-fbf3-479e-b816-08c38d50e782` (39), source annotation `6c7febff118552231b1384f0c05e9add348886f6`, remains in deployable-version inventory. No rollback was performed. Code rollback does not restore database/object data. |
| Routing | Enabled custom domains `billiontalks.com` and `www.billiontalks.com` target production. Zone Worker routes list is empty; custom domains provide routing. Both Worker scripts have workers.dev and preview exposure enabled; domain previews are separately disabled. |
| Staging | `billiontalks-v1-staging`; deployment `e0995df3-717f-44f0-bfae-ed4ce2c15eaf`, version `6249cd70-aac8-4142-ae9a-752a9179096d`, 100%. No live commit annotation. Release checkpoint maps it to `63fedc381e12f355dd364ad977e885c3ffdeecf6`; staging attribution is weaker and relies on historical release evidence. |

Both scripts use compatibility date `2025-07-18`, migration tag `v1`, and report `usage_model: standard`. That is configuration evidence, not an invoice or confirmed current subscription charge.

### Resources, isolation and preservation

| Binding/resource | Production | Staging |
|---|---|---|
| ACCOUNT_DB | `billiontalks-accounts`, `0c0c10f2-437e-459e-86fb-360d7e2a36b5` | `billiontalks-v1-staging-accounts`, `7677f8da-7540-4780-bda3-28c9f7b504bb` |
| D1 metadata | 278,528 bytes; 16 tables | 270,336 bytes; 16 tables |
| MEETING_STORE | `ca9efed5e2064c379ca4d94e7d8f05ee` | `4af387086fa044c694c41b3d2dbafecc` |
| Durable Object class | `MeetingStateDurableObject`, SQLite | `MeetingStateDurableObject`, SQLite |
| RECORDINGS_BUCKET | `billiontalks-recordings` | `billiontalks-v1-staging-recordings` |
| Cron | `*/5 * * * *` | `*/5 * * * *` |

The inventory returned two Workers, two D1 databases, two DO namespaces and two default-jurisdiction R2 buckets. D1 is APAC with read replication disabled; detailed metadata supplies table counts (the list response's zero counts are not treated as authoritative). D1 engine `version: production` is not an environment label. No remote Jobs database or JOBS_DB/JOBS_ENABLED binding was returned. Physical Meetings staging/production storage is distinct, but account-wide quotas, administrator access and potential credential reuse remain shared risks. No claim of isolated secrets: values were deliberately not compared.

Both R2 buckets have public r2.dev access disabled and no custom domains. Lifecycle metadata contains seven-day incomplete multipart-upload cleanup, with no completed-object expiry rule observed. Application retention and restore correctness remain separately unqualified. Both Workers have PUBLIC_WEBSITE_ENABLED=true; production LIMITED_RELEASE_MEDIA_DISABLED=false, while staging lacks that binding. Absence is not proof media is disabled. Cron represents 288 scheduled opportunities/day per script, 576 combined.

Secret binding names present in both environments: REALTIME_SFU_APP_ID, REALTIME_SFU_BEARER_TOKEN and RESEND_API_KEY. ACCOUNT_EMAIL_FROM and ACCOUNT_PUBLIC_ORIGIN settings are present. Values were not retrieved or published. No database migration, account alteration or data movement is required by this audit.

### Security findings and release gates

- **High priority:** account `enforce_twofactor=false`; current user MFA=false; sole accepted member has Super Administrator - All Privileges and MFA=false. Owner should enable personal MFA and account enforcement in a separately authorized action, with recovery arrangements; no protection setting was changed here.
- Cloudflare Access reports not enabled. workers.dev/preview exposure means staging needs an explicitly approved access/isolation strategy before sensitive shared testing. Public exposure alone is not proof of an authentication bypass.
- Zone is active, unpaused, Free Website. Always Use HTTPS and automatic HTTPS rewrites are on; TLS 1.3 on, minimum TLS 1.0, SSL mode full, active certificate. Zone HSTS is disabled. Review TLS minimum and HSTS compatibility before authorized hardening; SSL mode relevance depends on origin use.
- Browser integrity check is on; security level medium. Legacy WAF setting is off, but managed free/DDoS rulesets appear in inventory. Managed/custom firewall and rate-limit phase entrypoint reads returned 404. This does not establish that all Cloudflare protections are off; no custom entrypoint protection was demonstrated.
- Logpush=false and empty tail consumers do not establish absence of all observability. Error alerts, abuse limits, audit retention, recovery tests and synthetic auth/interview qualification remain unverified. Current inspection did not test cookies, user flows or runtime authorization.

### Usage, allowances and conditional capacity

Aggregate analytics sample: **2026-11-25 00:00 to 2026-11-26 00:00 UTC**. Adaptive metrics are estimates, not invoices.

| Metric | Returned evidence |
|---|---|
| Worker requests by script | Production 1,942; staging 296; combined 2,238; zero reported errors. CPU sums 2,824,725 and 511,549 microseconds respectively; totals cannot qualify per-request CPU limits. |
| D1 | 1,728 rows read per database (3,456 combined), zero written in the sampled day; current combined storage 548,864 bytes. |
| DO | 12 requests, zero errors; periodic rows read 0, written 12; exceeded CPU/memory errors 0. Duration field returned 0.41962688; no billing conversion inferred without validated units. |
| R2 storage | Production daily maximum payload 35,339,760 bytes, metadata 545 bytes, 5 objects; staging 0. No object names/content accessed. |
| R2 operations / Realtime SFU | Empty result sets in this sample; not proof of no monthly use or no charges. |

A broader Workers daily aggregation for 2026-10-28 through 2026-11-25 returned a largest daily estimate of **3,420 requests on November 24**, zero reported errors. It reports 2,710 for November 25 versus 2,238 in the narrower script-grouped sample. These differently aggregated adaptive results were not reconciled into an exact ledger. Use 3,420 only as the larger observed daily planning comparator, not a guaranteed peak or invoice count. Burst throughput, p95/p99 CPU/latency, complete D1/DO/R2/Realtime monthly usage and growth storage remain unqualified.

The existing approved planning assumptions remain unchanged: pilot 500 sessions x 12 requests = 6,000 requests/day, 180,000 rows read/day, 600 writes/day; 10x = 60,000 requests, 1.8M reads, 6,000 writes. These omit index/trigger amplification, background work, abuse, media and email. Comparing to published Free allowances is a conservative scenario, not confirmation of this account's plan:

| Daily comparison | Pilot plus observed comparator | 10x plus observed comparator | Published allowance / conditional remainder at 10x |
|---|---|---|---|
| Worker requests | 9,420 | 63,420 | 100,000/day; 36,580 remaining |
| D1 rows read | 183,456 | 1,803,456 | 5M/day; 3,196,544 remaining |
| D1 rows written | 600 | 6,000 | 100,000/day; 94,000 remaining |

Workers Free also limits CPU to 10ms/invocation, which request totals do not prove. Published D1 Free allows 10 databases and 5GB total storage (500MB each): two inventoried databases leave eight slots under that hypothetical plan; no new database was provisioned. R2 Standard includes 10GB-month, 1M Class A and 10M Class B operations; the sampled payload is small, but a daily snapshot is not remaining monthly allowance. Sources checked: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

**Assessment:** existing metadata and daily request/read/write estimates support continuing isolated synthetic Jobs development without a demonstrated need for a paid upgrade. Pilot and 10x appear plausible on these dimensions, conditional on query efficiency and existing traffic. They are not yet qualified for shared staging or production: verify real Jobs CPU, concurrency, indexes/trigger costs, retention/storage growth, account-shared quotas, recovery and operational limits. Interviews/media have independent DO/Realtime/email costs and qualification gates. Do not repeat architecture/legal reviews or make website redesign a dependency.

### Costs and email: exact limits of verification

Account subscriptions and billing-history GET requests returned HTTP 403 requiring billing:read (or write). No permission expansion or alternate-credential workaround was attempted. **Actual current operating cost, billing cycle, subscriptions and remaining monthly entitlements are unknown.** The verified zone Free Website price is USD 0; it does not establish zero Workers, R2, D1, Realtime or email costs. Generic Workers Paid starts at USD 5/month per official pricing, not a confirmed account charge. Owner can supply a redacted current plan/invoice/usage summary through existing dashboard access; no new permission is necessary for that option.

Cloudflare Email Routing is enabled, synced and ready (inbound service). Sending metadata returns quota=null, usage=null, recipient_mode=verified_only: capacity is unknown, not zero. RESEND_API_KEY presence does not prove sender verification, deliverability, plan or remaining Resend allowance. No authorized Resend integration was available for those checks; owner-provided provider summary is needed before email-dependent qualification. No email was sent.

Additional expenditure incurred by this execution: **INR 0**. No purchases, provisioning or paid activations; current operating invoices remain unverified.

### Milestones reconciled without repeating completed work

**BT-CF-SETUP-001:** existing MCP/OAuth and Wrangler 4.149.0 reused successfully. Official Cloudflare skills are installed. Opt-in `billiontalks-cloudflare` profile uses on-request approvals, user reviewer, workspace-write and network restrictions; global safeguards were not disabled. This audit proves live metadata connectivity; billing access is a distinct scope limitation. No setup/authentication repeated.

**EP-04 / BJ-EP-04-CLOSE:** completed and pushed to [bj-ep-04-foundation](https://github.com/anandbabu1706/billiontalks/tree/bj-ep-04-foundation), final commit [82e2c8c1cc6812931e62a58b459465cb77a6df10](https://github.com/anandbabu1706/billiontalks/commit/82e2c8c1cc6812931e62a58b459465cb77a6df10). Baseline 59223d775418e0adb550f1e9a71c2a7388ae2485; approved requirements d87e65fe5b7243455f6462c5412163346e734e0c. [Committed evidence](https://github.com/anandbabu1706/billiontalks/blob/82e2c8c1cc6812931e62a58b459465cb77a6df10/docs/checkpoints/BJ-EP-04-EVIDENCE.json): 457 tests, 455 passed, 30/30 Jobs passed, typecheck passed. Two unchanged baseline failures: camera ON/OFF/ON preview in browser-ui.test.ts and month/week/day schedule rendering in calendar-v1-004.test.ts. Track both for subsequent Meetings qualification; this is not a clean full-suite claim. No rerun for documentation-only work.

Changed-file inventory (17): .gitignore; package.json; package-lock.json; src/index.ts; docs/checkpoints/BJ-EP-04-EVIDENCE.json; docs/checkpoints/BJ-EP-04-LOCAL.md; migrations/jobs/0001_foundation.sql; scripts/jobs-dev.mjs; scripts/jobs-runtime.mjs; scripts/jobs-runtime.d.mts; src/account/jobs-identity.ts; src/jobs/api.ts; src/jobs/contracts.ts; src/jobs/permissions.ts; src/jobs/privacy.ts; src/jobs/quota.ts; tests/jobs-foundation.test.ts. Local isolated synthetic D1 atomicity/quotas/privacy/retention evidence does not qualify remote D1 or real-data deployment. Jobs remains default-off, with no remote Jobs binding observed.

### BT-WEB-001/002 completed technical design and current sequence

The existing TypeScript server-rendered site (`src/website/ui.ts`, `content.ts`, `styles.ts`, routing in `src/index.ts`) can expand through a typed, source-controlled product registry: stable id, product name, navigation label, summary, status, entry path, visibility, access flag and order. Shared shell supplies header/footer/navigation/account affordances; each product owns its routes, permissions and data. Inactive products are hidden by default and do not create backend resources. UI visibility never replaces server authorization. Desktop Products disclosure and mobile accordion require keyboard/focus, screen-reader, touch and responsive acceptance.

Non-exhaustive registry candidates: BillionTalks (functional label **Meetings**), BillionJobs, BillionIdeas, BillionGroups, BillionChat, BillionStore, BillionLearn, BillionAI, BillionOffice, BillionFreelance and BillionBusiness. Future entries must be addable through registry data without rebuilding the shell architecture. Ordinary build/release of updated source-controlled data may still be required. No fixed subdivision limit.

Unified identity means reusing stable account IDs and existing `/account` and `/api/accounts/*` interfaces; it does not collapse legacy `bt_session_v0` and shared `bt_account_session` semantics. If required for EP-05, add an allowlisted same-origin Jobs return target while preserving default `/dashboard` login behavior. Reject external/open redirect targets.

Preserve the BillionTalks application name, technical identifiers, APIs, bindings, accounts, stored data and meeting links. Compatibility includes `/?meeting=...` query parameters, `/ui`, `/dashboard`, `/schedule`, `/calendar`, `/contacts`, `/rsvp`, `/notifications`, account token/hash flows, public pages and assets. No technical renaming or physical migration is proposed. Before any release, compare route/session behavior, verify legacy links and Meetings regressions, confirm binding manifests, qualify recovery and keep a known deployable version. Rollback Jobs visibility/access independently where possible; code rollback cannot reverse data writes, and restored data must respect deletion/retention replay.

| Sequence | Affected files and dependencies | Acceptance / risks |
|---|---|---|
| EP-05 next, separately authorized | Build from 82e2c8c; Jobs profile modules under src/jobs, identity adapter, Jobs migration/test files. Reuse EP-04 privacy and local fixtures. | Private-by-default profiles, field/indexing controls, scoped access, 18+ and Jobs-only closure; synthetic tests and Meetings regression. No prerequisite full shell redesign or remote provisioning. Implementation not started here. |
| BT-WEB-003 essential subset only if EP-05 needs it | src/website/ui.ts, content.ts, styles.ts, src/index.ts and existing account flow; proposed registry module under src/website. | Minimal Jobs navigation and safe return target; Jobs default-off and existing routes unchanged. Avoid cross-product session/authorization coupling. Commit/push on a separately authorized development branch with milestone tracking. |
| Remaining BT-WEB-003 and BT-WEB-004 after EP-11 | Product registry/full shared shell, homepage and responsive navigation; same website files and focused UI tests. | Owner explicitly deferred full parent redesign until after EP-11. Future inactive entries require no provisioning; accessible responsive menu, stable URLs/data and independent product controls. No code implemented in this package. |

Completed: accessible live inspection, EP-04 closeout reconciliation, setup evidence and parent design recording. Pending/blocked: billing/complete monthly headroom, Resend evidence, security hardening authorization, remote isolation/atomicity/recovery and shared-staging qualification. Owner actions are limited to existing billing/email evidence and separately authorizing required protection/qualification work before sensitive environments; none blocks ongoing authorized isolated synthetic development. EP-05 remains NOT STARTED by this execution.
