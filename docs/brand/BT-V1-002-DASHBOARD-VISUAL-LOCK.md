# BT-V1-002 — Dashboard visual lock (owner approved 2026-10-11)

Status: **APPROVED VISUAL SPECIFICATION, NOT AN IMPLEMENTATION SIGN-OFF**.

## Authority
The owner approved the latest generated BillionTalks dashboard illustration in this conversation (white premium SaaS workspace, slim left sidebar with soft blue accents, refined shadows, 3 vivid meeting action cards, next/upcoming/recent sections, right calendar/quick actions, four totals at page bottom). This specification records the layout and behavior for implementation; the screenshot is a *design mockup*, not evidence of live data or implemented functionality. Owner's earlier dashboard reference remains the design lineage. No alternative dashboard redesign is authorized.

## Logo / design system
- Exact committed asset: `src/assets/brand/billiontalks-logo.png`, SHA-256 `3f7542067ce6ac7d552e87ca0e66ae9d3f041188f3415f036c0291d7765f3f54`. **Do not regenerate, trace or substitute logos**. Use on a white/light background (source PNG is opaque).
- Bright premium off-white / ice-blue app background, white card surfaces, subtle layered shadows and separation, thin cool borders, elegant rounded corners, deep navy typography, vivid royal/electric blue accents. No dark-theme dashboard or flat unseparated white fields.
- Sidebar: original logo at top; Dashboard selected with soft blue highlight; Meetings, Calendar, Contacts, Recordings, Settings underneath; sign out anchored toward bottom. Narrow/mobile view collapses with accessible toggle. Future destinations clearly disabled or marked Coming Soon until implemented.
- Header: search UI only if supported by real functionality; otherwise labeled Coming Soon/non-interactive. Notification/bell likewise no fabricated notifications. Account avatar/identity from authenticated session; no fake plan state. Upgrade link/button may appear as **Coming Soon** only—no invented pricing, checkout, entitlements or plan claims.
- Main: welcome with real account name; local date/time derived from genuine clock/timezone, no static screenshot date.
- Hero action cards: **Start Meeting BLUE**, **Join Meeting GREEN**, **Schedule Meeting PURPLE**. Existing start/join actions must work; Schedule is Coming Soon until BT-V1-003.
- Row below: **Next Meeting** left (real upcoming data if available; otherwise truthful non-functional empty/Coming Soon), **Calendar** right (genuine calendar date navigation if implemented; otherwise read-only calendar and Coming Soon for scheduling).
- Next row left: **Upcoming Meetings** (separate from Next Meeting, filters Today/Tomorrow/This Week/Later only when backed by real data and implemented); right: **Quick Actions** contains **Contacts** and **Account Settings** only. No repeat Start/Join/Schedule.
- Next row left: **Recent Meetings** from account-authorized meeting history; right column may hold supplementary real-data components only if needed, otherwise deliberate whitespace. Avoid fabricated participants/durations/meetings.
- **Footer/bottom row**: four pastel cards in ONE horizontal row on wide desktop, responsive on small screens: Total Meetings (blue), Total Participants (green), Total Meeting Time (purple), Meetings This Month (orange). Display numeric values only if reliable authenticated data permits accurate calculation; otherwise show unavailable or Coming Soon—not fabricated zeroes or sample figures. Specify semantics of deduplication/duration when available.
- Card shadows, paddings and boundaries must clearly separate Next Meeting, Upcoming Meetings, Recent Meetings, Calendar and Quick Actions.
- Responsive validation at desktop 1440, tablet 768, mobile 390 and narrow 320. No clipped nav, sideways scroll or overlapping cards. Preserve access to all real actions.

## Scope & quality gates
- Current working branch `bt-v1-002-signed-in-dashboard` baseline SHA `d8642220fd13593e5cbb25ca4cff3445fb61efd1` (verify latest remote before changes).
- Only BT-V1-002 dashboard UI and presentation helpers; changes to private account APIs strictly if necessary, reviewed, tested. Preserve BT-V1-001 authentication, account UI, V0 meeting/media, guest join, history authorization.
- No dummy meeting rows, invented statistics, fake premium subscription state, live future-module behavior, Google login, marketing pricing.
- Do not begin Scheduler/Calendar/Contacts/Recording/Payments implementation in this task.
- Build local real browser previews at desktop/tablet/mobile; compare side-by-side with the owner-approved screenshot and list discrepancies. Owner approval is required before staging deployment; do not auto-deploy/merge/modify Cloudflare/DNS/secrets/production.
- Verify tests, typecheck, staging config dry-run build, diff check, account-authorization regressions and unchanged V0 behaviors.
- Preserve any locally untracked handoff README; do not silently overwrite local working changes.
