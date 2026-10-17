# BT-GROWTH-001 — Website, SEO and Social Launch Master Plan

Status: IMPLEMENTED AND STAGING-QUALIFIED — owner review and separate production approval pending
Working branch: `bt-growth-001-website-social`
Starting application checkpoint: `f4bb52a7bbf56fbe1ba1a5fa2986a03d156b37c9`
Repository: `anandbabu1706/billiontalks`

## Confirmed go-to-market direction
- BillionTalks V1 acquisition message: **Meet Your Team for Free.**
- Target users: startups, small businesses, entrepreneurs, freelancers, professionals and teams.
- Established tagline: **The meeting doesn't end when the call ends.**
- V1: prioritize registrations, successful free meetings, repeat usage, reliability and feedback.
- V2: consider optional paid upgrades; publish pricing only after entitlements, billing and pricing are approved and implemented.
- Do not advertise AI summaries, transcripts, recording playback, automated follow-up, or paid plans as operational V1 features.
- Use the existing official BillionTalks logo and brand styling; approve final website and social copy before publication.

## Existing Google/SEO setup — confirmed by owner on 2026-10-17
- Official Google administrative account established.
- Google Search Console **Domain property `billiontalks.com` ownership verified** through existing Cloudflare DNS authorization. Preserve the ownership TXT record.
- On 2026-10-17, `https://billiontalks.com/sitemap.xml` returned `{"ok":false,"error":"Not found."}`.
- Search Console > Sitemaps showed no submitted sitemaps.
- Search Console indexing/performance reports were still processing, not proof of an indexing failure.

## Required website and SEO implementation
- Serve valid XML at `https://billiontalks.com/sitemap.xml` after the marketing website is built. Include **only public, canonical, indexable marketing URLs**; exclude private account/dashboard, meeting IDs, scheduled links, contacts, invitations, user data and authenticated functionality.
- Verify the production sitemap endpoint returns XML successfully **before** submitting `https://billiontalks.com/sitemap.xml` to Google Search Console.
- Provide appropriate `robots.txt`, unique and accurate page titles/descriptions, canonical URLs, crawlable accessible marketing content, Open Graph/social preview metadata, and applicable truthful structured data. Robots directives do not replace authentication.
- Preserve `www` to apex redirects, Cloudflare bindings, V0/V1 app and all existing meeting/account URLs. The current root-to-account behavior must not change until owner explicitly approves the marketing homepage and routing tests pass.
- Use minimal existing infrastructure; avoid new paid platforms without a justified need.

## Proposed website sitemap — planning, subject to approval
- Home: free meeting proposition and `Create Free Account` call to action.
- Features: only current verified V1 capabilities.
- How It Works: create account, schedule/start meeting, invite/join and host controls.
- Solutions/Who It's For: small businesses, startups and professionals.
- About Us: brand vision, mission and truthful company description.
- Free Access / Pricing: V1 free offering, without invented paid tiers or unlimited-use guarantees.
- Contact & Feedback: secure user feedback/issue reporting as a separate scoped feature; assess existing implementation before building.
- Help/FAQ, Privacy Policy, Terms of Service. Obtain appropriate review of legal claims.

## Social presence and launch
- Prepare official profile branding and consistent descriptions for LinkedIn, Instagram, Facebook and YouTube; check availability of handles.
- Launch website before broad marketing; profiles can be reserved earlier.
- Use the same approved value proposition, canonical URL and official logo across channels.
- Start with free organic demonstrations and invite user feedback; defer paid advertising.
- Track account activation, successful meetings, repeated use, media reliability and feedback, not just raw signup totals.

## Pending qualification and next-session issue
- A real participant experienced possible one-way audio. Synthetic bidirectional A/V and reconnection checks passed, but real-device speech/audio output and real-network reliability remain an open qualification gate before broad promotional claims.
- **USER-SUBMITTED SCREENSHOT ISSUE — NEXT SESSION:** User supplied a new screenshot on 2026-10-18 and requested that the issue shown be fixed in the next session. Preserve this as a pending issue; inspect the original screenshot and confirm exact symptoms before changing code. Do not presume a cause or claim it is resolved. Do not divert the current website planning phase into this correction.
- Deferred BT-COR-001 through BT-COR-008 remain a separate existing backlog; avoid duplicating completed changes.

## Execution and approval gates
1. Finalize site structure, exact messaging and visual references with the owner.
2. Implement a consolidated website build on a dedicated branch, preserving the existing live V0/V1 and production data.
3. Run relevant targeted tests; deploy to existing staging only after binding/rollback checks.
4. Obtain owner approval before production activation. Verify public landing, redirects, existing application routes, authentication and sitemap.
5. Submit sitemap and configure indexing/analytics only once production pages are crawlable.
6. Establish official social profiles, collect feedback and proceed with free-user outreach.

No deployment, migrations, secrets, DNS changes, new Cloudflare resources or application edits are authorized by this planning document.

## Approved global positioning and navigation (2026-10-18)
- Global, free-first meeting platform for everyone, initially targeting startups and small businesses; retain individuals, professionals and teams as eligible users.
- Public navigation: Home, Features, How It Works, Solutions, About, Free Access, Contact.
- Signed-out prominent actions: **Sign In** and **Create Free Account**, linked to existing V1 account flows. Signed-in actions: **Dashboard** and profile menu with Sign Out, using existing authentication and session state.
- Preserve direct V1 access at `/dashboard` and existing Scheduler, Calendar and meeting routes; public site must never displace authenticated workspace or scheduled-meeting deep links.
- Verify actual supported account tab/hash routes in code and browser before publishing links; do not assume an unverified registration fragment is supported.
- Do not create separate website accounts or another authentication system.

## Approved navigation and About design — 2026-10-18
- FINAL public navigation order: **Home → About → How It Works → Features → Solutions → Free Access → Contact**.
- Keep Sign In and Create Free Account as separate right-side actions for signed-out visitors; show Dashboard/profile access for signed-in users, preserving V1 authentication.
- **About page visually APPROVED/LOCKED:** retain the first About mockup composition, premium blue-white theme, meeting scene, globe image, cards and CTA, with the finalized headline **“Connecting People. Building Better Conversations.”** and philosophical, people-first tone.
- Final implementation MUST replace any generated logo with the repository's exact official approved logo asset, and correct mockup text that overclaims security, unlimited free access, usage or active capabilities.
- Do not regenerate the About page image or redesign it absent an explicit owner request.

## APPROVED — Central Contact & Feedback system (2026-10-18)
- One shared, centralized Contact & Feedback workflow accessible from the public Contact page AND authenticated V1 Dashboard/Settings. Do not develop duplicate systems or authentication.
- Public Contact page uses interactive topic cards leading to ONE focused form, not multiple simultaneous forms. Categories: General Enquiries, Technical Support, Feature Suggestions, Business & Partnerships, Feedback, Report an Issue.
- Signed-in visitors: securely prefill registered display name and verified email using existing authenticated profile/session; allow editing contact fields for this submission WITHOUT altering account profile. Independently associate submission with authenticated account ID, never trust an editable email as proof of identity.
- Signed-out visitors: allow manual name/email and enforce appropriate validation, rate limits, abuse/spam mitigations and minimal personal-data collection. Do not disclose private account information.
- Topic is preselected from card and may be changed. Feedback can include optional 1–5 rating and comment; issue report includes affected feature, problem description and optional diagnostic context, avoiding secrets or sensitive data.
- Submission: accessible server-backed form, durable existing-infrastructure storage, acknowledgment/reference ID, explicit success/error handling; only authorized administrators can review submissions. Never claim delivered without confirmed backend success.
- Design: premium, clean approved blue/white card style; avoid clutter and remove redundant Quick Response / Your Feedback Matters / Real People strip and unverified response-time promises.
- Incorporate privacy/retention and user notice requirements; avoid inventing or advertising operational contact mailboxes. Integrate with the existing V1 Dashboard and Settings without disrupting meeting flows.
- This is a SCOPE/UX APPROVAL, NOT implementation or production-deployment authorization. Verify existing functionality before building. Focused staging validation and separate production approval required.

## UPDATED — Public navigation and page count
- Approved navigation: **Home → About → How It Works → Features → Solutions → Contact**.
- **Remove separate Free Access page**: express free V1 availability accurately on Home and within relevant CTAs; consider Pricing only when V2 paid capabilities are approved and implemented. No repetitive standalone SEO landing page.
- Signed-in visitors receive direct Dashboard/profile access; signed-out visitors Sign In / Create Free Account.

## IMPLEMENTED — Staging checkpoint (2026-10-18)
- All six public pages and the centralized Contact & Feedback workflow are implemented on this growth branch, using existing account sessions and infrastructure.
- Staging: https://billiontalks-v1-staging.anandjob1706.workers.dev/
- Deployed code: `de78769b51258f74eda6dbfb629ea1acb75d9842`; Worker version `749b7f31-1cc0-4c5c-b5d6-669b2a299f44` at 100%.
- Focused tests, typecheck, bundle, responsive browser checks, SEO checks, actual guest/authenticated persistence and Dashboard/Settings integration passed. Synthetic staging records were removed. The reviewer allowlist remains empty until the owner authorizes account IDs.
- Production is unchanged. Marketing homepage activation and migration 0009 require separate owner approval; no sitemap submission or social/analytics launch has occurred.
- See [implementation and staging evidence](./BT-GROWTH-001-IMPLEMENTATION-SPEC.md#10-completed-staging-qualification-2026-10-18) for validation details, rollback and remaining approval gates.
