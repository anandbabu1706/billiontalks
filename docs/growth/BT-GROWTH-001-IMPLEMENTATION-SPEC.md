# BT-GROWTH-001 — Consolidated Website Implementation Specification

Status: IMPLEMENTED ON GROWTH BRANCH; staging qualification in progress. Production not authorized.
Source of truth: [BT-GROWTH-001-MASTER-PLAN.md](./BT-GROWTH-001-MASTER-PLAN.md)
Branch: `bt-growth-001-website-social`
Baseline application commit: `f4bb52a7bbf56fbe1ba1a5fa2986a03d156b37c9` (verify active production code and branch before changes)

## 1. Approved design and content boundary
- Implement the locked premium blue-and-white desktop/mobile visual language: elegant gradients, natural photographic/product visual, restrained 3D depth, white rounded cards with subtle shadows, navy text, vivid blue CTAs, accessible contrast.
- Home design locked, including five distinctly raised feature cards; About design locked with exact hero **Connecting People. Building Better Conversations.**; How It Works and Solutions approved. Features design direction approved. Contact approved as uncluttered interactive cards + single conditional form.
- Use the **actual official V1 BillionTalks logo file from this repository**, never AI approximation. Find its existing asset/import; do not invent a new variant.
- Reference mockups are visual-only: do not copy fictional user testimonials, fabricated participant counts, “industry-standard encryption”, “free forever”, “unlimited”, real-file-sharing, playback/retrieval or other unsupported claims.
- Use semantic and accessible HTML/CSS for actual page text, CTAs, forms and icons. Do not ship a screenshot as the website; don't ship image-only text.
- Responsive targets: 320px, 390px, 768px, 1366px and 1440px; keyboard navigation, visible focus, reduced-motion where appropriate, accessible labels.

## 2. Final public information architecture
Navigation in this exact approved order:
**Home → About → How It Works → Features → Solutions → Contact**
Signed out: **Sign In** and **Create Free Account** buttons.
Signed in: prominent **Dashboard** and existing account/profile/sign-out affordance; sessions must be shared with current V1.

Suggested public routes (audit existing route conflicts first):
- `/` — Home, replacing the current account-first root redirect ONLY at approved production launch.
- `/about` — About.
- `/how-it-works` — How It Works.
- `/features` — Features.
- `/solutions` — Solutions.
- `/contact` — Contact and Feedback.
- Legal/support footer destinations as required: `/privacy`, `/terms`, potentially `/help` if useful content is ready and approved.
- NO standalone Free Access/Pricing page in V1; free access prominently communicated on Home and relevant CTAs.
- Reuse existing `/account`, `/dashboard`, `/schedule`, `/calendar`, `/contacts`, `/notifications`, `/ui`, `?meeting=`, scheduled links and APIs, with no lost V0/V1 functionality. Verify actual signup/login hashes/routes before authoring CTAs. Preserve `www` → apex redirects and query strings.

## 3. Proposed page copy and unique search intent (subject to owner copy review)
### Home
H1: **Meet Your Team for Free.**
Intro: Simple online meetings and scheduling for startups, small businesses, entrepreneurs and growing teams.
Primary CTA: Create Free Account. Secondary: Explore Features. Established tagline: **The meeting doesn't end when the call ends.**
Explain actual current meeting, scheduling, host controls and collaboration functions; do not overpromise audio quality/reliability pending physical qualification.

### About
H1: **Connecting People. Building Better Conversations.**
Philosophical positioning: Every meaningful result begins with a conversation; accessible technology should remove friction, not replace human connection.
Sections: philosophy/story, mission, vision, values and one truthful CTA. Use draft values as brand aspirations, not certifications/security guarantees.

### How It Works
H1: **How BillionTalks Works.**
Four steps: (1) create free account, (2) start or schedule meeting, (3) share meeting link/invite, (4) host or join and collaborate.
Document guest approval and privacy controls accurately without requiring every guest to register if current flows allow anonymous guests.

### Features
H1: **Everything You Need for Better Meetings.**
Distinct subsections for online audio/video meetings, scheduling, meeting invitations/links, host approval and participant controls, in-meeting chat, and screen sharing where verified.
Recording: only describe consent/control functionality if accurate; never suggest stored playback/download exists.
Distinguish meeting chat from the deferred separate messaging/WhatsApp-like product; no fabricated group chat/file-transfer functionality.

### Solutions
H1: **Built for Teams of All Sizes.**
Explain scenarios for startups, small businesses, entrepreneurs, freelancers, professionals, and individuals. Specific, accurate use cases and cross-links to How It Works/Features; no unverified adoption statistics or outcomes.

### Contact & Feedback
H1: **We're Here to Help. Let's Keep the Conversation Going.**
Six clear interactive topic cards: General Enquiries, Technical Support, Feature Suggestions, Business & Partnerships, Feedback, Report an Issue.
Selecting a card opens ONE form with that topic preselected, editable and visually focused (same page).
No fabricated email addresses, support SLAs, team sizes, testimonial quotations or live-agent promises. Show a working support channel only when configured.

## 4. One shared Contact & Feedback implementation — public and authenticated V1
- Link the same workflow from public `/contact` AND authenticated V1 Dashboard/Settings.
- Authenticated: server-validated user session supplies display name and verified email for initial field values; editing them affects only the submission. Persist immutable account ID separately, never take identity from submitted form fields.
- Guests: name/email fields filled manually; validation, per-IP/session rate limits, spam controls, privacy notice.
- Optional feedback rating (1–5); issue category/affected feature and description; support actionable diagnostic context but never automatically gather secrets, private meeting messages or unnecessary personal data.
- Use existing authorized database/infrastructure after auditing current schema/migration strategy; implement server-side validation, secure persistence, confirmation/reference ID, appropriate error handling and authorized admin-only read access.
- Prevent unauthenticated submitters from reading other's records. Avoid exposing account existence and prevent injection/XSS or abusive input.
- Admin surface must use existing verified authorization; if missing, identify it as an explicit gated subtask before enabling review.
- No “sent successfully” UI unless backend confirmed write; neither mockups nor UI state constitute working feedback service.

## 5. SEO and delivery requirements
- Server-render or reliably render meaningful HTML content for crawlers; one H1 per page, semantic headings, readable text and real anchor links. Useful page-specific content, not repetition to fill card counts.
- Unique page titles and meta descriptions, absolute canonical URLs at `https://billiontalks.com`, appropriate Open Graph and social card metadata using the official branding.
- Structured data only for accurately verifiable Organization/SoftwareApplication information; no fake AggregateRating/testimonials.
- Valid XML `/sitemap.xml` with all and only **public indexable canonical pages**; valid `/robots.txt`. Never list private account pages, meeting IDs, authenticated dashboards or user content. Robots rules are not security controls.
- Existing Google Search Console Domain property `billiontalks.com` is verified, ownership DNS TXT record must remain. Currently /sitemap.xml returned `{"ok":false,"error":"Not found."}` on 2026-10-17; publish sitemap BEFORE submitting to Search Console.
- Optimize for Core Web Vitals; use compressed responsive imagery, lazy-load below-fold assets, avoid heavy animation/decorative layout shift, use informative alt text and accessible contrast.
- Measure legitimate registrations, successful meetings, repeat usage, feedback and organic traffic with privacy-aware analytics if approved. Do not add paid SEO/ads services by default.

## 6. Safe execution sequence / approval gates
1. Perform read-only audit of actual routes, logo asset, session/account endpoints, existing D1 schemas, dashboard/settings navigation, domain triggers and any existing feedback implementation. Report discrepancies before assumptions.
2. Build public pages and centralized feedback feature in small reviewed commits **on this dedicated growth branch**, reusing V0/V1 implementation. No unrelated feature development, no fake customer data.
3. Run focused tests: existing account login/session, root and meeting-link routing, Dashboard/Scheduler Start, feedback security and persistence, SEO sitemap and metadata, responsive browser view; avoid indiscriminate full suite repetitions.
4. Deploy only to the **existing** staging Worker after verifying Cloudflare access, bindings, existing migrations and rollback. Never create credentials, D1/R2 resources or rotate secrets.
5. Owner approves staging website and functioning feedback; only then request separate owner authorization for production migration (if needed), root routing change, and production activation.
6. Post-launch inspect public HTML/sitemap/robots/canonicals, preserve application routes; submit sitemap in Search Console; configure analytics/social profiles after verified public launch.

## 7. Non-blocking backlog / open limitations
- Physical real-device bidirectional audio/video audible output and connection/reconnection remain to be qualified before aggressive free-meetings promotion; synthetic tests passed.
- User reported Dashboard statistics “Total Participants: Unavailable” and “Total Meeting Time: Unavailable”; defer to next-session statistics backlog, no invented aggregate metrics.
- Recording retrieval/playback remains incomplete; don't advertise playback. V2 pricing and AI features deferred.
- Official logo in generated mockups is not an authoritative asset. Implement the canonical repository asset only.

## 8. Definition of done
- Six approved public pages with accurate, differentiated copy, responsive premium styling, correct official logo.
- Auth-sensitive nav and CTA routing correctly reach existing V1 account and dashboard without breaking meeting links.
- One actually functioning, secure Contact & Feedback system in public and V1 interfaces.
- Valid, accessible, crawlable, indexable public pages, correct sitemap/robots/meta and working Search Console submission AFTER release.
- Staging owner signoff and separately approved production release with rollback.

## 9. Implementation and owner decisions (2026-10-18)

The owner authorized implementation and existing-staging qualification in chat, accepted the written blue/white composition specification in place of unavailable mockup assets, approved a fail-closed database reviewer allowlist using existing account sessions, and selected 90-day submission expiry with short-lived rate-limit hashes.

- Six server-rendered pages follow the final navigation/copy document, with the exact repository logo, locally hosted responsive WebP photographs, lightweight decorative SVGs, shared navigation/footer and one Contact form. Photography provenance is recorded in `src/assets/website/LICENSE.txt`; no image is presented as a product screenshot, employee or customer endorsement.
- `PUBLIC_WEBSITE_ENABLED=true` enables marketing routes and feedback on **staging only**. Without the flag the existing account-first root redirect is preserved. Root `?meeting=` links always retain the meeting UI. Production activation requires separate explicit approval, migration review and a deliberate flag change; there is no production deployment in this work.
- Existing account session resolution supplies navigation, contact-field prefill and immutable submission identity. Editing contact fields never edits the account. Dashboard and Account Settings link to the same `/contact` workflow.
- Additive migration `0009_contact_feedback.sql` uses the existing account D1. It adds submissions, atomic rate-limit counters and an empty reviewer allowlist. The public API permits writes only; authorized review uses `/admin/feedback` and `/api/admin/feedback`. No HTTP endpoint grants reviewer privileges.
- An operator must authorize existing verified account IDs explicitly before adding them to `feedback_reviewers`. The list remains empty in staging pending that authorization. The review shell contains no submission data; its API denies guests and non-reviewers.
- Contact details expire from authorized review after 90 days. Indexed cleanup deletes up to 100 expired submissions and counters per request; inactive storage is not guaranteed to be physically purged at exactly 90 days. This is disclosed in the contact privacy notice. A scheduled cleanup/retention-policy decision is a production approval consideration; no new cron trigger or resource has been created.
- No email delivery promise is made: confirmation means the record was durably accepted, not emailed or answered. Ratings and issue context are optional/conditional, and private meeting content is not collected automatically.
- Six canonical marketing URLs only are listed in XML sitemap. Staging is `noindex,nofollow` and robots-disallowed; application/meeting HTML receives `X-Robots-Tag: noindex, nofollow`. Search Console submission remains a post-production task; DNS ownership records are untouched.
- Existing account Terms/Privacy wording predates this work. No unapproved general legal policy or fictional support mailbox has been published; the footer links to the factual Contact privacy notice.

Focused local evidence: 55 feedback backend tests passed against real SQLite, 18 new website/form/SEO tests plus four legacy homepage tests passed, and nine selected existing login/session, Dashboard scheduled-start and Scheduler lifecycle regressions passed. Typecheck and staging-config dry-run bundle passed. Unrelated suites and physical media qualification were not repeated.
