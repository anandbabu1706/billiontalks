# BT-GROWTH-001 — Website, SEO and Social Launch Master Plan

Status: PLANNING — not implemented or deployed
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
