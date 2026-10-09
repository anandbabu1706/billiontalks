# BT-V0-024 Investigation — Bidirectional Realtime Media

## Test 45 Production Symptoms

- Host-to-participant video worked, but reconnect could be slow.
- Host-to-participant audio arrived approximately 30–60 seconds late.
- Participant-to-host video and audio were absent.

The symptoms pointed to the independent media directions needing separate recovery and negotiation lifecycles. Simulated PeerConnections can exercise application sequencing and state handling, but cannot establish the behavior of physical devices or production network paths.

## Architectural Conclusions

- Publishing and subscribing use separate client-side mutation queues so a slow or failed operation in one direction does not block progress in the other.
- Recovery remains serialized to avoid overlapping server-side state replacement. Each direction is bounded to three recovery attempts; its budget resets after 30 seconds in a stable connected state.
- Publisher readiness is sequenced after Cloudflare accepts the publish and the browser applies the answer. The publish generation is checked when readiness is recorded so stale sessions cannot promote tracks.
- ICE gathering is bounded. When the timeout expires, SDP containing candidates can proceed; when it has none, the operation fails explicitly and follows recovery.
- The server only records tracks as published when Cloudflare returns a successful, identifiable per-track result.
- The publication-set cache is committed only after a valid no-op response or completed negotiation. A failed negotiation therefore does not mark an unnegotiated set as subscribed; after successful negotiation, unchanged refreshes do not repeat the same mutation.
- Subscriber recovery retains each remote stream and its playback elements, clears stale track mappings before stopping obsolete tracks, then re-subscribes.
- Lifecycle diagnostics retain participant-safe media state and aggregate RTP counters by direction and media kind. They omit raw transport identifiers, SSRCs, track identifiers, and network addresses.

## BT-V0-023 Gap

BT-V0-023 improved guest publish-ready sequencing and participant publication discovery, but did not fully address bidirectional transport concurrency, bounded recovery coordination, ICE gathering timeouts, per-track upstream acceptance, or when a publication set becomes cacheable. It also did not preserve remote media elements and stream state through every subscriber recovery path. These gaps could leave one direction blocked, retain an incorrectly cached subscription set, or make recovery appear successful while stale playback state had been discarded.

## Regression Coverage

- Server tests exercise separate guest and host publishing, publish-ready promotion, and host discovery of both guest microphone and camera.
- Tests verify host microphone and camera publication availability, participant identity stability, guest state through meeting snapshots, and republishing after publisher recovery.
- Server tests cover generation mismatch and partial per-track acceptance.
- Browser tests cover independent mutation progress, bounded publisher recovery, ICE candidate fallback and no-candidate timeout, retry after failed negotiation, and subscriber recovery without duplicate streams, tracks, or membership.
- Browser tests also verify preserved media elements through recovery and ensure exposed RTP diagnostics contain only aggregate values rather than raw identifiers or addresses.

## Validation Boundary

These regressions use simulated PeerConnections and mock Cloudflare responses. They verify client/server logic but cannot prove that physical devices exchange media or establish real-device audio timing.

Production physical-device validation remains required:

1. Join a real host and participant device with microphone and camera enabled.
2. Confirm both peers' publisher diagnostics report ready microphone and camera tracks.
3. Confirm host receives participant audio and video, and participant receives host audio and video.
4. Record host audio timing and recovery duration across reconnects.
5. Inspect redacted RTP diagnostics for progressing inbound/outbound audio and video counters.

## Automated Validation

- `npm test`: 216 tests passed across six files.
- `npm run typecheck`: passed.
- `npm run build`: Wrangler dry-run passed; no deployment was performed.
- `git diff --check`: passed.
