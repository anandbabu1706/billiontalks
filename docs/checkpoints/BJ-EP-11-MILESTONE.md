# EP-11 / BJ-V1-007 administration checkpoint

## EP-11-A through EP-11-E local acceptance

The final review on 2026-11-28 covers local synthetic Jobs workflows. Earlier registers below preserve the starting implementation and the intermediate findings. The API and browser workspaces use the same Jobs permission and persistence boundaries. The local regression suite and the separately executed Chrome harness provide different evidence, identified below.

| ID and approved requirement | Implemented workflow | API or UI surface | Acceptance evidence | Local result | Release dependency |
|---|---|---|---|---|---|
| ADM-01 Dashboard and queues | Role-scoped totals, case navigation and overdue queues | Dashboard, case queue | Auditor router and dashboard-to-case Chrome navigation | Accepted locally | Production MFA and owner bootstrap |
| ADM-02 Account administration | Directory, case-linked decisions, revocation and Jobs-only closure | User directory and account decisions | Fresh-session and owner guards, Chrome warning through closure | Accepted locally | Trusted reauthentication and operator staffing |
| ADM-03 Employer administration | Scoped member removal and employer evidence, review and expiration | Company directory, membership and verification forms | Conflicting revisions, cross-company denial, Chrome approval through expiry | Accepted locally | Independent business evidence review |
| ADM-04 Posting moderation | Investigation, classification, assignments, evidence, removal and restoration | Case investigation and listing decision form | Scoped discovery test and Chrome investigation through resolution | Accepted locally | Moderation staffing and policy approval |
| ADM-05 Fraud review | Seven deterministic indicators, explanation, dismissal and referral | Signal scan and reviewer queue | Threshold and deduplication tests with synthetic signals | Accepted locally | Signal calibration on authorized pilot data |
| ADM-06 Complaint handling | Candidate, recruiter, company and legacy report intake, reporter status and reviewer notes | Report form, reporter history and company case status | Chrome complaint submission, report-cap concurrency, legacy intake and restricted case details | Accepted locally | Support coverage and response policy |
| ADM-07 Enforcement | Time-bounded and overlapping sanctions, reinstatement, listing/application and recruiter guards | Account and listing decisions, discovery, applications and admission | Integrated temporary suspension and expiry across discovery, submission, recruiter search and interview admission. Separate overlapping and listing action checks | Accepted locally | Production privileged identity and review |
| ADM-08 Appeals | Independent review, clarification, decision history and relief | Appellant and independent reviewer workspaces | Separate appellant and reviewer complete an information request and decision in Chrome | Accepted locally | Independent reviewer staffing |
| ADM-09 Ownership | Bound transfers, cancellation, refusal, retirement and restricted exceptional review | Ownership and ownership recovery | Chrome recipient-bound transfer and retirement, concurrent acceptance, expiry, cancellation, refusal and independent recovery cases | Accepted locally | Accountable recovery reviewer and verification policy |
| ADM-10 Administrative roles | Seven role scopes, privileged sessions, revocation and one-time local owner bootstrap | Role manager and server grants | Seven-role boundary tests, simultaneous owner changes and Chrome role changes | Accepted locally | Trusted identity and accountable production bootstrap |
| ADM-11 Consent and notices | Versioned notices, consent grant and withdrawal, request status | Privacy notice, consent and history | Chrome notice publication, candidate history and withdrawal | Accepted locally | Approved jurisdiction-specific notice |
| ADM-12 Export and deletion | Reviewed one-time export and retained deletion requests | Privacy requests and reviewed export delivery | Concurrent and wrong-requester export tests, Chrome delivery confirmation, multi-category restored snapshot | Accepted locally | Production delivery and legal review |
| ADM-13 Retention and holds | Scoped holds, review date, release, configurable retention and restore gate | Privacy hold review, release and purge | Retention delay, hold review conflict, release, restored consent, profile, application, interview, notifications, case evidence and grants | Accepted locally | Legal retention schedule and backup qualification |
| ADM-14 Audit history | Filtered and paginated Jobs audit with restricted access | Administrative audit search | Audit filtering, denied reads and forced audit failure with incident, hold and notice rollback | Accepted locally | Production audit retention and integrity assessment |
| ADM-15 Incidents | Severity, assignment, escalation and reporting clocks, timeline and corrective actions | Incident queue, timeline and corrective actions | Incident service tests and Chrome containment through resolution | Accepted locally | Incident staffing and jurisdiction-specific clocks |
| ADM-16 Analytics | Period counts and permission-scoped category drilldowns with small-count suppression | Operational analytics and category drilldowns | Permission-scoped counts and drilldowns, suppressed categories and period validation | Accepted locally | Authorized pilot data and operational monitoring |
| ADM-17 AI assistance | Authorized local assistance, bounded inputs and outputs, provenance, human review and fallback | Case assistance and signal review | Maliciously structured inputs, invalid provider response and case audit reference tests | Accepted locally | Live provider authorization and evaluation |
| ADM-18 Policies and quotas | Effective-dated policy history with validated defaults and atomic listing quotas | Policy editor and listing quota commands | Concurrent posting, replay, IST midnight, active ceiling and validity tests, Chrome policy edit | Accepted locally | Production configuration governance |
| ADM-19 Operations | Activation and cancellation backlog, fenced retries and reminder dispatch | Operations queue, retry, reconcile and reminder dispatch | Persisted restart and concurrent dispatch, lost successful activation response followed by cancellation, restart and revocation | Accepted locally | Production scheduler, alerting and recovery qualification |
| ADM-20 Integrated qualification | TypeScript, local D1, dry bundle, regression and responsive keyboard checks | Jobs API, administration pages, emulator and Chrome harness | Full suite, 54 focused tests, fourteen migrations, dry bundle, local Chrome at two widths | Accepted locally | Production security, capacity, device, accessibility and pilot qualification |

The browser harness exercises real form submissions through the Jobs router with injected synthetic identity claims. It also checks initial Tab focus and horizontal fit on 14 routes at 375 and 1280 pixels. Reviewed export completion is verified through the HTTP response and database record. Chrome disk downloads are disabled in the fixture. Production authentication, legal approval, screen-reader and physical-device qualification, remote D1 and Meetings recovery, operations staffing, live AI and pilot authorization remain separate release gates.

## Historical checkpoints

EP-11 has a substantial **local synthetic foundation, not full milestone completion or release approval**. The approved ADM-01–ADM-20 scope remains tracked. Existing identity cannot prove privileged MFA or recent reauthentication, so the trusted test claims are deliberately absent from production identity resolution. No administrative credential or bypass was introduced.

| ID | Local status | Evidence and remaining work |
|---|---|---|
| ADM-01 | PARTIAL | Responsive count/case workspace and recorded-event dashboard; real administrator access gated by MFA. |
| ADM-02 | PARTIAL | Product-scoped user search, restrictions and Jobs closure foundations; no complete account-management UI or shared-account powers. |
| ADM-03 | PARTIAL | Company directory, membership revocation and optional verification states; review UI and evidence operations remain. |
| ADM-04 | PARTIAL | Reporting/case flow and listing discovery removal; full policy categorization and restoration UI remain. |
| ADM-05 | PARTIAL | Deterministic fee, misleading-claim, frequency, duplicate, complaint, recruiter-volume and interview-volume signals; validation and further evaluation remain. |
| ADM-06 | PARTIAL | Confidential reporter case IDs, queue, status and notes; company-visible public status exists, while assignment workflow and targets remain. |
| ADM-07 | PARTIAL | Reason-coded actions, active/expiring restrictions and sensitive-path checks; complete action transitions and UI remain. |
| ADM-08 | PARTIAL | User, company and owned-listing appeals, resolution and restriction revocation; independent review coverage remains. |
| ADM-09 | LOCAL FOUNDATION | Single-use, expiring recipient acceptance, atomic transfer, history and controlled retirement tested; exceptional recovery review remains. |
| ADM-10 | PARTIAL | Seven product-scoped roles, denial and revocation; real MFA integration, bootstrap and full role workflow remain. |
| ADM-11 | PARTIAL | Jobs-only versioned notices and optional consent events; complete rights UI and policy publication remain. |
| ADM-12 | PARTIAL | Reviewed local requester-scoped export and Jobs closure; full request delivery and deletion propagation remain. |
| ADM-13 | PARTIAL | Legal-hold records and purge guard, configurable retention and evidence redaction; legal mapping and restore matrix remain. |
| ADM-14 | LOCAL FOUNDATION | Append-oriented, scoped audit with paged reads and metadata minimization; external integrity/retention qualification remains. |
| ADM-15 | PARTIAL | Incident states, timeline, corrective actions and configurable review target; regulatory clock qualification remains. |
| ADM-16 | PARTIAL | Period-defined operational counts with small-count suppression; workload/drill-down qualification remains. |
| ADM-17 | LOCAL FOUNDATION | Bounded provider-neutral governance purposes and human-review fallback; no live AI. |
| ADM-18 | PARTIAL | Versioned bounded moderation/retention settings; quota policy remains fixed in atomic enforcement. |
| ADM-19 | PARTIAL | Existing activation outbox plus bounded retry and local durable reminder outbox; production dispatcher/monitoring remain. |
| ADM-20 | PARTIAL | Synthetic authorization, transfer, fraud, privacy, outbox and regression tests; real-browser accessibility, remote persistence and release security qualification remain. |

The next approved sequence remains **EP-08 → EP-10 → EP-11 → BT-WEB → EP-09 controlled qualification/pilot → EP-12 integrated qualification → EP-13 production release**. This checkpoint does not authorize the next stage. BT-WEB must make Jobs navigation and administration entry points discoverable without weakening product isolation. Before a pilot: trusted MFA/reauthentication, accountable owner bootstrap and support coverage, complete administrative flows, legal retention/incident clocks, remote D1 and Meetings recovery, scheduler/monitoring, security testing and manual accessibility remain mandatory. Additional development cash expenditure: ₹0.

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
