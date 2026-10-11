# BillionTalks — locked brand and sign-in visual acceptance (BT-V1-002)

Status: **Design reference / implementation blocked on exact approved logo asset transfer**. This specification does not approve an implementation, deployment, or substitute logo.

## Master brand asset (source of truth)
- The owner-approved visual is the uploaded original **BillionTalks Logo.png** (629×190 PNG). Use its *exact raster artwork*, not the generated BT-text-square, the later synthetic "BT" logo, a traced/recreated mark, or a recolored approximation.
- Owner-supplied original SHA-256 must be verified before integrating the asset. Place at `src/assets/brand/billiontalks-logo.png` (do not infer or invent another source).
- The symbol is a stylized geometric BT in layered royal/electric-blue and cyan gradients. Wordmark is dark navy **Billion** plus vivid blue **Talks**.
- The original logo has an opaque light background: use it on appropriate light panels. **Do not place the white-backed PNG over navy backgrounds as if transparent.** Until a genuine approved transparent/white variant is available, use the original full-color asset on a dedicated light logo surface; do not alter the artwork.
- Record its checksum and natural dimensions in the brand documentation after asset import. All account, dashboard and future pages should use the same shared logo markup/asset source. No separate hand-built pseudo-marks.
- Approved color direction: dark navy, royal blue, electric blue, cyan, white/off-white. Exact hex/gradient stops are **not finalized** until sampled from the original supplied image, so avoid claiming approximate colors are official.

## Approved reference hierarchy
1. Owner's screenshot **BillionTalks sign in page(1).png**: desktop account-page composition and premium split-card proportions.
2. Owner's screenshot **BillionTalks Meeting Dashboard(1).png**: bright premium dashboard look (later milestones).
3. Owner's **BillionTalks Logo.png**: sole logo artwork source.
4. Newly generated sign-in mockup: illustrative only; its mismatched `BT` logo and any unsupported sign-in providers are explicitly NOT approved.

## Sign-in visual acceptance
- Large, centered premium split card: refined deep-navy-to-royal-blue left *brand* panel, clean warm-white right *form* panel, balanced proportions and subtle border/shadow treatment. Overall page should feel luxury, modern, elegant, futuristic and enterprise-grade.
- Left brand: official image on a suitable light surface (unless a genuinely approved transparent variant is supplied), strong headline `Make room for better conversations.`, restrained fine-detail motion/abstract glow, generous but not wasteful spacing.
- Right form: one readable logo placement; primary navigation `Sign in`, `Create account`, `Profile` and only correct active page marked `aria-current=page`; heading `Welcome back`; email, password with visibility toggle, forgot-password, sign-in, back-to-meetings.
- **No Google sign-in button**: OAuth functionality is not implemented/approved. No fake features, marketing numbers, subscription or pricing claims.
- Test width 1440, 1024, 768, 626, 390 and 320 CSS pixels: tabs must never wrap awkwardly; use a breakpoint before both halves become cramped; fields/buttons remain reachable; no giant fixed min-heights/margins.
- Preserve all actual authentication, session, routing, login error/success and account navigation behavior. Preserve guest joining and V0 media.

## Implementation and change-control gate
- Current engineering branch baseline: `bt-v1-002-signed-in-dashboard` at `cb126f4425f9c6394bb8fd3ebd403090e7f69b75`.
- Read-only audit reported uncommitted local modifications to `src/account/ui.ts` and `tests/account-v1-email-ui.test.ts`. Inspect/reconcile them before modifying any local checkout; never overwrite silently.
- This brand-spec branch must not be merged/deployed as a substitute for implementing the actual asset and page.
- Present real browser screenshots at desktop, tablet and mobile after implementation **before any staging deployment**. Owner approval of each is required.
- Run npm test, typecheck, staging dry-run build, git diff --check. Commit only with the real asset and passing results, on the approved development branch after the owner approves previews.
- No V0 production, DNS, secrets, infrastructure, BT-V1-003 or unapproved business-logic modifications.
