# BT-V1-FINAL - BillionTalks V1 Public Operational Release Closure

**V1 CLOSED — PUBLIC OPERATIONAL RELEASE**

This is the canonical V1 release-acceptance summary, production baseline,
known-limitations register, rollback reference, and starting point for future work.
The original public release remains the immutable `v1.0.0` tag. BT-COR-009 is a
post-launch production correction on the release branch; it does not move or replace
that tag.

It does **not** claim full feature acceptance, and it does **not** claim media or
recording qualification. Verified functionality, owner-waived tests, unqualified
production paths, and implementation gaps are distinguished below.

---

## 1. Release identity

| Item | Value |
| --- | --- |
| Closure status | **V1 CLOSED — PUBLIC OPERATIONAL RELEASE** |
| Branch | `bt-v1-009-final-readiness` |
| Original release commit | `21e22544de8ae3d406577470acd1c3b79c8651e4` |
| Original annotated release tag | `v1.0.0` (immutable; peels to the original release commit) |
| Post-launch correction | BT-COR-009 at `f1598112f380410a3cd7b76edff9264e7bf0d81b` |
| Production Worker | `billiontalks-realtime-backend` |
| Active production version | `78e60991-c644-484d-8e1b-711748080da9` |
| Traffic allocation | 100% |
| Canonical public URL | `https://billiontalks.com` |
| Custom domains | `billiontalks.com` and `www.billiontalks.com` |
| Compatibility date | `2025-07-18` |

The original tag continues to point to `21e22544de8ae3d406577470acd1c3b79c8651e4`;
do not move or recreate it. The post-launch BT-COR-009 source commit remains
`f1598112f380410a3cd7b76edff9264e7bf0d81b`.

---

## 2. Production baseline (verified on the active version)

| Binding | Resource |
| --- | --- |
| `ACCOUNT_DB` | D1 `0c0c10f2-437e-459e-86fb-360d7e2a36b5` |
| `MEETING_STORE` | Durable Object `MeetingStateDurableObject` |
| `RECORDINGS_BUCKET` | R2 `billiontalks-recordings` |
| `ACCOUNT_EMAIL_FROM` | `BillionTalks <no-reply@mail.billiontalks.com>` |
| `ACCOUNT_PUBLIC_ORIGIN` | `https://billiontalks.com/` |
| `LIMITED_RELEASE_MEDIA_DISABLED` | `false` (media enabled) |
| `RESEND_API_KEY` | secret (present, not exposed) |
| `REALTIME_SFU_APP_ID` | secret (present, not exposed) |
| `REALTIME_SFU_BEARER_TOKEN` | secret (present, not exposed) |

The apex and `www` custom domains are attached to the production Worker. HTTPS
certificates and canonical redirects were verified after the BT-COR-009 promotion.
The checked-in Wrangler file does not declare those remotely managed custom-domain
triggers; version promotion did not sync or alter trigger settings.

No secret values were read, logged, rotated, or exposed during this release.

### Database migrations

All **8** migrations are applied in production. `wrangler d1 migrations list --remote`
reports `No migrations to apply!`. No migration was rerun during launch closure.

---

## 3. V0-to-V1 continuity and release history

| Version | Commit | Outcome |
| --- | --- | --- |
| V0 sign-off | `2471d8f6` | V0 physical meeting/media qualification baseline |
| `15e3fe8f` | `52b0aeb` | BT-V1-009 production release |
| `91f312bb` | `9b597d7` | Navigation release |
| `12600650` | `6a7242f` | Account navigation + password-recovery release |
| `be43059c` | `21e2254` | Registration configuration correction (code) |
| `8d93bb0e` | `21e2254` | Resend secret rebind; registration restored; rollback baseline immediately before BT-COR-009 |
| `78e60991` | `f159811` | **Current.** BT-COR-009 scheduled-meeting start correction; 100% production |

V1 retains the existing V0 live-meeting and Durable Object implementation. It adds
account-backed scheduling, calendar, contacts/invitations, and workspace workflows
without replacing the live-room implementation. V0 media qualification is historical
continuity evidence only; it is not a V1 physical-media qualification.

### The registration incident (resolved)

Production registration returned `503 "Account registration is temporarily unavailable."`
and sign-in returned a generic `401`.

- **Root cause 1 (code/config):** `wrangler.jsonc` did not declare `ACCOUNT_EMAIL_FROM`
  or `ACCOUNT_PUBLIC_ORIGIN`. `createAccountEmailSender(env)` therefore returned `null`,
  and the registration dependency gate rejected every request before body validation.
  Fixed in `21e2254`.
- **Root cause 2 (platform):** the `RESEND_API_KEY` binding was listed in version
  metadata while its runtime value was unusable. Binding presence does **not** prove a
  usable secret. Resolved by the owner re-saving the existing key — no rotation — which
  produced version `8d93bb0e`.
- **Sign-in was never defective.** Production D1 held zero accounts, so the generic
  `401` was the intended enumeration-safe response.

---

## 4. Automated validation

| Check | Result |
| --- | --- |
| Focused test suite | **65 passed** |
| `npm run typecheck` | passed |
| Wrangler dry-run build | passed |
| `git diff --check` | passed |
| V0 baseline suite | 276 passed (at V0 sign-off) |

A regression test now asserts that the production configuration can construct the
account email sender, so the registration outage cannot silently recur.

The reported 131 failures in `tests/browser-ui.test.ts` were reproduced against the
previous production code commit `21e2254` with the same result. They predate BT-COR-009
and were not fixed as unrelated failures. The correction's focused tests and staging
qualification had already passed; this closure did not rerun completed suites.

---

## 5. Original production launch smoke checks

These launch checks were performed against live `https://billiontalks.com` and are
non-destructive. Later BT-COR-009 production checks are recorded separately in
section 6.

| Check | Result |
| --- | --- |
| `/account`, `/dashboard`, `/schedule`, `/calendar`, `/contacts`, `/notifications`, `/ui` | 200 |
| `/` (apex root) | 302 → `/account` |
| HTTP → HTTPS apex redirect | 301, path + query preserved |
| `www` → apex redirect | 308, path + query preserved |
| Registration dependency probe (`POST /api/accounts/register` with `{}`) | **400** (healthy; not 503) |
| `/api/accounts/me`, `/api/schedules`, `/api/invitations`, `/api/contacts`, `/api/recordings`, `/api/notifications`, `/api/meetings/history` | 401 unauthenticated |
| Password recovery, unknown emails | identical neutral `202`, no enumeration, no token exposure |
| Public Account navigation (rendered) | only **Sign in** and **Create account** |
| Account branding | BillionTalks logo and approved copy present |

### Production data state (read-only aggregates)

1 account, active and email-verified; 1 consumed verification token; 8 migrations.
Those counts describe the earlier launch snapshot, not current totals. Later
BT-COR-009 production verification used disposable host-owned schedules and rooms.
Those schedules are now terminal (`CANCELLED` or `ENDED`), their rooms were ended,
and the terminal test records were preserved. No customer meeting was created,
modified, or deleted during the verification.

---

## 6. Verified capabilities and BT-COR-009 acceptance

Verified end-to-end against live production with an authorized account:

- Registration, including real Resend email delivery.
- Email verification link completion.
- Sign-in and authenticated Dashboard access.
- Session persistence across reload.
- Authenticated redirects from Sign in and Registration to Dashboard.
- Logout and session revocation; protected routes return to Sign in afterwards.
- Profile, Settings, and Notifications reachable while authenticated.
- Unauthenticated Profile/Settings/Notifications expose no private account data.
- Password recovery returns a neutral response and never reveals account existence.
- Keyboard accessibility and desktop/mobile responsiveness at 1440, 768, 390, 320 px.
- HTTPS, canonical apex routing, and `www` redirects preserving path and query.

BT-COR-009 was deployed after the original V1 launch and verified against a
disposable production schedule:

- Authenticated Dashboard and Calendar each exposed a Start meeting action for an
  eligible owned scheduled meeting.
- Starting from those surfaces opened the live room with the scheduled meeting ID.
- The host identity and `HOST` role matched the authenticated account; repeated Start
  returned the same room (`200`, `STARTED`).
- A separate cookie-isolated guest session received `WAITING` for host approval. Host
  approval admitted it to the same room as `PARTICIPANT`, not host.
- A cancelled schedule could not be started (`409`); test rooms were ended.
- Production API protections, the registration dependency validation response,
  production bindings, 100% traffic assignment, and domain redirects were checked
  after activation.

The same start, identity, retry, cancellation, and host-approval lifecycle was
previously exercised on staging. Production verification used disposable test data
only and did not modify customer meetings.

### Route reference

Scheduler is `/schedule`. Invitations are surfaced under `/contacts`. Profile is
`/account#profile` and Settings is `/account#preferences`. These are the intended
routes; `/scheduler`, `/invitations`, `/settings`, and `/profile` are not defects.

---

## 7. Owner-waived and unqualified tests

The owner explicitly waived the desktop-host / mobile-guest physical media test for
this V1 launch. The following are therefore recorded as **NOT TESTED at V1**. They are
**not** media passes and **not** confirmed defects.

- Bidirectional audio and video between a desktop host and a mobile guest.
- Participant admission and visibility under live multi-device conditions.
- Screen sharing and host controls under live conditions.
- Reconnection and rejoin after an intentional disconnect.
- Recording consent, start/stop, persistence, and retrieval as a complete live
  production journey.
- Production invitation email delivery and acceptance of a delivered RSVP link.

For context, the equivalent media journeys were qualified during **V0 sign-off**
(commit `2471d8f6`, version `665dd2ba`), including two-way audio/video, mute/unmute,
camera toggle, screen sharing, leave/rejoin recovery, and recording start/stop/storage.
V1 did not re-run that physical qualification. BT-COR-009 production media remained
"Media not connected"; no audio/video qualification is claimed.

---

## 8. Known limitations

- **Media is not physically re-qualified for V1.** The owner-waived desktop-host /
  mobile-guest bidirectional media test and live multi-device media scenarios remain
  unqualified. This is not a claim that media passed or failed.
- **Recording persistence and playback are not fully qualified in V1.** Recording
  controls, consent, multipart upload/finalization, metadata, and an authorized
  recording listing exist. The complete production recording-persistence journey was
  not verified. Stored-recording R2 retrieval/streaming and playback UI are an
  implementation gap; recording controls remain enabled, while the UI accurately
  describes recordings as available "In meetings".
- **Production invitation acceptance is unqualified.** Invitation and RSVP
  functionality exists, but production delivery and acceptance of a real delivered
  invitation link were not verified. BT-COR-009 did verify the same meeting ID and
  host-approval admission using its existing link/API path on staging and guest
  admission in production.
- Meeting search is not implemented and is labelled "Coming soon".
- Transcripts, AI summaries, subscriptions, billing, and entitlements remain deferred
  beyond V1; entitlement records are informational only and do not gate features.
- The baseline-matched 131 failures in `tests/browser-ui.test.ts` remain a test-suite
  limitation outside BT-COR-009; they were not fixed as unrelated pre-existing work.

---

## 9. Rollback readiness

| Item | Value |
| --- | --- |
| Current production version | `78e60991-c644-484d-8e1b-711748080da9` (100%) |
| Immediate known-good rollback | `8d93bb0e-d4d0-45df-b90b-ff3d004ee7fa` |
| Earlier release checkpoint | `12600650-8f53-4248-a2ae-003a7f3ac849` |
| Procedure | `wrangler versions deploy '<version-id>@100%' --yes` |

The immediate rollback version is the healthy, registration-corrected production
version that was active immediately before BT-COR-009. A dry-run 100% promotion of
`8d93bb0e-d4d0-45df-b90b-ff3d004ee7fa` succeeded. Do not use the earlier
`12600650` checkpoint as the routine rollback: it predates the registration
correction and reintroduces the registration outage. `be43059c` also is not a safe
rollback target because it was served while the Resend secret was unusable.

Rollback must not be used merely because an optional or waived test is pending. A
rollback restores Worker code/version, not storage state or customer data.

---

## 10. Acceptance decision

No confirmed critical security, data-integrity, or release-blocking defect remains.
The deployed V1 release is operational on the public domains, the critical
authentication journey has been verified against live production, and BT-COR-009
scheduled start is deployed and production-verified.

**Decision: V1 CLOSED — PUBLIC OPERATIONAL RELEASE.**

Scope of this decision:

- **Accepted:** the original `v1.0.0` public release remains immutable; production
  operates on the post-launch BT-COR-009 correction.
- **Accepted:** the demonstrated V1 account, workspace, and scheduled-meeting start
  journeys operate in production.
- **Not claimed:** full feature acceptance.
- **Not claimed:** V1 physical bidirectional-media qualification, complete recording
  persistence/playback qualification, or production RSVP-email acceptance.

### Future improvement backlog (not part of V1 closure)

Retain **BT-COR-001 through BT-COR-008** as future improvement backlog; none is
closed or absorbed into this release record. The public marketing website remains an
explicit future item. Detailed ticket scope and ordering remain with the backlog
source; this closure does not invent ticket descriptions or acceptance criteria.

The following are known deferred work and qualification limits, not by themselves
release blockers: stored-recording retrieval/playback, production RSVP-email
acceptance, V1 physical media re-qualification, meeting search, transcripts, AI
summaries, subscriptions, billing, and entitlement enforcement.

### V2 and future product vision

V2 and later product direction remain documented separately in
`docs/architecture/BT-V0-ARCHITECTURE-BLUEPRINT.md`. This V1 closure neither
redefines that vision nor brings future features into V1 scope. The first future
development task should be selected from the retained BT-COR-001 through BT-COR-008
backlog, with the public marketing website preserved as future work.
