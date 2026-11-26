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

## Offer management: employer commitments and platform safeguards

**APPROVED:** Employers control their own internal approvals and choose authorized issuers. Employers own offer terms, eligibility, compensation, joining and employment commitments. BillionJobs provides authenticated issuance and delivery, records the candidate's acceptance status and makes it available to the authorized employer. Employer selection of its issuer remains an internal decision; BillionJobs authenticates the designated user's platform permissions without approving the employer's hiring decision. The platform applies safeguards on its own service; it does not sit in the employer's approval chain or guarantee employment, joining, payment or any outcome. The candidate decides whether to accept. This does not waive the platform's applicable security, privacy or complaint-handling responsibilities.

**PROPOSED:** Let only a current, designated employer issuer release a versioned offer to the intended applicant. Record actor, company, version, timestamp and delivery/response state; allow the candidate to view the exact version securely and accept or decline. Distinguish presented, accepted, declined, expired, withdrawn and superseded states. Prevent unauthorized, duplicate or stale acceptance. Keep terms out of email, URLs and general logs. Provide reports, audit history and platform suspension controls; do not redesign the employer's internal chain of approval. Basic job-post eligibility is not the same as authority to issue offers.

**REQUIRES VERIFICATION:** Decide which phase can introduce live offers; what platform-side employer verification, issuer delegation and authentication are proportionate; retention and withdrawal rules; handling of disputes and access to records; and review of product terms and applicable obligations. No live issuance or manual BillionJobs approval of each employer offer is authorized. The exact controls are not settled by approval of the responsibility boundary.

## Proposed acceptance matrix

| Journey | Observable outcome |
|---|---|
| Company onboarding and quota | A verified account can publish without manual preapproval. An unverified account cannot. Concurrent publishers cannot exceed ten new per day or thirty active; an expired listing is inactive after the 30-day validity period. Tests pin the agreed time/reset and renewal rules. |
| Candidate application and recruiter review | Candidate can discover, save, submit and track without billing or a résumé. Authorized recruiters can manage all applicable applicants without a product quota; an unrelated company or unassigned recruiter cannot view or mutate them. Abuse limits are separate from product allowances. |
| Recruiter membership and moderation | Revocation is effective for subsequent sensitive operations. Cross-tenant reads, writes and exports fail; authorized operations leave redacted audit records. |
| Interview | Distinct invitees, correct time zone, one schedule on safe retry, conflict on stale revision, no join on a copied or cancelled invitation without entitlement; Meetings regression and existing allowance verified. |
| Offer | No unauthorized issuer or unrelated candidate can see, issue or accept. Candidate response is tied to the exact current offer and visible to the authorized employer. Invalid or superseded responses are rejected, and notice makes the employer/platform distinction clear. |
| Entitlements and quality | No checkout, payment collection or paid gates for core recruitment. Validate keyboard navigation, focus, labels/error recovery, privacy controls and accessible status updates with automated plus manual checks. |

**REQUIRES VERIFICATION:** Public profile/indexing options, privacy permissions, response and retention SLAs, production baseline, performance budgets, email qualification and final screen-level acceptance. See the [register](BJ-DECISION-REGISTER.md) and [roadmap](BJ-ROADMAP.md).
