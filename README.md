# BillionTalks (BT)

BillionTalks is an AI-powered communication and conversation platform in early development.

**The meeting doesn't end when the call ends.**

Official domain: [billiontalks.com](https://billiontalks.com)

## Problem and Vision

Conversations generate valuable context, decisions, and commitments, but that value can be lost when the call ends. Turning discussion into clear ownership, follow-up, and measurable results often requires disconnected manual work.

BillionTalks aims to go beyond traditional meeting platforms by progressively transforming conversations into structured intelligence, decisions, actions, follow-up, measurable outcomes, and eventually automation. The long-term objective is a scalable global communication platform that connects conversations to execution.

## Core Lifecycle

Conversation → Intelligence → Decision → Action → Follow-up → Outcome → Automation

## Roadmap

The following stages describe the planned product direction, not currently available capabilities.

### V0 — Core Communication Platform

- Create and join meetings with shareable links.
- Audio/video communication, camera and microphone controls, and screen sharing.
- Meeting chat, recording, participant management, and authentication.
- Design for horizontal scaling without an arbitrary product-level participant cap; actual capacity will depend on infrastructure and operating limits.

### V1 — AI Meeting Intelligence

- Live transcription and speaker identification.
- AI-generated meeting summaries and key topic identification.
- Decision and action-item extraction, including owner and deadline identification.

### V2 — Post-Meeting Intelligence

- Action tracking, follow-up status, and reminders.
- Meeting history and search.
- Personal and team conversation memory that connects related conversations, decisions, and actions over time.

### V3 — Execution & Automation

- Workflow execution and outcome tracking.
- Organizational conversation intelligence.
- Automation based on approved decisions and actions.

## Project Status and Contributions

BillionTalks V0 is in development. The current implementation baseline is BT-V0-030, with the final-audit reconstruction tracked in [BT-V0-FINAL-review](docs/checkpoints/BT-V0-FINAL-review.md). The audit preserves the split Cloudflare Realtime SFU transport, hardens meeting admission/privacy and media recovery, and adds dynamic recording-audio reconciliation. These changes still require physical device and production qualification before V0 sign-off.

External contributions are not yet open while the project foundation is being established.
