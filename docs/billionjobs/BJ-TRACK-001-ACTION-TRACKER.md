# BillionJobs Master Action & Completion Tracker

**Document ID:** BJ-TRACK-001  
**Review date:** 2026-11-26  
**Status:** Living project register, initial baseline  
**Scope:** BillionJobs and relevant shared BillionTalks dependencies. Documentation only; not implementation authorization.

## Status definitions

- **COMPLETED:** Applicable scoped work has documented evidence. Completion of planning or read-only investigation does **not** imply implementation, environment qualification or release.
- **APPROVED (SCOPE):** Owner confirmed the requirement/policy; code and tests not necessarily completed.
- **DESIGN COMPLETE / PROVISIONAL:** Draft deliverable exists; outstanding decisions may remain.
- **IN PROGRESS:** An actively discussed or documented planning item, not an ongoing autonomous task.
- **PENDING:** Not yet resolved or qualified.
- **NOT STARTED:** Implementation has not commenced.
- **DEFERRED:** Explicitly outside initial release; retained as an optional future extension.
- **BLOCKED:** Requires new owner authorization or an external dependency before it can proceed.

## A. Project governance and architecture

| ID | Action item | Status | Evidence / completion boundary |
|---|---|---|---|
| BJ-MPB-001 | Consolidated Master Blueprint | COMPLETED (planning) | [Blueprint](BJ-MPB-001-MASTER-BLUEPRINT.md), approved business baseline; no build approval |
| BJ-V0-001 | Read-only GitHub and history architecture audit | COMPLETED (scoped audit) | [Audit](BJ-V0-001-ARCHITECTURE-AUDIT.md); not a live account audit |
| BJ-V0-001A | Live production/staging bindings, capacity, cost and media readiness | PENDING | Authenticated read-only verification and evidence still needed |
| BJ-V0-002 | Proposed architecture and independent review | DESIGN COMPLETE / PROVISIONAL | [Design](BJ-V0-002-ARCHITECTURE-DESIGN.md); per-decision owner approvals only |
| BJ-V0-002A | Finalize route/runtime, isolation and integration architecture | PENDING | Resolve design dependencies before implementation authorization |
| BJ-V0-003 | Recruitment feature scope and business policy | APPROVED (SCOPE) | [Requirements](BJ-V0-003-PRODUCT-REQUIREMENTS.md); not detailed implementation acceptance |
| BJ-V0-003A | Screen flows, full acceptance criteria and operating rules | IN PROGRESS (discussion) | Owner approval and approved acceptance matrix pending |
| BJ-DOC-001 | Six-file GitHub consolidation and later refinements | COMPLETED (documentation only) | Branch `docs/bj-doc-001`; review commits `2504b600`, `00bcd13d`, `0343388f`, `c9181de8` |
| BJ-DOC-002 | Create master action/completion register | COMPLETED (documentation only) | This tracker; verify committing revision and branch in GitHub |

## B. Business decisions and unresolved policy

| ID | Action item | Status | Evidence / implementation note |
|---|---|---|---|
| BJ-D03 | Reuse accounts; separate Jobs D1 and company permissions | APPROVED (SCOPE) | Resource creation and permissions implementation not yet authorized |
| BJ-D05 | Free jobs: 10 new/day, 30 active, 30-day listing validity | APPROVED (SCOPE) | Atomic enforcement not yet implemented |
| BJ-D06 | Publishing immediately after account email verification | APPROVED (SCOPE) | No mandatory employer pre-approval for job listing; abuse controls required |
| BJ-D07 | Recruiting before networking and monetization | APPROVED (SCOPE) | Sequencing only |
| BJ-D09 | Prepare entitlements; defer live billing | APPROVED (SCOPE) | No activated checkout or payment collection |
| BJ-D17 | Offer-letter creation, release, delivery and verification | DEFERRED | Basic employer/candidate-reported recruitment status confirmations retained |
| BJ-D18 | Private-by-default candidate profiles, opt-in recruiter/public discoverability, separate indexing opt-in | APPROVED (SCOPE) | Enforcement tests pending |
| BJ-D19 | Company-local midnight quota reset using confirmed IANA zone | APPROVED (SCOPE) | Server UTC authority; participant-local interview display |
| BJ-POL-001 | Renewals, reposting, duplicates and expiry operational rules | PENDING | Must not undermine the 10/day and 30-active policy |
| BJ-POL-002 | Time-zone change controls and daily reset anti-circumvention | PENDING | Existing company-local reset decision stays approved |
| BJ-POL-003 | Application withdrawal, reapplication and status transitions | PENDING | Design/acceptance required |
| BJ-POL-004 | Data retention, deletion/export and privacy operations | PENDING | Before real applicant data |
| BJ-POL-005 | Fraud reports, company moderation, escalation and appeals | PENDING | Minimum safety before public release |
| BJ-POL-006 | Final tier entitlements and subscription price validation | DEFERRED | Hypotheses only: Individual Free/₹99/₹199; Business Free/₹499/₹1,499/₹2,999 per month |

## C. Development milestones

| ID | Deliverable | Status | Required completion evidence |
|---|---|---|---|
| BJ-V1-001 | Professional profiles | NOT STARTED | Approved screens, code, tests and privacy controls |
| BJ-V1-002 | Companies, memberships and recruiter roles | NOT STARTED | Permission tests, membership revocation and tenant isolation |
| BJ-V1-003 | Job search, postings and applications | NOT STARTED | Quota, workflow and authorization tests |
| BJ-V1-004 | Recruiter application workspace | NOT STARTED | Application lifecycle, tenant isolation and tests |
| BJ-V1-005 | Interview scheduling and Meetings integration | NOT STARTED | Admission, retries, time zones and Meetings regression |
| BJ-V1-006 | Networking and posts | DEFERRED | Separate milestone approval |
| BJ-V1-007 | Full platform administration/moderation | NOT STARTED | Abuse controls and audit evidence; minimum safeguards required earlier |
| BJ-V1-008 | Monetization and premium features | DEFERRED | Approved entitlements, merchant and paid activation |
| BJ-V1-009 | Final functional, accessibility, security and regression qualification | NOT STARTED | Evidence-backed sign-off |
| BJ-REL-001 | First public release | BLOCKED | Separate owner permission, actual environment readiness, rollback and sign-off |

## D. Mandatory verification on every milestone

1. Compare milestone objective, approved requirements, documented scope and evidence (exact commit, branch, tests, deployment if relevant).
2. Do not conflate approved scope with development or verified release. Mark scoped completion only.
3. Check legacy Meetings regression and cross-tenant/candidate privacy risks wherever affected.
4. Review cash implications using existing / mandatory / usage-based / optional categories; **₹0 additional development cash is a target, not guaranteed operating cost**.
5. Present results and outstanding questions to the owner **before** any next prompt, implementation, deployment or new expense.
6. Append a dated revision entry below and update the specific task row only after evidence supports it. Never silently erase historical decisions; keep extensibility placeholders for future subdivisions.

## Tracker revision log

| Date | Revision | Change |
|---|---|---|
| 2026-11-26 | 1.0 | Established master action tracker from BJ-DOC-001, BJ-V0-003 and BJ-D19; planning, business approvals and development statuses separated |

**Branch safety:** Current documentation branch was based on historical `main` V0. Never assume it is an implementation base. No automatic merge or production release.
