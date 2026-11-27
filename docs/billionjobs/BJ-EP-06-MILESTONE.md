# EP-06 company and recruiter management completion

Recorded 2026-11-27. Development branch bj-ep-06-companies-recruiters and application commit [723f89bd2a0a0101a0776cf1c7d10616648c6d70](https://github.com/anandbabu1706/billiontalks/commit/723f89bd2a0a0101a0776cf1c7d10616648c6d70).

The application extends EP-05 with company registration and profile management, tenant selection, synthetic recipient-bound invitations, owner and recruiter administration, revocation, company restrictions and reporting. EP-07 can use current entitlements and the existing PostingQuota service. The application evidence records the verified file inventory and test results.

- [Local runbook](https://github.com/anandbabu1706/billiontalks/blob/723f89bd2a0a0101a0776cf1c7d10616648c6d70/docs/checkpoints/BJ-EP-06-LOCAL.md)
- [Machine-readable test evidence](https://github.com/anandbabu1706/billiontalks/blob/723f89bd2a0a0101a0776cf1c7d10616648c6d70/docs/checkpoints/BJ-EP-06-EVIDENCE.json)

Type checking passed. The full suite passed 479 of 481 tests, with the two existing Meetings camera and calendar failures. All five new company tests and 49 inherited Jobs tests passed. The Windows restart fixture required a shorter directory name under this worktree. Browser and device visual qualification remains pending.

Ownership is fixed at registration. Jobs closure for a company owner requires a future approved ownership or company retirement policy. Company restrictions and reporting provide scoped integration points for later moderation workflows. Production delivery, real-data security and privacy qualification, and operational reporting and appeals remain deferred.

EP-07 requires separate authorization and should enforce current membership and company restrictions for each listing operation, using the existing atomic quota service. No incremental cash expenditure was incurred.
