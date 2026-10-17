# BillionTalks — Six Locked Visual References (Owner-approved 2026-10-18)

**STATUS: ALL SIX DESIGNS APPROVED.** Visual assets must be committed under `docs/growth/approved-designs/` before Codex begins visual correction. The GitHub copy is the source of truth **after** the original PNGs are uploaded and verified. The manifest being present does NOT imply the images have been uploaded.

| Page | Locked source file | SHA-256 | Required behavior/notes |
|---|---|---|---|
| Home | `approved-designs/01-home.png` | `1d1ee856d72844e0d419782a6402d8caa988d6c0eebe1bfe0eec900f7a73fc67` | Premium blue-white hero, realistic meeting product, five raised feature cards |
| About | `approved-designs/02-about.png` | `eada44469a895b1c9dea0d1bbb9a0b5bb90c26f04247c12d12818e2de17cac97` | **First approved About design**, headline “Connecting People. Building Better Conversations.” |
| How It Works | `approved-designs/03-how-it-works.png` | `4791ce496287e753b141ede7c3554fa0ff01521619cf794d55209136fef3454c` | Four visually distinctive steps and meeting preview |
| Features | `approved-designs/04-features.png` | `5d436ac06a72d7d7be911370d0517a42af7cb5445928973d0ce7c0055d6283fc` | Product-focused imagery and distinct feature sections |
| Solutions | `approved-designs/05-solutions.png` | `3b64d22beba833767ee665e8224c4bbfdae88ac2ceac5413b17313d176bca0e1` | Six audience cards; **clicking any card title (preferably whole card) goes to existing Create Account** when signed out, Dashboard if signed in |
| Contact & Feedback | `approved-designs/06-contact-feedback.png` | `5ddc3a5710cbbf96115361fbcb0375abf73e8a31e03d9580ebf4a4cb30fc1785` | **Final most recently approved** “Your Voice Matters. Every Conversation Counts.” design. Six interactive topic cards, ONE selected-topic form, secure account prefill and feedback backend. Sample form values are mockup-only. |

## Implementation non-negotiables
- Approved public navigation: **Home → About → How It Works → Features → Solutions → Contact**.
- Use the **real repository official logo**, not approximate generated image logos. Preserve previously approved V0/V1 functionality and published copy/SEO, except as specifically overridden by the approved mockups and notes here.
- Six pages must be **visually distinct**; reject the current generic same-photograph/same-hero layout. Treat PNGs as reference only, **not** rasterized page content.
- Sample text in mockups is not functionality evidence: no unsupported claims (“free forever,” unlimited, AI functions, recording playback, customer counts, support SLAs). Functional, accessible, responsive HTML and real interaction required.
- Staging-only. Production requires a separate explicit owner approval. Do not change Cloudflare resources or secrets.
- **Gate:** before implementing, verify all six referenced PNGs exist on the active GitHub branch. If missing, stop and request upload; do not generate substitute designs or spend credits guessing.
- Avoid repetitive tests and unnecessary revisions; preserve the working feedback implementation, SEO, auth, dashboard, scheduling and meeting links.
