# BJ-V0-003: Product Requirements & Acceptance

**APPROVED scope:** Functional recruiting first, then interview integration, professional networking and monetization. The approved feature inventory is design scope, not a release authorization. Tests and detailed UI below are **PROPOSED** until reviewed. Business-scope approval does not approve screen designs, acceptance tests, implementation or real-data processing.

| Status | Actor / area | Requirement |
|---|---|---|
| APPROVED | Candidate | Use existing BillionTalks account. Create a structured professional profile with skills, certifications, experience and education. Search/filter and save jobs, apply free, track status and receive application notifications. No résumé upload in initial MVP. |
| APPROVED | Company | Free registration and job publishing. Verify email before publishing; no mandatory manual pre-approval of first listing at launch. Email verification confirms address control, not company legitimacy. Later scrutiny and risk/report-based moderation do not make a verified-company claim. |
| APPROVED | Recruiter | Manage company profile, listings and recruiters; review applications and relevant candidate profiles, shortlist/reject and update recruitment status. Use separate company memberships and permissions. Schedule interviews as a subsequent integration, free within existing Meetings limits. |
| APPROVED | Limits | 10 **new postings per company per day** across all recruiters, and 30 **simultaneously active listings per company**. Listings valid 30 days. Unlimited applications submitted, received and managed as product policy, subject to abuse prevention and verified operational capacity. No paid application gate. |
| PROPOSED | Operational rules | Normal editing does not consume a new posting. Define timezone/reset, expiry semantics, renewals (free subject to controls), duplicates, reposting, concurrent publishing, moderation overrides and candidate reapplication/withdrawal rules before implementation. |
| APPROVED | Subscription strategy | Prepare plan/entitlement and access-control design; defer live subscriptions, checkout and collection. No plan or payment vendor authorized. |
| PROPOSED | Admin/moderation | Use least-privilege tools to triage reports, restrict suspicious accounts and audit actions without broad applicant access. Define reviewer policy, appeals, badges and escalation before launch. |
| DEFERRED | Networking | Connections, posts, discussion/community engagement and related visibility settings follow recruiting. Core company pages and profiles are not deferred. |

## Candidate privacy and professional discoverability — APPROVED policy

New professional profiles default to **PRIVATE**. Candidate-controlled discoverability options: **PRIVATE**, **RECRUITERS_ONLY** (only appropriately authorized recruiters), and **PUBLIC** (only selected public fields). Public search-engine indexing requires an **independent opt-in**, not merely selecting PUBLIC. Name, headline, experience, skills, qualifications and education follow candidate-selected visibility/field preferences. Profile image is optional. Current employer and Open to Work visibility are separately candidate-controlled; do not promise that job-seeking activity will be undiscoverable in every circumstance.

Email, telephone, salary expectations, saved jobs, application history and statuses remain private by default. Authorized recruiters involved in a specific application may review the candidate's submitted application/profile information even if the general profile is PRIVATE; this necessary disclosure must be shown before submission. Interview details are restricted to invitees. Enforce permission changes and separate public search indexing from private authenticated data. Detailed UX, access tests, retention and deletion implementation are **PROPOSED / REQUIRES VERIFICATION**, not yet approved.

## Offer management — DEFERRED from initial MVP

**BJ-D17 supersedes earlier offer-release proposals for current scope.** Do **not** implement BillionJobs offer-letter authoring, distribution, platform verification, document storage or live issuance in the initial MVP. Employers retain their own offer documentation and internal approvals outside BillionJobs. Retain only simplified recruitment workflow states: employer reports **Offer Extended**, candidate explicitly reports **Accepted** or **Declined** (as a status confirmation to the relevant employer), and employer reports **Joined**. Display source and limits of each self-reported status; do not claim independent offer or employment verification. Keep these status controls appropriately authorized and auditable.

The historical concept of a full offer service remains an **optional DEFERRED future extension** in EXT-02. Any future decision to activate it requires new owner approval of separate functionality and safeguards. Documentation describing earlier offer release as approved is historical, not permission to implement it now.

## Proposed acceptance matrix

| Journey | Observable outcome |
|---|---|
| Company onboarding and quota | A verified account can publish without manual preapproval. An unverified account cannot. Concurrent publishers cannot exceed ten new per day or thirty active; an expired listing is inactive after the 30-day validity period. Tests pin the agreed time/reset and renewal rules. |
| Candidate application and recruiter review | Candidate can discover, save, submit and track without billing or a résumé. Authorized recruiters can manage all applicable applicants without a product quota; an unrelated company or unassigned recruiter cannot view or mutate them. Abuse limits are separate from product allowances. |
| Recruiter membership and moderation | Revocation is effective for subsequent sensitive operations. Cross-tenant reads, writes and exports fail; authorized operations leave redacted audit records. |
| Interview | Distinct invitees, correct time zone, one schedule on safe retry, conflict on stale revision, no join on a copied or cancelled invitation without entitlement; Meetings regression and existing allowance verified. |
| Recruitment offer-related status (no offer-document service) | Authorized employer can mark Offer Extended; the intended candidate can explicitly confirm Accepted or Declined; authorized employer can record Joined. Unrelated parties cannot read or change status, and no status is described as verified employment or platform-issued offer. |
| Entitlements and quality | No checkout, payment collection or paid gates for core recruitment. Validate keyboard navigation, focus, labels/error recovery, privacy controls and accessible status updates with automated plus manual checks. |

**REQUIRES VERIFICATION:** Technical enforcement of approved visibility/indexing options and privacy permissions, response and retention SLAs, production baseline, performance budgets, email qualification and final screen-level acceptance. See the [register](BJ-DECISION-REGISTER.md) and [roadmap](BJ-ROADMAP.md).
