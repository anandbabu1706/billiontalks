# BillionTalks — V0 Architecture Blueprint v1.0

This should become the technical foundation for BillionTalks, but V0 should stay deliberately focused. We should build a working communication platform first, while designing the boundaries so AI intelligence can be added cleanly in V1 rather than rebuilding the system.

## 1. V0 objective

V0 must prove this complete journey:

```text
User
 ↓
Sign in
 ↓
Create meeting
 ↓
Generate BT meeting link
 ↓
Participants join
 ↓
Audio + Video
 ↓
Screen sharing
 ↓
Chat
 ↓
Participant controls
 ↓
Recording
 ↓
Meeting ends
 ↓
Recording + meeting metadata retained
```

V0 does not need transcription, AI summaries, decisions, action extraction, organizational intelligence, or automation yet.

Those belong to V1–V3.

## 2. Architecture
```text
                         BILLIONTALKS V0
                              │
                    billiontalks.com
                              │
                              ▼
                    ┌─────────────────┐
                    │   CLOUDFLARE    │
                    │ DNS / CDN / WAF │
                    └────────┬────────┘
                             │
                             ▼
                 ┌─────────────────────┐
                 │   BILLIONTALKS WEB  │
                 │                     │
                 │   Next.js + React   │
                 │   TypeScript        │
                 │   Responsive UI     │
                 └──────────┬──────────┘
                            │
              ┌─────────────┼──────────────┐
              │             │              │
              ▼             ▼              ▼
        Authentication   BT Backend     Realtime
                             │
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
          PostgreSQL     Meeting API    WebSocket/
                                        Events
                             │
                             ▼
                  ┌────────────────────┐
                  │   MEDIA SERVICE    │
                  │                    │
                  │      WebRTC        │
                  │       SFU          │
                  │     STUN/TURN      │
                  └─────────┬──────────┘
                            │
             ┌──────────────┼─────────────┐
             ▼              ▼             ▼
           Audio          Video       Screen Share
                            │
                            ▼
                    Recording Pipeline
                            │
                            ▼
                       R2 Storage
```

There is one important architectural separation here:

Cloudflare should run the web/application edge of BT; the real-time media plane should remain a separate subsystem.

We should not try to make ordinary application servers handle multiparty video traffic.

## 3. Recommended V0 technology stack
| Layer | V0 choice | Purpose |
| --- | --- | --- |
| Language | TypeScript | Shared frontend/backend language |
| Frontend | Next.js + React | BT web application |
| Styling | Tailwind CSS | UI development |
| Edge | Cloudflare | DNS, CDN, WAF, deployment |
| API | TypeScript API layer | Meeting/business logic |
| Database | PostgreSQL | Persistent application data |
| Realtime media | WebRTC | Audio/video transport |
| Media topology | SFU | Multiparty scalability |
| TURN/STUN | coturn or provider infrastructure | NAT traversal/connectivity |
| Realtime app events | WebSocket-based layer | Presence/chat/meeting events |
| Recording storage | Cloudflare R2 | Object storage |
| Source control | GitHub | Repository/version control |
| Development | VS Code + Codex | Engineering environment |

### One decision I would deliberately keep open

Do not choose the SFU implementation yet.

Candidates include LiveKit, mediasoup, Janus, Jitsi components, or a managed media provider.

That decision requires a separate build-vs-buy analysis because it directly affects cost, scalability, engineering complexity, recording, geographic distribution and operational burden.

## 4. Why SFU matters

A basic WebRTC implementation can connect browsers directly.

For example:

```text
A ─── B
│ \ / │
│  X  │
│ / \ │
C ─── D
```

This is a mesh.

As participant count grows, each participant may need to send streams to many other participants.

That becomes inefficient quickly.

BillionTalks should instead be architected around an SFU — Selective Forwarding Unit:

```text
             Participant A
                   │
                   ▼
             ┌───────────┐
Participant B│           │Participant C
────────────►│    SFU    │◄────────────
             │           │
Participant D│           │Participant E
────────────►│           │◄────────────
             └───────────┘
```

Each participant primarily sends their media upstream to the SFU, which forwards appropriate streams to others.

That gives us a much more credible path toward large meetings.

## 5. Scalability principle

Your original BillionTalks requirement was effectively:

Don't create an artificial participant limitation.

We should encode that architecturally as:

No arbitrary product-level attendee ceiling

Instead of:

Meeting capacity = hardcoded 100 users

BT should eventually reason around:

```text
Available media capacity
        +
Regional capacity
        +
Meeting topology
        +
Bandwidth
        +
Subscription/service policy
        +
System health
```

That does not mean infinite participants.

It means the architecture should not be unnecessarily designed around one fixed number.

Large-scale sessions may eventually use a different topology:

```text
Normal Meeting
     ↓
Interactive SFU

Large Meeting
     ↓
Distributed SFUs

Massive Event
     ↓
Speakers → SFU → Broadcast/CDN → Audience
```

This is the appropriate long-term direction rather than trying to make 100,000 participants behave as 100,000 simultaneous interactive video publishers.

## 6. Core V0 services

We should keep the initial system modular without prematurely creating dozens of microservices.

```text
BT V0
│
├── Web Application
│
├── Authentication
│
├── Meeting Service
│
├── Participant Service
│
├── Realtime Event Service
│
├── Media Integration
│
├── Recording Service
│
└── Storage/Data Layer
```

Start as a modular architecture.

Do not start BillionTalks with 20 microservices. We can extract services later when traffic or organizational complexity actually justifies them.

## 7. Core data model

V0 should establish clean entities because V1 intelligence will depend heavily on them.

```text
User
│
├── User ID
├── Name
├── Email
└── Profile

Meeting
│
├── Meeting ID
├── Host ID
├── Title
├── Created Time
├── Start Time
├── End Time
├── Status
└── Settings

Participant
│
├── Participant ID
├── Meeting ID
├── User/Guest ID
├── Join Time
├── Leave Time
└── Role

Message
│
├── Message ID
├── Meeting ID
├── Sender
├── Timestamp
└── Content

Recording
│
├── Recording ID
├── Meeting ID
├── Storage Location
├── Started At
├── Ended At
└── Status
```

Later V1 adds:

```text
Transcript
Speaker
Topic
Decision
Action
Owner
Deadline
```

V2 adds:

```text
FollowUp
Status
Relationship
ConversationMemory
```

V3 adds:

```text
Workflow
Automation
Outcome
Trigger
Execution
```

That's why getting the V0 identifiers and meeting/event model right matters.

## 8. Meeting state model

Every meeting should have an explicit lifecycle:

```text
CREATED
   ↓
SCHEDULED
   ↓
WAITING
   ↓
LIVE
   ↓
ENDED
   ↓
PROCESSING
   ↓
AVAILABLE
```

And participant state:

```text
INVITED
   ↓
WAITING
   ↓
JOINED
   ↓
CONNECTED
   ↓
LEFT
```

This will become important when V1 starts reasoning about what actually occurred.

## 9. Event architecture

One architectural decision now can significantly help future BT intelligence.

Important meeting activity should generate structured events.

For example:

```text
meeting.created
meeting.started

participant.joined
participant.left

screen_share.started
screen_share.stopped

recording.started
recording.stopped

message.created

meeting.ended
```

Later:

```text
transcript.created
decision.detected
action.created
action.assigned
action.completed
outcome.recorded
```

This gives us the future foundation for:

Conversation → Intelligence → Action → Automation

without making V0 itself an AI system.

## 10. Recording architecture

Avoid storing large recordings inside the relational database.

Instead:

```text
Meeting
   ↓
Media
   ↓
Recording pipeline
   ↓
Object storage
   ↓
Cloudflare R2
```

PostgreSQL stores only metadata such as:

```text
recording_id
meeting_id
object_key
duration
size
status
created_at
```

That separation is important for scale.

## 11. Security baseline

Security cannot be postponed until the enterprise version.

V0 should establish:

Authentication → Authorization → Meeting access controls → encrypted transport → secure meeting identifiers → signed media/storage access → rate limiting → audit logging → secrets management.

And meeting links should use unpredictable identifiers rather than sequential URLs such as:

```text
/meeting/123
/meeting/124
/meeting/125
```

We want high-entropy identifiers.

Recording access must also be authorization-controlled rather than simply exposing R2 object URLs.

## 12. Repository architecture

Once the blueprint is approved, I recommend Codex evolve the repository toward:

```text
billiontalks/
│
├── README.md
│
├── docs/
│   ├── architecture/
│   ├── product/
│   └── decisions/
│
├── apps/
│   └── web/
│
├── packages/
│   ├── ui/
│   ├── database/
│   ├── shared/
│   └── config/
│
├── infrastructure/
│
├── tests/
│
├── .github/
│
├── package.json
└── .gitignore
```

This is better than immediately creating separate frontend/, backend/, ai/ repositories.

Keep one repository initially.

## 13. What we intentionally do NOT build in V0

This boundary is important.

V0 should not become:

Zoom + Teams + Slack + ChatGPT + Notion + Jira + CRM

all at once.

V0 proves communication.

V1 proves conversation intelligence.

V2 proves continuity and follow-through.

V3 proves execution and automation.

That sequencing protects the project from uncontrolled scope growth.

## 14. V0 completion gate

I would consider BT V0 technically proven when we can perform this test:

```text
Anand creates a BT meeting
        ↓
BT generates meeting link
        ↓
Multiple participants join
        ↓
Camera + microphone work
        ↓
Participants communicate
        ↓
Screen sharing works
        ↓
Chat works
        ↓
Host can manage participants
        ↓
Meeting can be recorded
        ↓
Meeting ends
        ↓
Recording is securely retained
        ↓
Meeting history is available
```

At that point we have something extremely important:

a real communication platform that we control.

Then we introduce the intelligence layer.

## BillionTalks Architecture Evolution
```text
                    BILLIONTALKS
                         │
              ┌──────────┴──────────┐
              │                     │
        COMMUNICATION          DATA FOUNDATION
              │                     │
             V0                     │
              │                     │
              └──────────┬──────────┘
                         ▼
                CONVERSATION DATA
                         │
                         ▼
                        V1
                 AI INTELLIGENCE
                         │
                         ▼
                 DECISIONS + ACTIONS
                         │
                         ▼
                        V2
                  FOLLOW-UP MEMORY
                         │
                         ▼
                    OUTCOMES
                         │
                         ▼
                        V3
              EXECUTION + AUTOMATION
```
### Architecture principle to lock

BillionTalks should own the conversation lifecycle and intelligence model.

We can use third-party infrastructure underneath BT—media infrastructure, cloud services, databases, AI models—but the meeting model, conversation data model, decision model, action model, follow-up model and intelligence lifecycle should remain BillionTalks-controlled architecture.

That is where the long-term product differentiation lives.