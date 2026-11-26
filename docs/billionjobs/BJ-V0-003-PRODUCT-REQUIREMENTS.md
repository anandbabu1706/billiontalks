# BJ-V0-003: Product Requirements & Acceptance

**APPROVED scope:** Functional recruiting first, then interview integration, professional networking and monetization. The approved feature inventory is design scope, not a release authorization. Tests and detailed UI below are **PROPOSED** until reviewed. Business-scope approval does not approve screen designs, acceptance tests, implementation or real-data processing.

| Status | Actor / area | Requirement |
|---|---|---|
| APPROVED | Candidate | Use existing BillionTalks account. Create a structured professional profile with skills, certifications, experience and education. Search/filter and save jobs, apply free, track status and receive application notifications. No résumé upload in initial MVP. |
| APPROVED | Company | Free registration and job publishing. Verify email before publishing; no mandatory manual pre-approval of first listing at launch. Email verification confirms address control, not company legitimacy. Later scrutiny and risk/report-based moderation do not make a verified-company claim. |
| APPROVED | Recruiter | Manage company profile, listings and recruiters; review applications and relevant candidate profiles, shortlist/reject and update recruitment status. Use separate company memberships and permissions. Schedule interviews as a subsequent integration, free within existing Meetings limits. |
| APPROVED | Limits | 10 **new postings per company per day** across all recruiters, and 30 **simultaneously active listings per company**. Listings valid 30 days. Unlimited applications submitted, received and managed as product policy, subject to abuse prevention and verified operational capacity. No paid application gate. |
| APPROVED (quota and renewal rules); implementation pending | Operational rules | The company-wide 10-posting daily quota resets at midnight IST (Asia/Kolkata), using server-authoritative timestamps. All recruiters share both posting and active limits. Editing is free; renewals/reopenings consume daily allowance; active renewal is available in final 7 days; no exact duplicate active vacancy. Anti-abuse and atomic enforcement required. Company quota-zone changes are not supported under BJ-D21; moderation and application withdrawal rules remain open. |
| APPROVED | Subscription strategy | Prepare plan/entitlement and access-control design; defer live subscriptions, checkout and collection. No plan or payment vendor authorized. |
| PROPOSED | Admin/moderation | Use least-privilege tools to triage reports, restrict suspicious accounts and audit actions without broad applicant access. Define reviewer policy, appeals, badges and escalation before launch. |
| DEFERRED | Networking | Connections, posts, discussion/community engagement and related visibility settings follow recruiting. Core company pages and profiles are not deferred. |

## International time-zone policy — APPROVED business rule (BJ-D21)

All companies globally share the same official quota time zone, `Asia/Kolkata` (IST, UTC+05:30). Each company receives 10 posting/renewal/reopening allowances per IST calendar day, resetting at 00:00 IST, with server-authoritative UTC timestamps and atomic company-wide enforcement. No company-specific quota zone, change requests, cooldowns or exceptions are required. Recruiter location and company relocation do not affect quota. Preserve 30 active listings, 30-day validity and BJ-D20 lifecycle rules. User-facing timestamps and interviews display in the viewer/participant local zone; official business reporting defaults to IST. UTC storage remains standard. ₹0 incremental development cash target; implementation and runtime verification pending. This supersedes the historical BJ-D19 company-local reset.

## BJ-POL-001 — Posting lifecycle and renewals (APPROVED business rules)

- A new listing counts as one of the company-wide **10 new postings/renewals per IST calendar day**, subject to **30 active listings** at a time.
- Editing an existing listing does **not** consume a daily posting allowance. Closing a filled job immediately frees one active slot.
- A listing's initial validity is **30 days**. An expired listing may be renewed free of charge but renewal uses **one daily posting allowance** and must respect the active listing limit. An active listing may be renewed only during its **final 7 days**, using one daily allowance. Renewal grants another **30 days of validity**. The exact start timestamp for the renewed validity term and any race-condition semantics must be specified in technical acceptance criteria without contradicting these rules.
- Reopening a closed job uses **one daily allowance**. Job deletion is an archive operation that preserves application history for authorized parties according to the later-approved retention policy.
- Block **exact duplicate active vacancies**, warn about similar listings, and allow genuine separate openings where position/location/department/employment arrangement differs. Do not allow delete-and-repost behavior to bypass the quota. Allow users to report misleading or fraudulent listings.
- Existing applications to an expired listing remain accessible to authorized recruiters; new applications stop until that listing is renewed.
- Quotas aggregate across every recruiter in the same company. Enforcement is **atomic and server-side** so concurrent publishes and renewals cannot bypass the 10-per-day or 30-active thresholds. Specific duplicate heuristics, archive/retention implementation, fixed-IST boundary enforcement and tests are still design/implementation tasks—not completed capabilities.

## Candidate privacy and professional discoverability — APPROVED policy

New professional profiles default to **PRIVATE**. Candidate-controlled discoverability options: **PRIVATE**, **RECRUITERS_ONLY** (only appropriately authorized recruiters), and **PUBLIC** (only selected public fields). Public search-engine indexing requires an **independent opt-in**, not merely selecting PUBLIC. Name, headline, experience, skills, qualifications and education follow candidate-selected visibility/field preferences. Profile image is optional. Current employer and Open to Work visibility are separately candidate-controlled; do not promise that job-seeking activity will be undiscoverable in every circumstance.

Email, telephone, salary expectations, saved jobs, application history and statuses remain private by default. Authorized recruiters involved in a specific application may review the candidate's submitted application/profile information even if the general profile is PRIVATE; this necessary disclosure must be shown before submission. Interview details are restricted to invitees. Enforce permission changes and separate public search indexing from private authenticated data. Detailed UX, access tests, retention and deletion implementation are **PROPOSED / REQUIRES VERIFICATION**, not yet approved.

## Offer management — DEFERRED from initial MVP

**BJ-D17 supersedes earlier offer-release proposals for current scope.** Do **not** implement BillionJobs offer-letter authoring, distribution, platform verification, document storage or live issuance in the initial MVP. Employers retain their own offer documentation and internal approvals outside BillionJobs. Retain only simplified recruitment workflow states: employer reports **Offer Extended**, candidate explicitly reports **Accepted** or **Declined** (as a status confirmation to the relevant employer), and employer reports **Joined**. Display source and limits of each self-reported status; do not claim independent offer or employment verification. Keep these status controls appropriately authorized and auditable.

The historical concept of a full offer service remains an **optional DEFERRED future extension** in EXT-02. Any future decision to activate it requires new owner approval of separate functionality and safeguards. Documentation describing earlier offer release as approved is historical, not permission to implement it now.

## Proposed acceptance matrix

| Journey | Observable outcome |
|---|---|
| Company onboarding and quota | A verified account can publish without manual preapproval. An unverified account cannot. Concurrent publishers cannot exceed ten new per day or thirty active; an expired listing is inactive after the 30-day validity period. Tests cover the approved time-zone reset, renewals, close/reopen, duplicate/repost safeguards, archival history and concurrency. |
| Candidate application and recruiter review | Candidate can discover, save, submit and track without billing or a résumé. Authorized recruiters can manage all applicable applicants without a product quota; an unrelated company or unassigned recruiter cannot view or mutate them. Abuse limits are separate from product allowances. |
| Recruiter membership and moderation | Revocation is effective for subsequent sensitive operations. Cross-tenant reads, writes and exports fail; authorized operations leave redacted audit records. |
| Interview | Distinct invitees, correct time zone, one schedule on safe retry, conflict on stale revision, no join on a copied or cancelled invitation without entitlement; Meetings regression and existing allowance verified. |
| Recruitment offer-related status (no offer-document service) | Authorized employer can mark Offer Extended; the intended candidate can explicitly confirm Accepted or Declined; authorized employer can record Joined. Unrelated parties cannot read or change status, and no status is described as verified employment or platform-issued offer. |
| Entitlements and quality | No checkout, payment collection or paid gates for core recruitment. Validate keyboard navigation, focus, labels/error recovery, privacy controls and accessible status updates with automated plus manual checks. |

**REQUIRES VERIFICATION:** Technical enforcement of approved visibility/indexing options and privacy permissions, response and retention SLAs, production baseline, performance budgets, email qualification and final screen-level acceptance. See the [register](BJ-DECISION-REGISTER.md) and [roadmap](BJ-ROADMAP.md).
