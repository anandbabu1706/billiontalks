# EP-05 / BJ-V1-001 milestone completion

Review date: 2026-11-27, Asia/Calcutta. Scope: authorized local synthetic professional-profile implementation, testing, commit and development-branch push only.

Development branch: [bj-ep-05-profiles](https://github.com/anandbabu1706/billiontalks/tree/bj-ep-05-profiles).
Verified final application commit: [f5e671faf48678c231b5a7e98f00d11be9ac3823](https://github.com/anandbabu1706/billiontalks/commit/f5e671faf48678c231b5a7e98f00d11be9ac3823).
Application parent: `82e2c8c1cc6812931e62a58b459465cb77a6df10`.
Approved documentation baseline: `1c3a49ca5db616d209138c5b75cae369fa7eaccd`.

The GitHub branch reference was independently read after push and matched this full SHA. The commit's 15-file inventory was compared with the committed evidence and matched exactly. Documentation closeout is this report's introducing commit on docs/bj-doc-001; it changes only this report, BJ-TRACK-001-ACTION-TRACKER.md and BJ-ROADMAP.md. No decision-register history was changed.

## Completed functionality

Candidate-owned create/read/edit/delete, database persistence across requests and local runtime restarts, revision conflict protection, completion indication and responsive forms for display identity, headline, summary, location, employment, education, skills, certifications and private career preferences. Repeated entries have bounded validation and safe add/edit/remove controls. Saved data and errors are handled without injecting HTML.

Profiles start private with no shared fields. Recruiters-only/public disclosure is separately selected; field allowlists exclude career preferences and application records. Search indexing requires additional public-profile opt-in. Recruiter access checks server-owned active membership, current eligibility and revocation; no client-supplied role grants access. Existing 18+ attestation remains explicit and sticky; normal account login does not enroll Jobs. No DOB/Aadhaar collection.

Owner identity, CSRF/body limits, no-store, escaped output/CSP, parameterized SQL and privacy-safe errors are enforced. Closure immediately hides the profile and feeds the inherited 30-day restricted closure-retention/hold/purge flow. Profile deletion and recovery use deletion-ledger triggers. Shared accounts and Meetings remain untouched. Minimal account navigation is feature-controlled, and only the exact Jobs profile return destination is accepted; ordinary login retains /dashboard.

See the pinned [implementation/runbook](https://github.com/anandbabu1706/billiontalks/blob/f5e671faf48678c231b5a7e98f00d11be9ac3823/docs/checkpoints/BJ-EP-05-LOCAL.md) and [machine-readable evidence](https://github.com/anandbabu1706/billiontalks/blob/f5e671faf48678c231b5a7e98f00d11be9ac3823/docs/checkpoints/BJ-EP-05-EVIDENCE.json).

## Validation and defects

- `npm run typecheck`: PASS.
- `npm test -- tests/jobs-profiles.test.ts tests/jobs-foundation.test.ts --reporter=json --outputFile=ep05-jobs-tests.json`: focused intermediate run passed 47/47; two additional persistence/conflict tests were subsequently included in the final full run.
- `npm test -- --reporter=json --outputFile=final-tests.json`: 476 total, 474 passed, 2 failed, 0 skipped. All 19 new profile tests and 30 inherited Jobs foundation tests passed.
- `git diff --check`: PASS; commit inventory comparison PASS.
- The two failures exactly match EP-04's file/name set: camera ON/OFF/ON preview in browser-ui.test.ts; calendar month/week/day schedule rendering in calendar-v1-004.test.ts. No new existing-suite failures. Tests were not altered to hide these defects.
- An introduced account markup regression and the public-profile indexing header interaction were corrected before the final run. No known unresolved new automated-test defect.

JSDOM exercises the real profile script against synthetic Worker/D1 APIs for saves, repeated entries, reloads, stale-edit recovery, closure and privacy controls; labeling and responsive stylesheet rules are checked. Browser automation host was unavailable. Physical-device visual rendering, zoom, complete keyboard and screen-reader qualification are pending, not represented as completed tests. The local verification server was stopped after testing.

## Changed application files (15)

1. `.gitignore`
2. `package.json`
3. `scripts/jobs-dev.mjs`
4. `scripts/jobs-runtime.d.mts`
5. `scripts/jobs-runtime.mjs`
6. `src/account/ui.ts`
7. `src/index.ts`
8. `src/jobs/api.ts`
9. `src/jobs/privacy.ts`
10. `migrations/jobs/0002_profiles.sql`
11. `src/jobs/profile-ui.ts`
12. `src/jobs/profiles.ts`
13. `tests/jobs-profiles.test.ts`
14. `docs/checkpoints/BJ-EP-05-LOCAL.md`
15. `docs/checkpoints/BJ-EP-05-EVIDENCE.json`

Dependencies/lockfile and existing Meetings tests were not changed. The development launcher now keeps synthetic data under ignored worktree-local `.jobs-synthetic/development`; test fixtures default to ephemeral storage. This supersedes only the earlier EP-04 launcher instructions, not its historical evidence. Outbound Worker fetches remain blocked; no cloud bindings or real credentials are loaded.

## Pending qualification and minimum EP-06 dependencies

EP-05 local scope is complete. Shared staging/production and real applicant data are not authorized or qualified. Remote D1 behavior/isolation, operational purge scheduling and independent deletion-ledger preservation, restoration, abuse controls, age/legal/retention adequacy, billing/email evidence and the two Meetings defects remain release gates. No repeated infrastructure/legal assessment was performed.

Recruiter discovery UI/search, company onboarding/verification and membership administration are not implemented. Direct recruiters-only views rely on trusted server membership records; current fixtures prove technical authorization, not real-world employer verification. Later applications must capture purpose-specific submitted snapshots and enforce assigned-listing access independently of live profile visibility. No application or interview functionality was added.

EP-06 requires separate authorization and an isolated branch from the completed EP-05 commit, company ownership/membership/delegation/revocation workflows using stable subjects, and tenant/permission regression tests. Connect discovery only to trusted memberships; platform/company administration must not bypass private profile or application access. Local synthetic continuation requires no new cloud resources. Full parent redesign remains deferred until after EP-11, except essential Jobs navigation.

No merge, deployment, provisioning, email, purchase, permission expansion or real-data access occurred. Additional cash expenditure: INR 0; existing operating costs and AI-credit usage were not measured. Stop after EP-05; EP-06 has not started.
