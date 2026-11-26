# BJ-V0-001: Existing Architecture Audit

**APPROVED scope:** Read-only repository and project-history audit. The audit work is complete within that scope. Live operational readiness remains **REQUIRES VERIFICATION**; this document consolidates previous findings without rerunning that work.

## Verified repository evidence

| Evidence | Verified fact and scope |
|---|---|
| E1 | [V0 sign-off commit](https://github.com/anandbabu1706/billiontalks/commit/e5cd35bc30120125f82069b5a665be3daa276c23) is the verified `main` head at documentation branching. The [V0 checkpoint](../checkpoints/BT-V0-FINAL.md) names the historical qualified application source `2471d8f...` and records V0 test and device results. These are historical; this audit did not rerun them. |
| E2 | A later [website release record](https://github.com/anandbabu1706/billiontalks/blob/bt-website-favicon-production-release/docs/checkpoints/BT-WEBSITE-FAVICON-CORRECTION.md) identifies release source `59223d775418e0adb550f1e9a71c2a7388ae2485`. That is the latest production source supported by the reviewed release evidence, not proof of the current deployment. The V1 public operational closure does not mean all media, recording or reliability items were physically qualified. |
| E3 | [Account session source at the recorded release](https://github.com/anandbabu1706/billiontalks/blob/59223d775418e0adb550f1e9a71c2a7388ae2485/src/account/authentication.ts) supports host-only cookie handling. Reuse of its authenticated account ID is viable in principle; a subdomain cannot be assumed to receive that cookie. |
| E4 | [Baseline Worker configuration](https://github.com/anandbabu1706/billiontalks/blob/e5cd35bc30120125f82069b5a665be3daa276c23/wrangler.jsonc), [Worker entry point](https://github.com/anandbabu1706/billiontalks/blob/e5cd35bc30120125f82069b5a665be3daa276c23/src/index.ts), [Meeting state](https://github.com/anandbabu1706/billiontalks/blob/e5cd35bc30120125f82069b5a665be3daa276c23/src/meeting.ts), and [package/tooling](https://github.com/anandbabu1706/billiontalks/blob/e5cd35bc30120125f82069b5a665be3daa276c23/package.json) establish the existing Worker, account persistence, Durable Objects and test stack. Repository bindings are not a live account inventory. The release-era scheduling interface remains a candidate, not an already qualified Jobs contract. |

Prior bounded GitHub search found no BJ-V0-001 branch or issue and did not establish implementation status beyond the inspected refs. A separate Windows capability check inspected `package.json` in VS Code on a different local branch and observed Codex UI, but did not submit a new Codex task. The BJ-V0-002 consolidation did not operate VS Code; a fresh command-line recheck was blocked before execution. No local checkout is the documentation branch base.

## Open checks

- **REQUIRES VERIFICATION:** Actual production/staging deployed SHAs, routes, bindings, isolation, peak usage, product quotas and Cloudflare bill. Historical samples of 33,790 production and 8,780 staging Worker requests over 30 days are not a current capacity or spend check. Do not infer conducted meetings from scheduled records, web traffic or Worker invocations.
- **BLOCKED:** Full staging registration, email verification, login and recovery qualification is on hold pending renewed authorization and access to an approved test mailbox. No live test was authorized here.
- **REQUIRES VERIFICATION:** Current media/admission regression evidence, authenticated scheduling compatibility, revocation, and invitee-only join for interviews.
- **PROPOSED:** Use the stable verified account identifier rather than email as the shared reference, require Jobs-owned data boundaries, and qualify Meetings as an integration before enabling interviews. See the [design](BJ-V0-002-ARCHITECTURE-DESIGN.md).
