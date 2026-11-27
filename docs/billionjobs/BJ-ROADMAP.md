# BillionJobs Roadmap & Release Gates

**APPROVED:** Recruiting first, then interview integration, professional networking and monetization. Sequence preserves the existing Meetings and Android tracks. Milestone IDs below are retained from BJ-MPB-001; later implementation requires explicit authorization. EP-04 through EP-08 and EP-10 authorized local synthetic milestones are completed; see the current tracker and milestone evidence. Owners must discuss results before opening a follow-on prompt or workstream.

| Milestone | Status | Scope or exit evidence |
|---|---|---|
| BJ-MPB-001 | APPROVED | [Planning baseline](BJ-MPB-001-MASTER-BLUEPRINT.md), scope, principles and ₹0 incremental development target. |
| BJ-V0-001 | APPROVED | [Repository/history audit](BJ-V0-001-ARCHITECTURE-AUDIT.md) completed for its read-only scope; active infrastructure verification remains open. |
| BJ-V0-002 / BJ-V0-002A | CONDITIONALLY APPROVED (design) | [Architecture](BJ-V0-002-ARCHITECTURE-DESIGN.md); demonstrate security isolation and verify D1 atomic enforcement during separately authorized work. |
| BJ-V0-003 / BJ-V0-003A | APPROVED (scope and design) | [Product requirements](BJ-V0-003-PRODUCT-REQUIREMENTS.md) and screen/acceptance design approved; tests and release pending. |
| BJ-DOC-001 / BJ-DOC-002 | COMPLETED (documentation) | Documentation branch and action tracker; no merge. |
| BJ-PLAN-001 | APPROVED (planning) | Collective approval with REV-001–REV-007, recorded in [BJ-D22–BJ-D29](BJ-DECISION-REGISTER.md). |
| BJ-DOC-003 | COMPLETED on verified introducing commit | Documentation only; see [tracked evidence](BJ-TRACK-001-ACTION-TRACKER.md). |
| BJ-V0-001A | ACCESSIBLE LIVE INSPECTION COMPLETE / QUALIFICATION PARTIAL | Dated audit verifies deployment, isolation and sampled usage; billing, complete headroom and release qualification remain open. |
| BJ-V1-001 | COMPLETED (EP-05 local synthetic) | [Professional profiles evidence](BJ-EP-05-MILESTONE.md), f5e671faf48678c231b5a7e98f00d11be9ac3823; no real-data or release approval. |
| BJ-V1-002 | COMPLETED (local synthetic) | [EP-06 milestone](BJ-EP-06-MILESTONE.md). Shared environment qualification remains open. |
| BJ-V1-003 | COMPLETED (EP-07 local synthetic) | [EP-07 milestone](BJ-EP-07-MILESTONE.md): publish/discover/save/apply/lifecycle, assigned-access foundation and retention evidence; no deployment or real-data qualification. |
| BJ-V1-004 | COMPLETED (EP-08 local synthetic) | [EP-08 milestone](BJ-EP-08-MILESTONE.md): assignment-scoped review, lifecycle, notes, matching, analytics and notifications; no live AI or release approval. |
| BJ-V1-005 | COMPLETED (EP-10 local synthetic) | [EP-10 milestone](BJ-EP-10-MILESTONE.md): request-and-confirm scheduling, time zones, feedback, analytics and versioned Meetings admission/revocation adapter; release qualification remains open. |
| BJ-V1-006 | DEFERRED | Networking: connections, posts, discussions and reporting. |
| BJ-V1-007 | IN PROGRESS (local synthetic checkpoint) | EP-11 governance foundations are locally tested. ADM-01–ADM-20 remain approved; full workflow, trusted MFA and qualification gates are open. |
| BJ-V1-008 | DEFERRED | Monetization readiness: configure entitlement design first; vendor, checkout and live payments need separate approval. |
| BJ-V1-009 | BLOCKED | Final qualification: security, integration, accessibility, regression, capacity and owner acceptance. |
| Offer-letter management extension | DEFERRED | No initial issuance or document system. Optional future work requires explicit reapproval; simple employer/candidate-reported recruitment statuses remain within recruiting scope. |

## Approved sequence and remaining gates

1. **Before build:** Verify the currently deployed source and choose a compatible coding baseline; document bindings and published scope; obtain separate approval for development, test access and any resources. The documentation base is the verified default-branch V0 sign-off, not a direction to build against that historical release.
2. **Before synthetic staging:** Authorize the branch and resources, pin fixtures and scope, ensure Jobs is off by default, preserve route behavior and define how to disable it without breaking Meetings. No production data. Pass functional and isolation tests for two employers and two candidates. During authorized implementation, require Codex to prove D1 atomic quota/application writes; do not assume conventional transaction support.
3. **Before genuine applicant data:** Demonstrate security isolation for infrastructure reuse and choose a separate runtime where necessary. Verify Jobs persistence/recovery, configurable retention and legal validation, accountable support/moderation owners, privacy/abuse handling, role revocation and accessibility. Verify actual usage, subscriptions, remaining capacity and billing before approving spend. Qualify against Meetings performance/regression. The invite-only pilot is controlled testing (REV-007), not a permanent restriction on later public registration.
4. **Before interviews or recruitment status confirmation:** Qualify interview integration independently on admission/invitee behavior and authorized email testing when email is used. Restrict self-reported recruiting statuses to correct actors, including candidate withdrawal of acceptance or non-joining recorded without deleting history. Full offer-letter issuance is deferred and cannot be activated without a new owner-approved milestone and safeguards.
5. **Before broader release or monetization:** Review actual pilot usage, rollback evidence, privacy, support load and mandatory/usage-based expense. Obtain separate owner approval for production and paid activation.

**Milestone order:** V1-001 profiles/privacy → V1-002 company roles → V1-003 jobs, IST quotas and applications → V1-004 recruiter workspace. Deliver minimum V1-007 privacy, moderation and appeal controls with this foundation, before real users; the fuller V1-007 tooling stays a separate milestone. V1-005 Interviews is a separate qualified integration. V1-006 networking and V1-008 merchant/paid activation remain deferred. V1-009 and separate BJ-REL-001 approval gate the relevant release.

## Expense categories

- **APPROVED target:** ₹0 additional development cash using existing allowances; exclude hypothetical paid developer time.
- **REQUIRES VERIFICATION:** Cloudflare plan, usage and fees; email and identity volume; applicable mandatory verification or compliance costs. Shared capacity must cover existing Meetings plus Jobs.
- **DEFERRED:** New storage, document safety tooling, payment providers and marketing. Trigger based on measured need and owner approval, not on speculative feature expansion.

## EP-05 closeout sequencing - 2026-11-27

EP-05 is committed and pushed; EP-06/company modules remain not started and require separate authorization. Minimal Jobs profile access is included; full parent redesign remains deferred until after EP-11. See [EP-05 milestone](BJ-EP-05-MILESTONE.md) for exact source, tests, inventory and minimum next dependencies. Historical policy/decision records are retained; local completion does not waive release gates.

## EP-10 interview scheduling decision

Owner-approved in the EP-06 authorization on 2026-11-27. EP-10 will implement request-and-confirm interview scheduling on the existing BillionTalks meeting infrastructure. Candidates can respond to an interview request without maintaining an availability calendar. Optional external calendar integrations, including Google Calendar and Microsoft Outlook, are deferred until sufficient customer demand exists. Each integration must be consent-based and independently configurable. Existing admission, revocation and Meetings regression gates continue to apply.

## EP-07 closeout sequencing - 2026-11-27

EP-07 is committed and pushed on its authorized isolated branch. EP-08 is the next roadmap dependency but is not authorized or started: it must build the full recruiter workspace on current assignment checks, immutable application snapshots and event history, without giving company administrators an applicant bypass. Shared staging, production, real applicant data, deployment and merge remain separately gated. Full parent redesign remains deferred until after EP-11.

## EP-08 closeout sequencing - 2026-11-27

EP-08 is committed and pushed on its authorized isolated branch. The next functional dependency is EP-10 interview request/confirm/cancel integration, but it is not started by this milestone. EP-10 must consume the recorded application identity, actor permissions and status history while independently proving Meetings admission, cancellation, retry, time-zone and regression behavior. The [BJ-AI roadmap](BJ-AI-ROADMAP.md) is product direction only: external providers, models, agents, applicant-data transfer and AI activation require separate authorization and qualification.

## EP-10 closeout and revised execution sequence - 2026-11-27

EP-10 is committed and pushed on its authorized isolated branch with 95/95 Jobs tests passing and no new full-suite failure. The approved sequence, without renumbering historical milestones, is **EP-08 → EP-10 → EP-11 → BT-WEB website restructuring → EP-09 recruitment qualification and controlled pilot → EP-12 final integrated qualification → EP-13 production release**.

EP-11 is authorized for isolated local synthetic implementation and has a governance checkpoint; see [EP-11 milestone](BJ-EP-11-MILESTONE.md). Full administration/moderation, trusted MFA and release controls are not complete. BT-WEB restructuring follows EP-11 and remains independent of Jobs domain data. Before genuine applicant data or any controlled pilot, complete the mandatory security, legal, privacy, accessibility, recovery, capacity and operating-owner gates. EP-11 does not authorize staging, pilot, deployment, merge or AI/provider activation.

## EP-11-A continuation checkpoint

EP-11 remains in progress. Role management, available-owner protection and employer-verification operations advanced in section A. Later milestones retain their existing order.
