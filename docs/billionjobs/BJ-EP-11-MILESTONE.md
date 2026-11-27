# EP-11 / BJ-V1-007 documentation checkpoint

Date: 2026-11-27. Owner approved all ADM-01–ADM-20 items for isolated local synthetic development. This is a **checkpoint, not milestone completion or release acceptance**. Application baseline: EP-10 `c08591f970a4c977c98286f045145bda58a27474`; documentation baseline: `bab49f794fea22a64f62fba6f0f9a2741bf86fec`. The application branch is `bj-ep-11-administration-moderation` at `35ca767a2c978a704e9ee9c1ae04ed6fdb174468` (initial checkpoint `29dac456ca62c9366aa2de544fbf1d88a6357ec8`). See its `docs/checkpoints/BJ-EP-11-{LOCAL,BENCHMARK,MILESTONE}.md` and `BJ-EP-11-EVIDENCE.json` for implementation and test details.

| IDs | Local implementation state | Remaining qualification |
|---|---|---|
| ADM-01–03 | PARTIAL | Dashboard counts, user/company directories, optional employer-verification states and existing membership revocation; complete privileged UI and review flows remain. |
| ADM-04–08 | PARTIAL | Confidential reports, company-visible case status, moderation cases, listing discovery removal, deterministic fraud indicators, reason-coded enforcement, and user/company/listing appeals. Full review/assignment UI and all approved signals remain. |
| ADM-09 | LOCAL FOUNDATION | Recipient-bound single-use transfer, revision protection, ownership history, retirement and owner Jobs closure tested. Disputed ownership recovery remains. |
| ADM-10–14 | PARTIAL / AUDIT FOUNDATION | Seven product roles, MFA/reauthentication boundary, versioned Jobs consent, reviewed local export, legal-hold purge guard and append-oriented metadata audit. Trusted production MFA, full rights/deletion replay and legal retention mapping remain. |
| ADM-15–18 | PARTIAL / AI CONTRACT FOUNDATION | Incident timeline/corrective actions and review target, period-defined operational analytics, deterministic signals, bounded provider-neutral governance interface and limited versioned policy. Regulatory clocks, comprehensive analytics and future AI approval remain. |
| ADM-19–20 | PARTIAL | Existing activation outbox, bounded retries, new local reminder outbox, synthetic governance tests and corrected Meetings fixtures. Production scheduler/monitoring, remote D1/DO, full accessibility and security qualification remain. |

The production Jobs binding remains absent and the existing account identity provides no privileged MFA or recent reauthentication claim. No real-data admin path is enabled, no administrator credential is hardcoded, and no external provider, notification, paid service, cloud resource, deployment or merge was added. The initial single-owner operating model cannot supply independent reviewer coverage.

Local TypeScript and non-deploying Wrangler bundle checks passed. The final application full regression passed **536/536 tests in 24 files**, including the two corrected Meetings fixtures. The synthetic governance file passed 14/14. These checks do not qualify real-data operation or production scheduling.

Next sequence stays **EP-08 → EP-10 → EP-11 → BT-WEB → EP-09 controlled qualification/pilot → EP-12 integrated qualification → EP-13 production release**. BT-WEB needs Jobs navigation and scoped administration entry points; it must preserve the Jobs data boundary. EP-11 is not yet closed, so BT-WEB is not started by this checkpoint. Additional development cash expenditure: ₹0.

## EP-11-COMPLETE continuation acceptance register

Resume commit 35ca767a2c978a704e9ee9c1ae04ed6fdb174468. The preceding register records the previously implemented services. Every component remains open for full local acceptance. The test and release evidence is recorded separately in the local report.

| Component | New evidence at this checkpoint | Remaining local work |
|---|---|---|
| ADM-01 | Scoped dashboard counts, directories, backward case pagination and roles navigation. Auditor router tests. | Link actionable queues to case and recovery workspaces. Test paging, error and keyboard flows. |
| ADM-02 | Searchable account status and enforcement counts. Tested literal wildcard and ordinary API searches. | Case-linked warning, restriction, suspension, reinstatement and guarded Jobs-only closure interfaces. |
| ADM-03 | Company search, evidence submission and reviewer forms. Tested tenant isolation, competing approval, revocation, resubmission and rejection through the Jobs router. | Privileged membership review/revocation and verification expiry coverage, including browser workflows. |
| ADM-04 | Baseline retained. | Case assignment, category, evidence, listing removal/restoration and history in the moderation workspace. |
| ADM-05 | Baseline retained. | Map each approved indicator to synthetic cases. Implement false-positive review and qualification. |
| ADM-06 | Baseline retained. | Candidate, recruiter and company report/status interfaces, assignment, confidential notes, response targets and overdue-case display. |
| ADM-07 | Final available owner protected against suspension. | Complete reason-coded action lifecycle and test overlapping enforcement across discovery, applications, recruiter access and interviews. |
| ADM-08 | Baseline retained. | Independent reviewer assignment, acknowledgement, information requests, resolution, decision history and separation-of-duty tests. |
| ADM-09 | Baseline retained. | Transfer, decline, cancellation, retirement and owner closure interfaces. Restricted disputed/unavailable-owner case handling. |
| ADM-10 | Seven-role permission display, grant/revoke API and UI, write-time authority checks and transactional audit. Synthetic one-time bootstrap, simultaneous suspension and last available owner guards tested. Chrome role workflow at two widths. | Complete end-to-end permission matrix and recovery/error-path qualification. |
| ADM-11 | Baseline retained. | Versioned publication, consent history/withdrawal and privacy request tracking UI. |
| ADM-12 | Baseline retained. | Authenticated reviewed delivery, third-party exclusion, complete deletion propagation and completion evidence. |
| ADM-13 | Baseline retained. | Scoped hold creation/review/release, policy UI, purge protection and deletion replay matrix. |
| ADM-14 | Role mutations batch audit and grant change together. | Restricted audit search/filter UI and complete sensitive-action history coverage. |
| ADM-15 | Baseline retained. | Severity, assignment, containment, recovery, corrective action, configurable escalation and reporting-clock workflows. |
| ADM-16 | Permission-filtered dashboard and analytics. Auditor receives only audit activity from the period endpoint. | Workload and drill-down coverage with privacy-preserving aggregation for all requested activities. |
| ADM-17 | Baseline retained. | Verify authorization, input minimization, bounded results, provenance, human review, fallback and audit references. |
| ADM-18 | Baseline retained. | Effective-dated revision-protected policy UI integrated with atomic quotas. Verify configurable bounds, IST rollover, active limits and validity. |
| ADM-19 | Operations queue requires incident permission. Auditor denial tested. | Authorized recovery and reconciliation with durable retry, interruption/restart and concurrency tests. |
| ADM-20 | Jobs router tests, eight-migration restart coverage and real Chrome role grant/revoke, initial Tab focus and horizontal fit at 375/1280px. | Independent requirement-level review, remaining browser/accessibility workflows and integrated confidentiality, privacy and recovery matrix. |

Production gates include trusted MFA/reauthentication and accountable production bootstrap, independent staffing, jurisdictional review, remote D1 and Durable Objects, dispatch and monitoring, security/capacity/recovery/device qualification, pilot authorization and any future live AI approval.

Local application commit f3902d7f61d141fb17bffb34b22e5b74c5133538 continues directly from the authorized application baseline. TypeScript, dry-run bundling and diff checks passed. Full regression passed 539/539 across 24 files, including 17 governance tests. The focused governance/profile run passed 36/36. Chrome checked role grant and revocation, initial keyboard focus and page width at 375px and 1280px. Application evidence and file inventory are available in the local commit. Additional expenditure was INR 0.

## 2026-11-28 implementation and local acceptance

This register supersedes the earlier local status columns. The earlier entries retain the baseline and previously implemented functionality. Each row names the current application workflow and the local evidence that exercises it. Browser navigation alone establishes reachability. Service tests exercise the database and permission checks. The Chrome fixture drives the Jobs router with synthetic identities.

| Component and approved scope | Implementation and interface | Acceptance evidence | Status |
|---|---|---|---|
| ADM-01 Dashboard and queues | Role-scoped totals, case navigation and overdue queues | Auditor router and dashboard-to-case Chrome navigation | Local workflow verified |
| ADM-02 Account administration | Directory, case-linked decisions, revocation and Jobs-only closure | Fresh-session and owner guards, Chrome warning through closure | Local workflow verified |
| ADM-03 Employer administration | Scoped member removal and employer evidence, review and expiration | Conflicting revisions, cross-company denial, Chrome approval through expiry | Local workflow verified |
| ADM-04 Posting moderation | Investigation, classification, assignments, evidence, removal and restoration | Scoped discovery test and Chrome investigation through resolution | Local workflow verified |
| ADM-05 Fraud review | Seven deterministic indicators, explanation, dismissal and referral | Threshold and deduplication tests with synthetic signals | Local workflow verified |
| ADM-06 Complaint handling | Candidate, recruiter, company and legacy report intake, reporter status and reviewer notes | Legacy company/listing intake and restricted case detail tests | Local workflow verified |
| ADM-07 Enforcement | Time-bounded and overlapping sanctions, reinstatement, listing/application and recruiter guards | Overlapping sanctions, scoped listing removal, owner protection and Chrome warning revocation | Partial acceptance (see below) |
| ADM-08 Appeals | Independent review, clarification, decision history and relief | Separate appellant and reviewer complete an information request and decision in Chrome | Local workflow verified |
| ADM-09 Ownership | Bound transfers, cancellation, refusal, retirement and restricted exceptional review | Concurrent acceptance, expiry, requester and independent recovery reviewer tests | Local workflow verified |
| ADM-10 Administrative roles | Seven role scopes, privileged sessions, revocation and one-time local owner bootstrap | Seven-role boundary tests, simultaneous owner changes and Chrome role changes | Local workflow verified |
| ADM-11 Consent and notices | Versioned notices, consent grant and withdrawal, request status | Chrome notice publication, candidate history and withdrawal | Local workflow verified |
| ADM-12 Export and deletion | Reviewed one-time export and retained deletion requests | Concurrent export and wrong requester tests, Chrome delivery confirmation, held deletion test | Partial acceptance (see below) |
| ADM-13 Retention and holds | Scoped holds, review date, release, configurable retention and restore gate | Retention delay and hold, replay of restored consent and Jobs profile persistence tests | Partial acceptance (see below) |
| ADM-14 Audit history | Filtered and paginated Jobs audit with restricted access | Scope and delivery audit tests, role transaction and forbidden-read tests | Partial acceptance (see below) |
| ADM-15 Incidents | Severity, assignment, escalation and reporting clocks, timeline and corrective actions | Incident service tests and Chrome containment through resolution | Local workflow verified |
| ADM-16 Analytics | Period counts and permission-scoped category drilldowns with small-count suppression | Auditor-scoped period response and Chrome analytics navigation | Local workflow verified |
| ADM-17 AI assistance | Authorized local assistance, bounded inputs and outputs, provenance, human review and fallback | Maliciously structured inputs, invalid provider response and case audit reference tests | Local workflow verified |
| ADM-18 Policies and quotas | Effective-dated policy history with validated defaults and atomic listing quotas | Concurrent posting, replay, IST midnight, active ceiling and validity tests, Chrome policy edit | Local workflow verified |
| ADM-19 Operations | Activation and cancellation backlog, fenced retries and reminder dispatch | Restart with pending lease, concurrent reconciliation and dispatch, stale reminder tests | Partial acceptance (see below) |
| ADM-20 Integrated qualification | TypeScript, local D1, dry bundle, regression and responsive keyboard checks | 24 regression files, 14 migrations and 14 Chrome routes at two widths | Partial acceptance (see below) |

### Outstanding local qualification

- ADM-07 requires one integrated enforcement and expiry matrix across discovery, applications, recruiter access and interview admission. The current checks exercise those boundaries in separate fixtures.
- ADM-12 and ADM-13 require a restored snapshot containing every applicable record category together. The current tests demonstrate consent replay, held deletion, reviewed delivery and application-related cleanup individually.
- ADM-14 requires failure-injection verification for sensitive mutations that record their audit event in a second database operation. Move each such mutation and its success audit into one transaction and test rollback.
- ADM-19 requires a crash test after the meeting adapter succeeds but before Jobs stores the meeting reference, including cancellation or revision change during the interruption. The lease-expiry restart test interrupts before adapter completion.
- ADM-20 remains open until these cases pass. Browser evidence includes initial keyboard focus and horizontal fit at 375 and 1280 pixels. Export completion is verified at the API boundary; Chrome disk download is disabled in the synthetic fixture.

### Release qualification

Production identity and MFA, accountable owner bootstrap, independent support staffing, jurisdiction-specific review, remote persistence, scheduler and monitoring, security and capacity review, device and recovery qualification, pilot authorization and live AI activation require separate decisions. Additional expenditure was INR 0.

Application checkpoint [c22867b](https://github.com/anandbabu1706/billiontalks/commit/c22867b01e7c4e7099a3a362b3a9404f2ddab35a) contains the suite inventory and the local qualification report. The full regression run passed 553/553 tests across 24 files, including 31 governance tests. TypeScript, the dry-run bundle and the synthetic Chrome workflows passed.
