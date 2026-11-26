# BJ-MPB-001: BillionJobs Master Blueprint

**APPROVED:** BillionTalks.com stays the parent ecosystem. Preserve the existing BillionTalks Meetings service, release history and outstanding backlog. BillionJobs is the next development track, using original implementation. Separate roadmaps and appropriate data isolation apply to all subdivisions. This is a planning baseline, not implementation or release approval.

## Scope and boundaries

| Status | Track | Purpose and boundary |
|---|---|---|
| APPROVED | BillionTalks Meetings | Existing video service. Owns meeting scheduling, rooms, admission, media and recordings. Protect existing clients and routes. |
| APPROVED | BillionJobs | Functional recruiting first: profiles, companies, job discovery, applications and recruiter workspace. Interviews follow the foundation; networking and monetization follow in approved phases. The long-term scope includes companies and branding, connections, professional posts and discussions, moderation, verification and subscription features. |
| DEFERRED | BillionIdeas | Separate learning and innovation track: Virtual Lab, PWS integration, Idea Hub and Communities. |
| DEFERRED | BillionChat | Messaging and collaboration. |
| DEFERRED | BillionStore | Marketplace, with separate commerce and payment responsibilities. |
| DEFERRED | BillionLearn | Professional education and workshops. |
| DEFERRED | BillionAI | AI productivity; distinct data access, usage and cost controls. |

**APPROVED:** Reuse BillionTalks accounts and retain separate organization-scoped recruiter permissions and a separate Jobs D1 data boundary. Shared capabilities are used when they offer real value and can preserve separation. **PROPOSED:** Treat identity, meeting scheduling, notifications, security/audit conventions and entitlement contracts as logical platform interfaces, not a mandate for new central services. Jobs owns its roles, profiles, companies, listings, applications and product entitlements; identity and Meetings keep their own records.

## Mandatory principle: future extensibility

**APPROVED:** Every subdivision must be able to add features and integrations, develop on its own branch, and later extract modules for independent deployment where justified. No speculative Workers, databases, gateways or queues. Use the [extension register](BJ-DECISION-REGISTER.md#extension--integration-register) to capture a producer, consumer, data owner, dependencies, compatibility and pending approvals. The implementation pattern and extraction criteria are [proposed here](BJ-V0-002-ARCHITECTURE-DESIGN.md#module-boundaries-and-extraction).

## Financial and release governance

**APPROVED:** Target ₹0 additional development cash using existing ChatGPT, Codex, GitHub and Cloudflare allowances; exclude hypothetical contractor labour from cash estimates. Separately record existing expenses, any mandatory or usage-based costs, and optional future spend. No upgrade, paid service, production action or product build is authorized by this blueprint. Use versioned acceptance evidence, review results with the owner before opening the next work item, and keep Android and Meetings improvements separate from Jobs.

**Evidence:** BJ-MPB-001 P3 project planning, subsequent owner scope decisions and BJ-DOC-001; sensitive project discussions are summarized instead of linked in this public repository. See the [decision register](BJ-DECISION-REGISTER.md), [roadmap](BJ-ROADMAP.md) and [historical Meetings sign-off](../checkpoints/BT-V0-FINAL.md).
