# EP-05 / BJ-V1-001: Professional profiles

Owner-authorized local synthetic implementation, 2026-11-27 (Asia/Calcutta).
Application baseline: `82e2c8c1cc6812931e62a58b459465cb77a6df10` on `bj-ep-04-foundation`.
Requirements/decision baseline: `1c3a49ca5db616d209138c5b75cae369fa7eaccd` on `docs/bj-doc-001`.
Development branch: `bj-ep-05-profiles`. Exact introducing commit is recorded in the documentation-branch tracker; machine-readable tests/inventory are in `BJ-EP-05-EVIDENCE.json`.

## Delivered local workflows

- `/jobs` and `/jobs/profile`: responsive accessible editor, explicit 18+ opt-in, profile completion, validation and save/conflict/error confirmation. Repeated employment, education and certification entries support add/edit/remove with confirmation and focus recovery. Unsaved edits are retained on API failure and warn before leaving. Ordinary account login does not enroll Jobs.
- Candidate display name, headline, summary, city/region, employment, education, skills, certifications, open-to-work and private career preferences. No required DOB, Aadhaar, phone, email, photo or uploads. Optional history is never an eligibility or publication requirement.
- Owner-only `GET/PUT/DELETE /api/jobs/v1/profile`; revision compare-and-swap prevents silent lost updates. A missing profile uses revision 0; existing saves/deletes require the returned revision. IDs/subjects are server-owned, and unknown body fields are rejected.
- Private default; recruiters-only/public visibility plus independent field allowlist and indexing opt-in. Career preferences are never projected. Shared routes `/jobs/profiles/{opaque-id}` and `/api/jobs/v1/profiles/{opaque-id}` load data on the server and exclude application records. JSON API responses always use noindex. Only an explicitly opted-in public HTML projection can use index/follow.
- Recruiters-only reads require an active, non-revoked EP-04 server-side membership and eligible, unrestricted Jobs participant. Client role headers and platform privacy roles do not grant discovery. No recruiter search, membership creation or company verification workflow is supplied here. Membership fixtures are synthetic; this does not claim verified real-world employers.
- Jobs-only closure immediately hides profiles and atomically archives their content into restricted CLOSURE records. The inherited configurable 30-day purge policy, holds/exceptions and deletion-ledger replay apply. Profile-only deletion immediately removes the profile through a deletion-ledger trigger and resets sharing; it does not close Jobs or remove application history. Neither operation touches shared account or Meetings data.

## Schema, security and compatibility

`migrations/jobs/0002_profiles.sql` adds `jobs_profiles` with bounded validated structured JSON, revision, opaque identifier, disclosure fields and privacy settings. Nested arrays are stored atomically with the profile document; later search indexes must be designed against measured queries. Existing Jobs membership/eligibility, retention, exception and ledger tables are reused. No account migration or cross-product foreign key is added. SQL triggers recheck eligibility/restore state and synchronize visibility atomically, even if closure races a save. D1 behavior was verified with the installed local runtime; remote D1 qualification is still required.

Authentication reuses the account-owned adapter and stable subject; database operations are parameterized. Mutation requests require same-origin Origin, no cross-site fetch metadata, JSON and X-Jobs-Request. Streamed bodies are capped at 64 KiB for profiles and 256 bytes for eligibility/deletion. Display names and entry titles/organizations are required when present; lengths, entry counts, valid month ranges, date order and skill duplicates are validated. Sensitive errors are replaced with stable codes; no profile bodies/secret values are logged.

Profile pages use nonce-based script/style CSP, no frame embedding, no referrers, no-store, escaped server rendering and text/value DOM assignments. Privacy choices are opt-in and default to sharing no fields. Once disclosed, external copies cannot be recalled by changing visibility; the UI explains this. Account navigation adds a Jobs link only when Jobs is enabled. The only accepted return destination is the exact `/jobs/profile` value; external URLs, protocol-relative URLs and alternative paths retain `/dashboard`. Existing default dashboard behavior and Meetings route/session/data code remain intact. The shared robots-header exception is restricted to successful, enabled Jobs public-profile responses already carrying explicit indexing consent.

## Run the synthetic environment

Use `npm run jobs:dev -- --enable-jobs`, then visit `http://127.0.0.1:8794/jobs/profile`. Without the flag, Jobs remains disabled. Do not use inherited Wrangler `dev`/`build` commands for this workflow: they refer to historical configuration.

Use the documented public synthetic fixture cookie locally: `bt_account_session=` followed by 43 lowercase `s` characters, path `/`, SameSite=Lax. For example, in developer tools on the local origin only:

```js
document.cookie = 'bt_account_session=' + 's'.repeat(43) + '; Path=/; SameSite=Lax';
location.href = '/jobs/profile';
```

This is a synthetic test credential, not a real account secret. No email or password service is required. Use only invented information. Joining Jobs requires the visible age attestation; signing in alone has no enrollment effect.

EP-05 supersedes EP-04's ephemeral interactive-launcher behavior: the development launcher persists synthetic state under this worktree's ignored `.jobs-synthetic/development/`. Migrations are journaled and applied atomically once, and fixtures are reseeded safely. Tests stay ephemeral unless explicitly checking restart persistence under an isolated test state name. All state names are bounded alphanumeric/hyphen names under `.jobs-synthetic`; arbitrary paths are rejected. Do not run two launchers against the same state directory concurrently. To start clean without deleting an existing fixture, use a separate worktree. No automatic fixture deletion is performed.

The programmatic runtime ignores `.env`, `.dev.vars`, Wrangler files and cloud credentials. Both DBs are synthetic; outbound Worker fetches are denied and telemetry disabled. No Meetings DO, R2, SFU or email bindings are available. No production resources were inspected or changed in EP-05. Dependencies and lockfile were reused unchanged.

## Validation and limitations

Commands: `npm run typecheck`; `npm test -- tests/jobs-profiles.test.ts tests/jobs-foundation.test.ts --reporter=json --outputFile=ep05-jobs-tests.json`; `npm test -- --reporter=json --outputFile=final-tests.json`; `git diff --check`.

The final evidence file records exact final counts and the two inherited Meetings failures. New tests cover CRUD/ownership, cross-request and restart persistence, age denial, public/recruiter/private transitions, field disclosure, independent indexing, CSRF/body limits, XSS/SQL input handling, concurrent edits, deletion/closure/holds/recovery and account redirect boundaries. JSDOM runs the actual editor script against the local Worker/D1 API for repeated-entry saves/reloads, privacy controls, input labeling, conflict preservation and closure. Responsive stylesheet/viewport rules are checked; browser automation host was unavailable, so physical-device visual rendering, zoom, screen-reader and complete keyboard interaction qualification remain pending. Do not treat DOM tests as a visual-device audit.

Production/staging remains default-off and unmodified. No real-data launch, company onboarding, application snapshots, job posting, interviewing, networking, administration UI or payments are implemented. Shared-profile links do not constitute a recruiter directory. Later applications must capture purpose-specific submitted snapshots and use assignment-scoped access rather than current public-profile projection. Future company modules must manage trusted membership creation/revocation and decide when discovery is allowed; existing server membership checks are not an employer-verification claim.

Retention purge is the inherited operator-controlled mechanism, not a new production scheduler. Real-data use still needs separately authorized remote atomicity/isolation/recovery tests, independently preserved deletion ledger, abuse controls, legal/retention operating qualification, age-assurance adequacy, billing/email evidence and resolution of the two known Meetings failures. Browser/device qualification is also outstanding. No repeat architecture/legal/infrastructure assessment was undertaken.

## Rollback and next dependencies

No deployment or merge is authorized. For future rollout, keep Jobs disabled until authorized, qualify additive migration and privacy behavior on isolated staging, and retain a known code version. Disabling Jobs hides its endpoints without changing Meetings. Code rollback cannot reverse profile writes or erase retained data; preserve deletion ledger and review older code's compatibility with new tables/triggers before rollback. Do not blindly drop profile tables or restore deleted content.

Minimum EP-06 dependencies (not started): separate owner authorization and isolated branch from the completed EP-05 commit; reuse stable account subjects and EP-04 company membership/role contracts; implement company ownership, delegated recruiter roles and revocation with tenant tests; connect discovery only to server-authorized memberships. Do not grant company/platform administrators blanket private-profile/application access. Continue synthetic local fixtures; full parent website redesign remains deferred until after EP-11. No additional cloud resources are required for that local work.

Additional cash expenditure: INR 0. No purchases, services, provisioning, deployment, email, permission expansion, merge or real applicant data. Existing operating costs and AI credits are not represented as measured zero.
