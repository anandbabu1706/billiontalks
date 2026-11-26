# BillionJobs Decision Register

Source of truth for approval state. **APPROVED** = directly confirmed by the owner or clearly accepted in the referenced exchange, for the stated scope only. **PROPOSED** = recommendation, not consent. **DEFERRED** = outside the current scope or scheduled later. **BLOCKED** = cannot proceed under current approvals or access. **REQUIRES VERIFICATION** = evidence or an exact business choice is missing. Add or supersede decisions by ID with date, authority, evidence, scope, consequences and dependent milestones. A documentation commit does not change the decision status. Decisions are append-only for provenance: retain and mark superseded entries instead of silently rewriting approval history.

**Register revision 1.2 — updated 2026-11-26.** Earlier individual approval dates have not been independently verified and are marked `historical approval date unverified`; the date of this review is not substituted for the original approval date. New entries require verified approval date, authority, source, scope, impact, dependencies and supersession reference.

| ID | Status | Decision and provenance |
|---|---|---|
| BJ-D01 | APPROVED | BillionTalks.com is the parent; preserve Meetings and its milestones; Jobs is next. P3 owner ecosystem brief / BJ-MPB-001. |
| BJ-D02 | APPROVED | Mandatory future extensibility, independent development tracks and option for later deployment separation without speculative infrastructure. P3 owner extensibility instruction and BJ-DOC-001. |
| BJ-D03 | APPROVED | Reuse existing BillionTalks accounts; use separate Jobs D1 and company roles. BJ-V0-003 scope and owner BJ-V0-002 follow-up. Design approval does not provision D1. |
| BJ-D04 | PROPOSED | Same-host routes, modular Worker for synthetic staging, versioned adapter to Meetings and extraction criteria. BJ-V0-002 technical design; exact hosting, trust boundaries and service split await owner review. |
| BJ-D05 | APPROVED | Free candidate registration and applications; free company registration and postings; 10 new listings per company per day, 30 active per company, 30-day validity. No product cap on applications received or managed, subject to abuse prevention. Owner “yes proceed” to BJ-V0-003 free recruitment policy discussion and scope confirmation. |
| BJ-D06 | APPROVED | Publish after email verification with no initial mandatory manual approval; later risk/report scrutiny. P3 owner onboarding direction. Proof of email control is not proof of company legitimacy or offer authority. |
| BJ-D07 | APPROVED | Functional recruitment first; interview integration after foundation; networking and monetization in approved later phases. Free interview scheduling is subject to existing Meetings limits. P3 owner phased scope approval. |
| BJ-D08 | DEFERRED | Résumé uploads excluded from the initial MVP, not removed from roadmap. P3 explicit owner approval. |
| BJ-D09 | APPROVED | Plan subscriptions/entitlements now without activating payments. P3 explicit owner approval. |
| BJ-D10 | DEFERRED | Live subscriptions, checkout and paid upgrades. No provider, merchant account or payment activation approved. P3 explicit owner approval to activate later. |
| BJ-D11 | PROPOSED | Monthly tier hypotheses: Individuals Free / ₹99 / ₹199; Businesses Free / ₹499 / ₹1,499 / ₹2,999. BJ-MPB-001 business hypotheses only. Tier names, entitlements, prices and economics need approval; free recruiting rules remain in force. |
| BJ-D12 | APPROVED | Employer owns internal approvals and employment commitments. BillionJobs authenticates issuance, delivers and tracks candidate acceptance and applies safeguards; it does not guarantee employment. P3 owner offer clarification and explicit BJ-DOC-001 directive. |
| BJ-D13 | REQUIRES VERIFICATION | Exact offer issuer evidence, risk checks and controls, launch phase, terms, retention, complaint and withdrawal rules. Additional platform safeguards are distinct from employer internal approval. |
| BJ-D14 | APPROVED | ₹0 incremental development cash target; existing tools first; no paid additions without express consent. P3 owner blueprint and follow-up. This does not establish operating cost. |
| BJ-D15 | REQUIRES VERIFICATION | Candidate/profile visibility, daily reset, renewals, duplicates, abuse thresholds, retention/deletion, active Cloudflare deployment/bindings/capacity/billing and interview access. See [audit](BJ-V0-001-ARCHITECTURE-AUDIT.md) and [requirements](BJ-V0-003-PRODUCT-REQUIREMENTS.md). |
| BJ-D16 | BLOCKED | Staging account/email qualification on hold. No build, provisioning, migration, production operations, payments or implementation under this documentation authorization. Owner review before next milestone. |
| BJ-D17 | DEFERRED | **Offer-letter creation, release, delivery and verification** excluded from initial product scope; retain only an optional future extension. Basic employer-reported `Offer Extended`, candidate-reported `Accepted`/`Declined`, and employer-reported `Joined` recruitment statuses remain in scope as self-reported workflow states, not validated employment outcomes. **Supersedes BJ-D12 and BJ-D13 for current delivery scope without removing their historical records.** Approved by owner in P3 offer-release discussion, 2026-11-26. No external employer offer documents are required for the MVP. |
| BJ-D18 | APPROVED | **Candidate privacy and discoverability:** New professional profiles default to `PRIVATE`. Candidate may opt into `RECRUITERS_ONLY` or `PUBLIC` profile visibility; Google/search-engine indexing requires a separate opt-in. Name, professional headline, experience, education and skills follow the chosen visibility and field preferences. Photo is optional; current employer and Open to Work visibility are candidate-controlled. Email/phone, salary expectations, saved jobs, applications and their statuses remain private except for access by the applying candidate and the authorized recruiting team; interview details only for invitees. Applying intentionally discloses submitted application information to the relevant authorized recruiting team even if general profile is private. No guarantee that recruiters cannot infer the candidate's job-search activity. Explicit owner approval, P3 candidate-privacy discussion, 2026-11-26. |

## Review and revision history

| Date | Revision | Authority / evidence | Change |
|---|---|---|---|
| Historical approval dates unverified | Historical decisions BJ-D01–BJ-D16 | Owner discussions summarized by BJ-DOC-001 | Original policy approvals preserved; individual dates not fabricated |
| 2026-11-26 | 1.0 | Initial GitHub commit `2504b6003fdd5c571c69c9a5d417b27650aa75db` | Six-file documentation baseline |
| 2026-11-26 | 1.1 | Owner approval to proceed following independent documentation review | Traceability, milestone-scope clarity, extension contract template and offer-issuer responsibility clarified; no new product approval |
| 2026-11-26 | 1.2 | Owner confirmations in P3, BJ-D17 and BJ-D18 | Offer release deferred; privacy/visibility model approved; previous offer concepts retained as historical design only |

### Reconciliation notes

- **Supersession:** BJ-D17 is the current authority over BJ-D12/BJ-D13 on initial product scope. Earlier approvals of a proposed offer-issuance responsibility boundary do not authorize building or launching offer release. Keep historical entries for traceability.
- **Privacy:** BJ-D18 closes the earlier visibility-policy question in BJ-D15. All other BJ-D15 operational, data retention, capacity and security checks remain unresolved.

- The early “10 / day active” wording was superseded by the accepted 10 new/day and 30 simultaneous policy. Unlimited applications is a product policy, not an infrastructure promise.
- Easy employer onboarding and safe offer issuance serve different actions. Earlier suggestions about manual authorization do not create a platform approval chain for employer offers. Separate exact issuer, identity and anti-fraud controls from that policy.
- Preparing entitlements is approved scope; the hypothesized prices and any activation are not. Upload deferral is specific to candidate résumés; attachment handling for offers is an unresolved choice, not a loophole.
- V0 sign-off, later recorded release, current live deployment and future implementation base are distinct. A provisional design assessment does not approve every design detail or create resources.

## Extension & Integration Register

The statuses below describe each integration proposal, not approval of its parent subdivision. Start with owned interfaces and no new infrastructure. For a new entry, add intended capability, owner/consumer, interface and data scope, dependency, compatibility guarantee, extraction trigger and approval needed. Before any extension becomes an actionable design, specify provider and consumer ownership, data/access scope, version and compatibility guarantees, failure and rollback semantics, verified extraction trigger and approval evidence. No speculative service is authorized by a placeholder. Update this register when an extension is reviewed or changes state.

| ID | Status | Capability and proposed integration point | Dependencies and decisions awaiting approval |
|---|---|---|---|
| EXT-01 | PROPOSED | Jobs interviews via Meetings scheduling/admission adapter; Meetings owns rooms/media; Jobs owns applicant records. | Deployed API/identity proof, invitee-only admission, regression, operational headroom and staging approval. |
| EXT-02 | DEFERRED | Optional future employer offer-letter creation, issuance, delivery and verification integration, separate from simple self-reported recruitment statuses. | Explicit future owner reapproval, security/privacy/legal review, issuer authority and company-owned employment commitments; no initial launch dependency. |
| EXT-03 | DEFERRED | Résumé attachments via a Jobs-owned private storage adapter. | Consent, scope, scanning/quarantine, recovery/deletion, verified storage costs and provisioning permission. |
| EXT-04 | DEFERRED | Jobs premium billing via entitlement interface and eventual payment adapter. | Pilot economics, price, product entitlements, compliance, provider and expense approval. |
| EXT-05 | DEFERRED | Jobs networking via Jobs profiles and privacy-aware posts/connections. | Visibility, anti-abuse and moderation. No dependency on a new Chat service. |
| EXT-06 | DEFERRED | BillionIdeas: Virtual Lab, PWS, Idea Hub and Communities via narrowly scoped account and optional collaboration interfaces. | Define PWS contract, domain data ownership, moderation, privacy, budget and project approval. |
| EXT-07 | DEFERRED | BillionChat: messaging and collaboration through identity and optional scoped notification or chat interface. | Separate message ownership, consent, retention and abuse controls; no automatic access to applicant data. |
| EXT-08 | DEFERRED | BillionStore: marketplace via shared identity, own commerce records and future payment contracts. | Merchant/counterparty responsibility, data isolation, privacy and separate approval. |
| EXT-09 | DEFERRED | BillionLearn: courses/workshops via optional Meetings scheduling/admission adapter and its own learning records. | Enrollment access, provider capacity, privacy and milestone scope. |
| EXT-10 | DEFERRED | BillionAI: bounded AI workflows using approved product APIs and per-subdivision usage/access rules. | Purpose, data minimization, consent, evaluation, costs and budget approval; no default applicant access. |
| EXT-11 | PROPOSED | Independent deployment of Jobs or later modules behind compatible versioned interfaces. | Threat model, measured capacity, deployment cadence or regulatory requirement; data/secrets isolation, recovery and rollout/rollback evidence; no resource creation now. |
| EXT-12 | PROPOSED | Reusable email/notifications and security audit conventions when a second product needs the same contract. | Delivery and permission qualification; per-product data boundaries and rate/cost controls. Reuse selectively. |
| EXT-13 | APPROVED (policy); IMPLEMENTATION PENDING | Candidate-controlled professional profile discovery with `PRIVATE` default, optional `RECRUITERS_ONLY`/`PUBLIC`, field-level controls and separate indexing opt-in. | Enforce candidate choice and application-specific authorized disclosure; pending implementation acceptance, authorization tests and deletion/retention design. |

### Future extension design placeholder (not approved implementation)

Complete when an extension advances: **ID · business objective · provider/data owner · consumer · API/version policy · authorization/data scope · failure and rollback · privacy and cost evidence · extraction trigger · milestone dependencies · owner approval/date**. Until then, keep fields explicitly pending.
