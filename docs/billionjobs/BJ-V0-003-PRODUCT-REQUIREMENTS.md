# BJ-V0-003: Product Requirements & Acceptance

**APPROVED scope:** Functional recruiting first, then interview integration, professional networking and monetization. The approved feature inventory is design scope, not a release authorization. BJ-PLAN-001 approves the design scope and acceptance criteria below with REV-001–REV-007. Technical enforcement, actual tests and real-data approval remain pending.

| Status | Actor / area | Requirement |
|---|---|---|
| APPROVED | Candidate | Use existing BillionTalks account. Create a structured professional profile with skills, certifications, experience and education. Search/filter and save jobs, apply free, track status and receive application notifications. No résumé upload in initial MVP. |
| APPROVED | Company | Free registration and job publishing. Verify email before publishing; no mandatory manual pre-approval of first listing at launch. Email verification confirms address control, not company legitimacy. Later scrutiny and risk/report-based moderation do not make a verified-company claim. |
| APPROVED | Recruiter | Manage company profile, listings and recruiters; review applications and relevant candidate profiles, shortlist/reject and update recruitment status. Use separate company memberships and permissions. Schedule interviews as a subsequent integration, free within existing Meetings limits. |
| APPROVED | Limits | 10 **new postings per company per day** across all recruiters (including renewals and reopenings), and 30 **simultaneously active listings per company**. Listings valid 30 days. Unlimited applications submitted, received and managed as product policy, subject to abuse prevention and verified operational capacity. No paid application gate. |
| APPROVED (quota and renewal rules); implementation pending | Operational rules | The company-wide 10-posting daily quota resets at midnight IST (Asia/Kolkata), using server-authoritative timestamps. All recruiters share both posting and active limits. Editing is free; renewals/reopenings consume daily allowance; active renewal is available in final 7 days; no exact duplicate active vacancy. Anti-abuse and atomic enforcement required. Company quota-zone changes are not supported under BJ-D21; moderation and application withdrawal policies follow below. |
| APPROVED | Subscription strategy | Prepare plan/entitlement and access-control design; defer live subscriptions, checkout and collection. No plan or payment vendor authorized. |
| APPROVED (policy) | Admin/moderation | Use least-privilege tools to triage reports, restrict suspicious accounts and audit actions without broad applicant access. Qualify reviewer coverage and escalation before launch. No employer verification badge based solely on email control. |
| DEFERRED | Networking | Connections, posts, discussion/community engagement and related visibility settings follow recruiting. Core company pages and profiles are not deferred. |

## International time-zone policy — APPROVED business rule (BJ-D21)

All companies globally share the same official quota time zone, `Asia/Kolkata` (IST, UTC+05:30). Each company receives 10 posting/renewal/reopening allowances per IST calendar day, resetting at 00:00 IST, with server-authoritative UTC timestamps and atomic company-wide enforcement. No company-specific quota zone, change requests, cooldowns or exceptions are required. Recruiter location and company relocation do not affect quota. Preserve 30 active listings, 30-day validity and BJ-D20 lifecycle rules. User-facing timestamps and interviews display in the viewer/participant local zone; official business reporting defaults to IST. UTC storage remains standard. ₹0 incremental development cash target; implementation and runtime verification pending. This supersedes the historical BJ-D19 company-local reset.

## BJ-POL-001 — Posting lifecycle and renewals (APPROVED business rules)

- A new listing counts as one of the company-wide **10 new postings/renewals/reopenings per IST calendar day**, subject to **30 active listings** at a time.
- Editing an existing listing does **not** consume a daily posting allowance. Closing a filled job immediately frees one active slot.
- A listing's initial validity is **30 days**. An expired listing may be renewed free of charge but renewal uses **one daily posting allowance** and must respect the active listing limit. An active listing may be renewed only during its **final 7 days**, using one daily allowance. Under BJ-D26 / REV-002, active renewal adds **30 days to the existing expiry**; expired renewal or reopening gives **30 days from the successful action**. Each consumes one daily allowance and must respect the active cap.
- Reopening a closed job uses **one daily allowance**. Job deletion is an archive operation that preserves application history for authorized parties according to the later-approved retention policy.
- Block **exact duplicate active vacancies**, warn about similar listings, and allow genuine separate openings where position/location/department/employment arrangement differs. Do not allow delete-and-repost behavior to bypass the quota. Allow users to report misleading or fraudulent listings.
- Existing applications to an expired listing remain accessible to authorized recruiters; new applications stop until that listing is renewed.
- Quotas aggregate across every recruiter in the same company. Enforcement is **atomic and server-side** so concurrent publishes and renewals cannot bypass the 10-per-day or 30-active thresholds. Specific duplicate heuristics, archive/retention implementation, fixed-IST boundary enforcement and tests are still design/implementation tasks—not completed capabilities.

## Candidate privacy and professional discoverability — APPROVED policy

New professional profiles default to **PRIVATE**. Candidate-controlled discoverability options: **PRIVATE**, **RECRUITERS_ONLY** (only appropriately authorized recruiters), and **PUBLIC** (only selected public fields). Public search-engine indexing requires an **independent opt-in**, not merely selecting PUBLIC. Name, headline, experience, skills, qualifications and education follow candidate-selected visibility/field preferences. Profile image is optional. Current employer and Open to Work visibility are separately candidate-controlled; do not promise that job-seeking activity will be undiscoverable in every circumstance.

Email, telephone, salary expectations, saved jobs, application history and statuses remain private by default. Authorized recruiters involved in a specific application may review the candidate's submitted application/profile information even if the general profile is PRIVATE; this necessary disclosure must be shown before submission. Interview details are restricted to invitees. Enforce permission changes and separate public search indexing from private authenticated data. Detailed UX and acceptance are approved as design under BJ-D27. Access enforcement and retention/deletion verification are pending.

## Offer management — DEFERRED from initial MVP

**BJ-D17 supersedes earlier offer-release proposals for current scope.** Do **not** implement BillionJobs offer-letter authoring, distribution, platform verification, document storage or live issuance in the initial MVP. Employers retain their own offer documentation and internal approvals outside BillionJobs. Retain only simplified recruitment workflow states: employer reports **Offer Extended**, candidate explicitly reports **Accepted** or **Declined** (as a status confirmation to the relevant employer), and employer reports **Joined**. Display source and limits of each self-reported status; do not claim independent offer or employment verification. Under BJ-D22 / REV-001 a candidate can withdraw recorded acceptance or report they will not join. Preserve the old acceptance and audit history. These are status controls only.

The historical concept of a full offer service remains an **optional DEFERRED future extension** in EXT-02. Any future decision to activate it requires new owner approval of separate functionality and safeguards. Documentation describing earlier offer release as approved is historical, not permission to implement it now.

## BJ-POL-003: Application and interview lifecycle (BJ-D22/BJ-D23)

- Candidate submits once per listing at a time. Assigned recruiter reviews, shortlists or rejects an open application. Optional interview precedes the outcome where enabled. An active candidate can withdraw, including after Offer Extended. After recording acceptance the candidate can withdraw that acceptance or report non-joining (REV-001); retain the earlier acceptance event and show current self-reported status. Declined, rejected, withdrawn, non-joining and joined close the relevant attempt. Support corrections must add an auditable event, not rewrite history. Employers cannot act for candidates.
- Permit one same-listing reapplication after voluntary application withdrawal and a 24-hour wait, only while the job remains active; no self-service reapplication to the same listing after rejection. New genuine listings are eligible; edits, renewal and reopening of the same listing do not reset attempts. Preserve each attempt under retention policy. Apply server throttles against spam but no commercial cap on distinct jobs. A retry returns the original result; competing transitions conflict and reload current state.
- The assigned scheduler cancels or reschedules; candidate can decline or request rescheduling. Withdrawal or rejection initiates cancellation of future linked interviews. Show cancellation pending until Meetings confirms, stop serving Jobs join links, reconcile ambiguous failures and notify authorized participants generically. Cancelled or stale admission must be denied at Meetings before this feature is enabled.

## BJ-POL-004: Rights and retention (BJ-D24 / REV-003)

| Configurable product default | Planning value and gate |
|---|---|
| Closed applications and minimal linked interview metadata | 180 days after closure, then erase or irreversibly de-identify eligible records; verified obligations and documented holds override defaults. |
| Jobs-only closure | Remove discoverability, indexing signals and active recruiter access; eligible product purge target 30 days, without closing the shared Meetings account. |
| Routine moderation evidence | 90 days from case closure; controlled fraud/dispute/hold exceptions. Security logs and legally required records follow a separately validated schedule. |
| Rights service target | Acknowledge and complete verified export/erasure workflow within proposed 30-day service target or shorter applicable deadline; target is not a legal determination. |

Legal validation is mandatory before real applicant data. Validate launch jurisdictions, applicable DPDP/CERT-In obligations, processor and region choices, backups, required security logs and retention/hold handling. Give pre-apply disclosure, version notices, separate optional consents and visibility/indexing, verify requester identity for rights actions, scope exports and use expiring authenticated delivery. Restored snapshots must reapply deletion decisions before exposure. Employer copies and search caches may persist independently. Name privacy lead, support verifier, engineering operator and incident lead before pilot; employers handle their own recruitment records. Adults only for the controlled pilot; no unnecessary ID collection. See [MeitY DPDP materials](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa) and [CERT-In directions](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf).

## BJ-POL-005: Fraud and enforcement (BJ-D25)

Keep eligible email-verified publishing without mandatory manual first-post clearance. Label email control accurately. Add report action to relevant company, listing and applicant-contact surfaces. Triage impersonation, fees, phishing and misuse with signals and human review; automated signals are not proof. Use scoped evidence, hide credible harmful listings or suspend affected Jobs permissions, preserve unrelated Meetings access, notify safely, log reason/duration and permit appeals with independent review where feasible. Internal targets: same business day for urgent cases, three business days for routine triage, conditional on staffing. Test reporter confidentiality, revocation, appeals and restoration before public release.

## BJ-V0-003A: Screen inventory (BJ-D27, design approved)

| Role | Initial screens and state changes |
|---|---|
| Visitor / identity | Jobs landing, results/detail, company page, existing sign-in/email verification/recovery with safe return; only explicitly public fields. |
| Candidate | Profile builder/preview, visibility and indexing controls, filters/saved jobs, application disclosure/review, submit/history, withdrawal/reapplication and reported outcome, notifications, report and rights center. |
| Company admin | Company setup/email verification, profile, team invite/roles/revoke, IST quota summary, restrictions and appeal status. |
| Recruiter | Assigned jobs dashboard, listing form/preview, lifecycle controls, applicants and authorized status actions. |
| Interviews (gated) | Time selector, invitation, local-time detail, decline/request reschedule, pending/confirmed cancellation and authorized join. |
| Moderator / privacy operator | Report queue/detail, scoped evidence, restriction, audit, appeal, and rights request/export/deletion status; no unrestricted applicant browser. |

Test validation and field errors, loading/empty/offline, expired/revoked access, stale edits, throttling, safe retry, and conflict recovery without losing drafts. Require all critical journeys and cross-tenant/field-level denial tests to pass, no known high/critical security defects, and keyboard/focus/screen-reader support to [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/). Agreed-load acceptance targets: Jobs list/detail p95 ≤500 ms, non-interview writes ≤1 s, no material degradation in matched Meetings regression. No uploads, offer-letter screens, social expansion, subscriptions or checkout in the initial release.

## Approved acceptance design (execution pending)

| Journey | Observable outcome |
|---|---|
| Company onboarding and quota | A verified account can publish without manual preapproval. An unverified account cannot. Concurrent publishers cannot exceed ten new per day or thirty active; an expired listing is inactive after the 30-day validity period. Tests cover the approved time-zone reset, renewals, close/reopen, duplicate/repost safeguards, archival history and concurrency. |
| Candidate application and recruiter review | Candidate can discover, save, submit and track without billing or a résumé. Authorized recruiters can manage all applicable applicants without a product quota; an unrelated company or unassigned recruiter cannot view or mutate them. Abuse limits are separate from product allowances. |
| Recruiter membership and moderation | Revocation is effective for subsequent sensitive operations. Cross-tenant reads, writes and exports fail; authorized operations leave redacted audit records. |
| Interview | Distinct invitees, correct time zone, one schedule on safe retry, conflict on stale revision, no join on a copied or cancelled invitation without entitlement; Meetings regression and existing allowance verified. |
| Recruitment offer-related status (no offer-document service) | Authorized employer can report Offer Extended. Only the intended candidate can record Accepted/Declined and later withdraw acceptance or report non-joining. Original acceptance and audit history survive. Employer can report Joined only from a currently accepted state; corrections after Joined use auditable support review. Unrelated parties cannot read or change status, and no status is described as verified employment or platform-issued offer. |
| Entitlements and quality | No checkout, payment collection or paid gates for core recruitment. Validate keyboard navigation, focus, labels/error recovery, privacy controls and accessible status updates with automated plus manual checks. |

**REQUIRES VERIFICATION:** Visibility/indexing, retention/deletion, rights operations, actual test results, production baseline, performance, reviewer coverage and email qualification.
