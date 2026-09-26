# ADR-001 — BillionTalks V0 Media Architecture

## Status

**Proposed — PoC Validation Required**

## Context

BillionTalks V0 requires a working communication platform with audio, video, screen sharing, participant management, and recording. Its media infrastructure must remain separate from the BillionTalks application and intelligence layers, with a path to V1 transcription and AI meeting intelligence.

The [V0 Architecture Blueprint](../architecture/BT-V0-ARCHITECTURE-BLUEPRINT.md) establishes an SFU-based media direction while leaving the implementation open. This ADR proposes a preferred candidate for proof-of-concept (PoC) validation; it does not finalize that choice.

## Proposed Decision Direction

Cloudflare Realtime SFU is the preferred media architecture candidate for BillionTalks V0.

**Cloudflare has not been finally selected.** This ADR must remain Proposed until every PoC acceptance criterion below has passed. Passing the PoC is required before the status can change to Accepted.

## Requirements

- WebRTC-based audio and video communication.
- Screen sharing.
- Multi-participant communication.
- No arbitrary BillionTalks product-level participant cap. Actual capacity remains subject to infrastructure capacity and operating limits; this is not a claim of unlimited participants.
- Architecture capable of scaling horizontally as usage grows.
- Global expansion capability.
- Reliable connection and reconnection behavior.
- Browser compatibility.
- Secure meeting access.
- Media infrastructure separated from the BillionTalks application and intelligence layers.
- BillionTalks retains ownership of meeting, conversation, decision, action, and intelligence data.
- Recording remains a required V0 capability.
- Recording is used minimally during development and testing.
- Recording architecture must not block future subscription-based recording and storage.
- Future V1 architecture must support transcription and AI meeting intelligence.

## Rationale for the Initial Preference

The initial preference is based on the following considerations supplied for this proposal:

- BillionTalks already uses Cloudflare.
- Cloudflare Realtime SFU uses a WebRTC SFU architecture.
- It supports audio, video, and realtime media.
- Cloudflare provides global infrastructure.
- Its usage-based architecture aligns with growing usage.
- The current free allowance makes early development and testing cost-effective.
- It avoids operating our own SFU infrastructure during the initial stage.

These considerations motivate evaluation rather than establish a final selection. Applicable free allowances, pricing, and usage visibility must be checked during the PoC; no fixed allowance or cost guarantee is assumed by this ADR.

## Required PoC Acceptance Criteria

All of the following must succeed before this ADR can change to Accepted:

1. Two or more browsers successfully join the same BT test meeting.
2. Two-way microphone audio works.
3. Two-way camera video works.
4. Screen sharing works.
5. Participant join/leave works correctly.
6. Connection/reconnection behavior is validated.
7. Basic meeting security/access control is validated.
8. Minimal recording capability or a technically viable recording path is validated.
9. Media usage/cost can be observed sufficiently for future cost control.
10. No critical architectural blocker is found for future transcription/AI integration.

Validation of a technically viable recording path satisfies the recording PoC criterion only; recording remains a required capability for V0 delivery. This ADR does not claim that the PoC has passed.

## Alternatives Retained for Fallback Evaluation

- LiveKit
- mediasoup
- Janus
- Jitsi

These alternatives remain available if the preferred candidate fails validation or presents a critical architectural blocker. This ADR does not select or rank a fallback.
