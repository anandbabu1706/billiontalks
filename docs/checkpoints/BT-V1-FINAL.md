# BT-V1-FINAL - BillionTalks V1 Public Launch Closure

**PUBLIC V1 LAUNCH COMPLETE**

This document closes the BillionTalks V1 launch. It records the released artifact, the
evidence supporting the release, the tests the owner explicitly waived, and the
limitations that remain open beyond launch.

It does **not** claim full feature acceptance, and it does **not** claim media or
recording qualification. Those are tracked below as untested exceptions and known gaps.

---

## 1. Release identity

| Item | Value |
| --- | --- |
| Branch | `bt-v1-009-final-readiness` |
| Release commit | `21e22544de8ae3d406577470acd1c3b79c8651e4` |
| Release tag | `v1.0.0` |
| Production Worker | `billiontalks-realtime-backend` |
| Active production version | `8d93bb0e-d4d0-45df-b90b-ff3d004ee7fa` |
| Traffic allocation | 100% |
| Canonical public URL | `https://billiontalks.com` |
| Compatibility date | `2025-07-18` |

Local `HEAD` and `origin/bt-v1-009-final-readiness` were independently confirmed to
match the release commit at closure time.

---

## 2. Production bindings (verified present on the active version)

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

No secret values were read, logged, rotated, or exposed during this release.

### Database migrations

All **8** migrations are applied in production. `wrangler d1 migrations list --remote`
reports `No migrations to apply!`. No migration was rerun during launch closure.

---

## 3. Release history leading to V1

| Version | Commit | Outcome |
| --- | --- | --- |
| `15e3fe8f` | `52b0aeb` | BT-V1-009 production release |
| `91f312bb` | `9b597d7` | Navigation release |
| `12600650` | `6a7242f` | Account navigation + password-recovery release |
| `be43059c` | `21e2254` | Registration configuration correction (code) |
| `8d93bb0e` | `21e2254` | **Current.** Resend secret rebind; registration restored |

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

---

## 5. Production smoke checks at closure

All checks below were performed against live `https://billiontalks.com` and are
non-destructive.

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
Scheduled meetings, invitations, and contacts are all **0** — no temporary test data
remains in production. No customer record was created, modified, or deleted.

---

## 6. Verified capabilities

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

### Route reference

Scheduler is `/schedule`. Invitations are surfaced under `/contacts`. Profile is
`/account#profile` and Settings is `/account#preferences`. These are the intended
routes; `/scheduler`, `/invitations`, `/settings`, and `/profile` are not defects.

---

## 7. Owner-waived tests (untested acceptance exceptions)

The owner explicitly waived the desktop-host / mobile-guest physical media test for
this V1 launch. The following are therefore recorded as **NOT TESTED at V1**. They are
**not** media passes and **not** confirmed defects.

- Bidirectional audio and video between a desktop host and a mobile guest.
- Participant admission and visibility under live multi-device conditions.
- Screen sharing and host controls under live conditions.
- Reconnection and rejoin after an intentional disconnect.
- Recording consent, start/stop, persistence, and retrieval under live conditions.
- Meeting invitation email delivery and RSVP acceptance flow.

For context, the equivalent media journeys were qualified during **V0 sign-off**
(commit `2471d8f6`, version `665dd2ba`), including two-way audio/video, mute/unmute,
camera toggle, screen sharing, leave/rejoin recovery, and recording start/stop/storage.
V1 did not re-run that physical qualification.

---

## 8. Known limitations

- **Stored-recording playback is an implementation gap.** Recording consent, start,
  stop, multipart upload, finalize, and the `/api/recordings` listing exist. There is
  **no R2 object retrieval or streaming endpoint and no stored-recording playback UI.**
  Existing recording capability is intentionally left enabled. The UI advertises
  Recordings as "In meetings", which accurately reflects what is supported; no
  public-facing copy promises stored playback.
- Meeting search is not implemented and is labelled "Coming soon".
- Invitation email delivery and RSVP are implemented but not delivery-verified in
  production.
- Transcripts, AI summaries, subscriptions, billing, and entitlements remain deferred
  beyond V1.

---

## 9. Rollback readiness

| Item | Value |
| --- | --- |
| Current version | `8d93bb0e-d4d0-45df-b90b-ff3d004ee7fa` |
| Rollback checkpoint | `12600650-8f53-4248-a2ae-003a7f3ac849` |
| Procedure | `wrangler versions deploy '<version-id>@100%' --yes` |

**Caution:** `12600650` predates the registration correction. Rolling back to it
restores the Account navigation release but **reintroduces the registration outage**.
It should be used only for a confirmed regression that is more severe than losing
registration. Version `be43059c` carries the corrected code but was served while the
Resend secret was unusable, so it is not a safe rollback target either.

Rollback must not be used merely because an optional or waived test is pending.

---

## 10. Launch decision

No confirmed critical security, data-integrity, or release-blocking defect remains.
The deployed release is operational on the public domain, and the critical
authentication journey — register, verify, sign in, stay signed in, sign out — has been
genuinely verified against live production.

**Decision: PUBLIC V1 LAUNCH COMPLETE.**

Scope of this decision:

- **Accepted:** the V1 public release is live and operational.
- **Not claimed:** full feature acceptance.
- **Not claimed:** media and recording qualification at V1.

### Deferred beyond launch

1. Stored-recording retrieval endpoint and playback UI.
2. Production verification of invitation email delivery and RSVP.
3. Physical desktop-host / mobile-guest media re-qualification at V1.
4. Meeting search.
5. Transcripts, AI summaries, subscriptions, billing, and entitlements.
