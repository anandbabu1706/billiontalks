# BillionJobs Roadmap & Release Gates

**APPROVED:** Recruiting first, then interview integration, professional networking and monetization. Sequence preserves the existing Meetings and Android tracks. Milestone IDs below are retained from BJ-MPB-001; implementation is **BLOCKED** until explicitly authorized. Owners must discuss results before opening a follow-on prompt or workstream.

| Milestone | Status | Scope or exit evidence |
|---|---|---|
| BJ-MPB-001 | APPROVED | [Planning baseline](BJ-MPB-001-MASTER-BLUEPRINT.md), scope, principles and ₹0 incremental development target. |
| BJ-V0-001 | APPROVED | [Repository/history audit](BJ-V0-001-ARCHITECTURE-AUDIT.md) completed for its read-only scope; active infrastructure verification remains open. |
| BJ-V0-002 | PROPOSED | [Architecture and independent review](BJ-V0-002-ARCHITECTURE-DESIGN.md) ready for owner review. Only individually confirmed design decisions are approved. |
| BJ-V0-003 | APPROVED (business scope only) | [Confirmed product policy and feature scope](BJ-V0-003-PRODUCT-REQUIREMENTS.md). Detailed screens, acceptance tests, technical privacy implementation and operational rules remain **PROPOSED / REQUIRES VERIFICATION**; the privacy and visibility business policy is **APPROVED**; no build or launch authorized. |
| BJ-DOC-001 | APPROVED (documentation only) | Consolidation on a dedicated documentation branch only; owner review before any merge or implementation. |
| BJ-V1-001 | BLOCKED | Professional profiles: structured education, skills, experience and privacy controls. |
| BJ-V1-002 | BLOCKED | Company management: company profile, membership, delegation and revocation. |
| BJ-V1-003 | BLOCKED | Jobs and applications: publish, discover, save, apply, quotas and status. |
| BJ-V1-004 | BLOCKED | Recruitment workspace: applicant review and status actions; prove tenant separation. |
| BJ-V1-005 | BLOCKED | Interview integration after recruiting acceptance; prove Meetings access, recovery and regression. |
| BJ-V1-006 | DEFERRED | Networking: connections, posts, discussions and reporting. |
| BJ-V1-007 | BLOCKED | Administration and moderation: abuse reports, verification, audit and enforcement. Minimum safety controls must be in earlier slices before public launch; this milestone is the fuller workstream. |
| BJ-V1-008 | DEFERRED | Monetization readiness: configure entitlement design first; vendor, checkout and live payments need separate approval. |
| BJ-V1-009 | BLOCKED | Final qualification: security, integration, accessibility, regression, capacity and owner acceptance. |
| Offer-letter management extension | DEFERRED | No initial issuance or document system. Optional future work requires explicit reapproval; simple employer/candidate-reported recruitment statuses remain within recruiting scope. |

## Proposed go/no-go checks

1. **Before build:** Confirm the actual coding baseline, environmental compatibility, requirement cutline and scope of authorization. The documentation base is the verified default-branch V0 sign-off, not a direction to build against that historical release.
2. **Before synthetic staging:** Authorize the branch and resources, pin fixtures and scope, ensure Jobs is off by default, preserve route behavior and define how to disable it without breaking Meetings. No production data. Pass functional and isolation tests for two employers and two candidates.
3. **Before genuine applicant data:** Verify separate Jobs persistence and recovery, retention/deletion, accountable operators, privacy and abuse handling, role revocation, accessibility and risk-based runtime isolation. Verify actual account allowances, peak headroom, billing and Meetings performance/regression. No silent spend.
4. **Before interviews or recruitment status confirmation:** Qualify interview integration independently on admission/invitee behavior and authorized email testing when email is used. Restrict basic employer/candidate-reported recruitment status transitions to the correct participants. Full offer-letter issuance is deferred and cannot be activated without a new owner-approved milestone and safeguards.
5. **Before broader release or monetization:** Review actual pilot usage, rollback evidence, privacy, support load and mandatory/usage-based expense. Obtain separate owner approval for production and paid activation.

## Expense categories

- **APPROVED target:** ₹0 additional development cash using existing allowances; exclude hypothetical paid developer time.
- **REQUIRES VERIFICATION:** Cloudflare plan, usage and fees; email and identity volume; applicable mandatory verification or compliance costs. Shared capacity must cover existing Meetings plus Jobs.
- **DEFERRED:** New storage, document safety tooling, payment providers and marketing. Trigger based on measured need and owner approval, not on speculative feature expansion.
