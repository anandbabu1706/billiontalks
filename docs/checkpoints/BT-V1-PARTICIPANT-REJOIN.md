# BT-V1 participant rejoin and reconnection

## Baseline and release boundary

- Fix branch: `bt-v1-participant-rejoin-reconnection`.
- Remote refs refreshed before branching from `490f03c16dc7dc135978a8ce99d075b6fa83f136`
  on `bt-growth-001-website-social`, not `main`.
- Production was independently verified at 100% on
  `d9102cb2-fbf3-479e-b816-08c38d50e782`, deployed from
  `6c7febff118552231b1384f0c05e9add348886f6`. The branch's subsequent commit
  records that release without changing application source.
- Production deployment is not authorized. Website assets/layout, infrastructure
  configuration, migrations, account authentication and SFU credentials are unchanged.

## Root causes and traced behavior

### Temporary interruption

Identity is not a client-generated display name or the frontend's placeholder user
ID. The server uses the HttpOnly `bt_session_v0` cookie, persisted in the session
Durable Object for seven days; authenticated account identity takes precedence.
Meeting participants and admission requests are independently persisted in their
meeting Durable Object, with revision-checked writes. Backgrounding does not
explicitly leave a meeting or revoke approval.

The frontend already had split publisher/subscriber recovery and capture/RTP checks,
but recovery/startup elapsed budgets included suspended/offline time. Requests and
retries could consume their shared episode while recovery was impossible, then
remain terminal on foreground. `pagehide` was not recorded. A long foreground
check could also rebuild an unused subscriber without remote tracks. Stabilization
required both peers, even when no subscriber existed, and was not scheduled after
successful recovery whose connection events were suppressed during recovery.

Reopening the original URL resolved the meeting but unconditionally cleared the
frontend's user ID, admission state and name. The server retained identity/approval,
but the frontend could not resume an already joined participant or waiting request.

### Host removal

Removal deliberately persists `REMOVED`, records `leftAt`, revokes admission to
`REJECTED`, and cleans up media. Both join and admission correctly reject that
identity across all access modes and Durable Object restarts. No host operation
existed to reverse the removal. This is separate from network recovery; relaxing
join checks would bypass the intended moderation boundary.

## Changes

- Pause automatic media mutations/retries during hidden, page-hidden or offline
  intervals. Abort in-flight media waits, exclude suspension from elapsed budgets,
  and coalesce foreground/focus/pageshow/online recovery. Keep six total attempts
  and the existing 30-second active recovery episode; repeated foreground events
  do not replenish an exhausted episode. Existing capture reacquisition,
  generation checks, serialized media mutations and stale-track closure remain.
- Refresh authoritative meeting state immediately on resume, with a bounded
  snapshot request. Chat/recording refreshes cannot block that request's lifecycle.
  Removed/ended snapshots stop capture and recovery.
- Return authenticated viewer identity on private, non-cacheable meeting snapshots.
  Restore the same participant and waiting admission, without a new admission or
  duplicate participant. Keep the original meeting query in the current URL;
  explicit leave clears it.
- Store only per-tab device preferences, not identity or authorization, in
  `sessionStorage`. Automatic reload resume requires a server-joined participant
  and valid saved preferences; microphone mute and camera-off are preserved.
  Missing/invalid/unavailable storage uses prejoin rather than starting capture.
- Add `POST /api/meetings/:id/readmit` and confirmed host-only **Allow re-entry**
  controls for removed participants. Cookie-derived host authority is required;
  body-supplied actor IDs cannot grant authority. Ended/locked rooms and nonremoved
  targets are rejected. Stale SFU state must be cleaned before restoring approval.
  Removal/readmission share the target's SFU mutation lock with media operations.
- Readmission atomically changes the same participant from `REMOVED` to `LEFT`
  and replaces rejected admission with explicit host-approved admission, including
  reviewer and resolution time. It does not create media or mark the guest joined.
  The guest must reuse the original link and join, under the same cookie/account.
  A subsequent removal revokes approval again.

## Validation

The final focused regression run passed **259 tests in six files**:
`browser-ui`, `host-management`, `meeting-foundation`, `realtime-client`,
`ui-state`, and `homepage-routing`. Both application and test TypeScript checks,
the production-equivalent Wrangler dry-run build, and `git diff --check` passed.
The build was dry-run only; it did not deploy production. No dependencies were
installed, resources created, configuration changed, or migrations applied.

Added coverage includes two-minute synthetic hidden/pagehide/offline episodes,
coalesced foreground/focus events, exhausted retry caps, original-link server
identity restoration for joined/left/removed/waiting participants, device privacy
on reload, removal while hidden, confirmed host readmission UI, cookie-derived
authorization and spoofed/anonymous rejection, Durable Object restart, repeated
removal and voluntary leave/rejoin.

Tests exercise synthetic browser lifecycle events and mocked WebRTC, not physical
mobile operating-system suspension or real SFU audio/video.

One old camera-cycle assertion expected a stage preview without joining a meeting.
The test now explicitly joins before asserting a stage preview, retaining the
prejoin camera-cycle assertions. Removed participants intentionally remain listed
to the host for readmission, but never remain on the video stage.

## Physical two-device acceptance (owner-assisted; pending)

The owner has agreed to test as host and mobile participant on staging.

1. On the staging meeting UI, create a disposable meeting on the host device.
   Open its original link on a separate physical mobile device/browser, request
   admission, and approve it. Confirm two-way audio/video and exactly two people.
2. On mobile, switch tabs, switch apps, lock/unlock the screen, and return after
   at least two minutes. Confirm identity, admission and mute/camera selections
   remain; both directions of audio/video recover without duplicate tiles.
3. Disconnect/reconnect mobile networking. Verify recovery, then repeat events
   without an endless reconnect loop. Reload the original tab and verify saved
   microphone mute and camera-off remain respected.
4. Voluntarily leave and rejoin the original link. Approval and participant
   identity should persist; the camera/mic state must match the chosen controls.
5. Remove the mobile participant as host. Confirm mobile capture stops and the
   original link cannot join, even after reload. Do not clear cookies or use
   another browser identity for this test.
6. Select **Allow re-entry** for that removed participant and confirm. Reuse the
   exact original link in the same mobile browser. Join successfully without a
   duplicate participant or a second approval prompt. Verify two-way media.
7. Remove again and verify re-entry is blocked again. End the disposable meeting.

Record device/browser versions, interruption durations, recovery time, two-way
media observations, removal/readmission outcomes and any console error. Physical
qualification and explicit production approval remain release gates.
