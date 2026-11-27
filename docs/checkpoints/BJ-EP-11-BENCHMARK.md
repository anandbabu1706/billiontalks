# EP-11 administration benchmark (official public sources)

Date: 2026-11-27. Short review for local product design; no proprietary implementation was copied.

| Official source | Relevant pattern | BillionJobs decision |
|---|---|---|
| [LinkedIn job violations and enforcement](https://www.linkedin.com/help/linkedin/answer/a1358799) | Job removal, graduated posting restrictions and appeals | Use human decisions, reason-coded actions and an appeal path. A signal alone cannot permanently remove a job. |
| [Indeed trusted hiring](https://www.indeed.com/hire/resources/howtohub/trusted-remote-hiring?co=US) and [flagged jobs](https://www.indeed.com/hire/resources/howtohub/job-flagged-on-indeed?co=US) | Reports, review, fraud indicators, employer verification, duplicate/fee concerns | Preserve free email-verified registration; keep independent employer verification optional and accurately labeled. |
| [Naukri fraud alert](https://company.naukri.com/landing-page/fakejobtrend/new/index.html) | Recruitment fees, false company claims and fake interviews are scam signals | Detect limited text/behavior indicators without inferring guilt or collecting identity documents. |
| [Workable roles](https://help.workable.com/hc/en-us/articles/33608795191959-Managing-and-customizing-roles-and-permissions) and [member management](https://help.workable.com/hc/en-us/articles/115011774607-Managing-account-members) | Hiring team permissions and removal of member access while preserving history | Keep company and listing assignment checks; revoke former owners and recruiters immediately. |
| [Zoho Recruit shared responsibility](https://www.zoho.com/recruit/shared-responsibility-model.html) and [audit logs](https://help.zoho.com/portal/en/kb/recruit/essentials/logs/audit-log/articles/monitoring-audit-logs) | Configured roles, restricted sharing and activity history | Use product-scoped grants and append-oriented metadata audits; do not grant blanket applicant browsing. |
| [Microsoft Entra governance](https://learn.microsoft.com/en-us/entra/id-governance/best-practices-secure-id-governance) | Least privilege, deny by default, access review and audit | Require explicit Jobs roles, recent privileged MFA and reauthentication for high-impact actions. |

Differentiation is the existing Jobs–Meetings boundary, Jobs-only enforcement, private-by-default candidate records and local deterministic review signals with no live AI. These are product decisions, not claims of market superiority. The current identity session cannot prove MFA; administrator operation remains a release gate.
