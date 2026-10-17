# BT-GROWTH-001 — Consolidated Website Implementation Specification

Status: IMPLEMENTED AND STAGING-QUALIFIED; awaiting owner review and separate production approval.
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

Focused local evidence: 55 feedback backend tests passed against real SQLite, 19 new website/form/SEO tests plus four legacy homepage tests passed, nine selected existing login/session, Dashboard scheduled-start and Scheduler lifecycle regressions passed, and one existing account-navigation UI regression passed (88 focused tests total). The final account-return correction was checked with two targeted tests, not another full suite. Typecheck and staging-config dry-run bundle passed. Unrelated suites and physical media qualification were not repeated.

## 10. Completed staging qualification (2026-10-18)

- URL: https://billiontalks-v1-staging.anandjob1706.workers.dev/
- Deployed implementation SHA: `de78769b51258f74eda6dbfb629ea1acb75d9842`.
- Active staging Worker version: `749b7f31-1cc0-4c5c-b5d6-669b2a299f44`, confirmed at 100% traffic.
- Pre-growth staging rollback: `fb44e1fe-cafb-4988-af76-12ba0641b635`, confirmed available. Migration 0009 is additive and can remain when rolling back the code.
- Production remains `644e2632-2d38-4135-9785-e8b49b2b06ee` at 100%. No production migration, activation or deployment occurred. Existing D1, Durable Objects, R2, account configuration and secret bindings match the pre-growth checkpoint; both production custom domains are unchanged.
- All six pages were checked in a real browser at 320, 390, 768, 1366 and 1440 pixels: no horizontal overflow, broken images, missing image alt attributes or page JavaScript errors in the public-page sweep. Mobile navigation opens/closes. Desktop Home and mobile Contact screenshots were captured during review; no screenshot files were added to the repository.
- Titles, H1s and canonicals match the approved six-page content. Sitemap XML parses and contains exactly six canonical URLs. Staging robots disallows crawling; app/account/meeting routes retain noindex response headers. The served logo hash matches the official repository asset.
- Guest Feedback was actually persisted with its selected rating and 90-day expiry. An authenticated Report an Issue was actually persisted with the verified account ID despite editing contact name/email; the account profile remained unchanged. Optional empty context was omitted correctly.
- Authenticated Dashboard and Settings links both open the same Contact form with prefilled identity. Sign Out restores guest navigation. Existing register/login panels open correctly. When marketing owns `/`, account Back to meetings now returns to `/ui`; legacy root navigation remains unchanged when the website flag is off.
- The public review method is rejected, guests receive 401 from the admin API, and an authenticated non-reviewer receives 403. Authorized-review success is covered by backend tests, not claimed as a live staging reviewer test: the allowlist remains empty as requested.
- Both exact QA feedback records and the synthetic staging account, session, preferences and entitlement were removed; zero fixture accounts/submissions and zero reviewers were confirmed. Normal short-lived abuse counters were not broadly deleted.
- A single final staging refresh included the confirmed account-return navigation correction. Its candidate bindings matched the already-qualified staging version; the corrected return link, register/login panels and homepage were then checked live without repeating the full browser sweep.

Ready for owner staging/design review and a separate production decision. Before release, authorize production migration 0009 and homepage activation, identify any reviewer account IDs, and confirm the disclosed activity-driven physical-cleanup policy or approve a scheduled alternative. General legal-policy review and physical-device media qualification remain separate limitations. Submit the sitemap to Search Console only after an approved production launch.

## 11. Reference-based visual recovery (2026-10-18)

The earlier written-specification interpretation was visually rejected. It is superseded by the six original PNGs in [approved-designs](./approved-designs/) and the [visual approval manifest](./BT-GROWTH-001-VISUAL-APPROVALS.md). All six SHA-256 hashes matched before implementation. Commit `4bce0c8` preserves the original images; pushing and fetching the growth branch confirmed identical remote Git blobs for every file.

Current staging implementation: `ba6cdb9b32168f2e6bcab23c9503644b0a59dbf4`.
Current staging Worker version: `b131b0eb-cb34-414d-b145-3d5607f96414`, confirmed at 100%.
URL: https://billiontalks-v1-staging.anandjob1706.workers.dev/
Immediate pre-recovery rollback: `749b7f31-1cc0-4c5c-b5d6-669b2a299f44`.

The correction is confined to marketing rendering/styles/content, the shared Contact presentation, asset serving and focused website tests. No account, meeting, Dashboard, Scheduler, backend feedback, migration or Worker configuration code changed. Six optimized photographic extracts (approximately 54 KB combined) reuse the owner-provided originals; page text, layouts, icons and product previews remain HTML/CSS/SVG. Original PNGs are not shipped as rasterized pages. The real repository logo replaces generated sample branding.

### Visual-reference comparison and remaining differences

These are implemented reference-based compositions, **not a claim of pixel-perfect reproduction or renewed owner visual approval**. All six actual desktop captures and both mobile captures were inspected. Remaining differences are explicit:

| Page | Reference composition reproduced | Differences requiring owner review |
|---|---|---|
| Home | Blue-white hero, large two-tone headline, four original sample participants in a dimensional product preview, five elevated cards, lower Why section and device treatment. | Office/set dressing and platform lighting are simplified into CSS gradients/shadows. Preview chrome is illustrative rather than a live call; original approved body copy is retained instead of unsupported mockup claims. |
| About | First-design headline, laptop rather than Home's freestanding display, four principles, connected globe, Philosophy/Mission/Vision cards, Values and closing CTA. | Globe is a CSS connection illustration, not the detailed reference world map. Mug, plant and desk photography are not reproduced. Values use the approved truthful copy, not free-forever or adoption claims. |
| How It Works | Four numbered stages, directional progression, stage-specific account/calendar/invitation/collaboration visuals and laptop/phone preview. | Real registration/scheduling/join links replace sample input/copy controls. Illustrative calendar/link panels do not pretend to create meetings. Hero proportions and total page height differ from the static reference. |
| Features | Product-first laptop/phone hero, six distinct supported feature visuals, lower scheduling/invitation/chat composition. | Six requested supported features use a three-column grid, rather than the reference's eight cards including unavailable/unsupported claims. Decorative cloud/office set dressing is simplified. |
| Solutions | Original team imagery, floating capability list, six differentiated linked audience cards and blue closing CTA. | Individual portraits are reused from the approved assets rather than reproducing every audience's separate pose. No fictional user counts or security promises. Every card uses existing registration or Dashboard navigation. |
| Contact | Approved headline and support photograph, six coloured icon topics, selected-topic treatment, exactly one focused form, adjacent feedback-growth panel and responsive stacking. | Guest fields remain empty; no mockup identities are published. Existing backend fields are preserved: no new Subject field, rating only for Feedback. No invented support SLA or response promises. Mobile callout is repositioned so it does not cover the face. |

Shared intentional differences: exact official logo and approved six-item navigation order take precedence over generated logos, Free Access links or alternate mockup menu order. System-font typography, truthful copy, privacy notices, accessible controls and a working footer change line breaks/page heights. CTA bands are darker to retain white-text contrast.

### Qualification evidence

- 31 distinct focused regressions passed: 20 website/form/SEO tests, four legacy homepage-routing tests, and seven selected account-session/Dashboard/Scheduler tests. Existing 55-test feedback persistence/security evidence is reused because that backend is unchanged. Typecheck, staging dry-run build and final uploaded bundle passed. No full suite was repeated.
- Browser screenshots saved outside the repository: six full-page desktop PNGs with **verified 1440-pixel image width**, plus Home and Contact mobile PNGs with **verified 390-pixel width**. Contact captures show Feature Suggestions selected and blank guest fields. The screenshot ZIP is provided with the handoff.
- All six final staging pages passed 320/390/768/1440-pixel layout checks, with no horizontal overflow. Desktop checks found no broken images, incorrect canonicals, hidden closing CTAs or page JavaScript exceptions. Mobile menu expansion/collapse passed. The first screenshot pass exposed an About CTA selector-scope bug and a face-obscuring support callout; both were corrected before the final set.
- All six Contact topics were verified with real browser pointer events to reveal the same form. A single Feedback submission was durably stored with rating 4, then the exact synthetic record was deleted and zero remaining records confirmed. No account or meeting fixtures were created. Reviewer allowlist remains empty.
- Public Sign In and Solutions registration navigation open existing account panels; Back to meetings remains `/ui`. Meeting deep links, account, Dashboard, Scheduler, Calendar, Contacts and Notifications return 200 with noindex. Six-URL sitemap parses; staging robots remains disallowed. Unauthenticated administrative review remains 401.
- Existing authenticated prefill/profile-isolation and Dashboard/Settings integration evidence from section 10 is retained, supplemented by passing current website/session regressions. This pass does not claim a new live authenticated-user or physical media qualification.
- Final staging bindings exactly match the pre-recovery version, including D1, Durable Objects, R2, Resend/Realtime secrets and account configuration. No migrations, resources, triggers, DNS or secret rotations occurred. Existing Wrangler authorization sufficed without an interactive login flow.
- Production remains `644e2632-2d38-4135-9785-e8b49b2b06ee` at 100%; no production deployment occurred.

Status: implementation and staging functional/visual checks delivered; **final visual acceptance remains pending owner review of the screenshots and listed fidelity differences**. Passing automated tests alone is not visual acceptance. No production promotion is recommended without that acceptance and separate release authorization.
