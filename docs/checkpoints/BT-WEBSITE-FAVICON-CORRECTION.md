# Website favicon and social preview correction

## Release

- Branch: `bt-website-favicon-social-correction`.
- Deployed code: `63fedc381e12f355dd364ad977e885c3ffdeecf6`, including asset commit `7fa8cfdbfd824e92ccd942d08a78d50216cf5e1f`.
- Existing staging Worker: `billiontalks-v1-staging`.
- Staging: https://billiontalks-v1-staging.anandjob1706.workers.dev/.
- Deployed version: `6249cd70-aac8-4142-ae9a-752a9179096d`.
- Previous staging version: `df3aa9e7-4526-48c6-9f07-37e152a37a60`.
- No production deployment, merge to main, new resources, migrations, tokens, or secrets.
- Existing staging D1, R2, Durable Object, secret names, account origin and scheduled-handler configuration were preserved.
- The correction branch retains the existing participant-rejoin development. No meeting behavior was changed.

## Authentication diagnosis and successful procedure

The repository `.env` contains `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. There were no inherited Cloudflare/Wrangler process
credential variables during diagnosis. The dotenv account ID matched the staging
configuration, but its API-token authentication could not retrieve account IDs
and deployment failed with "No access to the specified service."

The saved Wrangler OAuth login was available. Following the established
procedure documented in the website implementation specification:

1. Exclude Cloudflare API-token/global-key credential variables from the command
   process, without changing persistent environment settings.
2. Pass an explicitly empty environment file using `--env-file`, preventing
   repository dotenv credentials from overriding OAuth.
3. Run `wrangler whoami --config wrangler.v1-staging.jsonc --env-file <empty-file> --json`.
4. Confirm `authType` is `OAuth Token`, account ID is
   `2d48323814fb300c94661daac9ee80bf`, and Workers write permissions are present.
5. Read the existing staging deployments and active version before deploying.
6. Deploy using the same staging config and empty-environment arguments.

These checks succeeded and deployment was performed only after authorization
was confirmed. The repository `.env` and saved OAuth credentials were not edited.
No token values were printed or committed. Without the explicit empty environment
file, repository dotenv authentication still takes precedence; ordinary
unqualified Wrangler commands should not be used for this release.

## Asset inventory and disposition

All displayed raster images were inventoried across the six pages. Existing
approved page photos, typography, layout and CSS were retained.

| Existing asset | Intrinsic dimensions | Displayed on | Disposition |
| --- | --- | --- | --- |
| `src/assets/brand/billiontalks-logo.png` | 629 x 190 | All six pages | Retained unchanged as wordmark; no longer used as favicon |
| `src/assets/website/portrait-priya.webp` | 203 x 113 | Home, About, How It Works, Features, Solutions | Retained approved illustration; low-resolution source |
| `src/assets/website/portrait-arun.webp` | 216 x 127 | Home, About, How It Works, Features, Solutions | Retained approved illustration; low-resolution source |
| `src/assets/website/portrait-karthik.webp` | 197 x 98 | Home, About, How It Works, Features, Solutions | Retained approved illustration; low-resolution source |
| `src/assets/website/portrait-sneha.webp` | 216 x 105 | Home, About, How It Works, Features, Solutions | Retained approved illustration; low-resolution source |
| `src/assets/website/solutions-team.webp` | 370 x 327 | Solutions hero and audience card | Retained unchanged |
| `src/assets/website/support.webp` | 382 x 270 | Contact hero and Solutions audience card | Retained unchanged |
| `src/assets/website/team-1200.webp` | 1200 x 900 | Previously social metadata only | Removed from Open Graph/Twitter references; file retained |
| `src/assets/website/team-640.webp` | 640 x 480 | Not displayed by current six-page templates | Retained; not introduced into pages |
| `src/assets/website/earth-800.webp` | 800 x 600 | Not displayed by current six-page templates | Retained; About uses existing CSS globe illustration |

The small portrait sources and mismatched nominal square image attributes in
existing templates remain quality limitations. The Contact image also has
nominal 800 x 800 markup despite a 382 x 270 source. Higher-resolution approved
originals should be supplied before expanding image use or replacing these
approved compositions. This correction does not claim those source-quality
limitations were solved, and no replacement photo artwork was invented.

## New assets

The exact named symbol source was absent from the checkout and deployed asset
route. The user-supplied standalone TB image was copied byte-for-byte to
`assets/website/BillionTalks Logo symbol.png` (173 x 169).
SHA-256: `BFAB4EB9E71209C4CB1E7363FB774418F1692551BFF52CFC35421B1FB5DE8C00`.

- `favicon-16.png`: 16 x 16, 849 bytes.
- `favicon-32.png`: 32 x 32, 2,453 bytes.
- `favicon-48.png`: 48 x 48, 4,823 bytes.
- `favicon-180.png`: 180 x 180, 45,049 bytes.
- `social-preview.png`: 1200 x 630, 223,965 bytes; existing approved full
  wordmark, existing navy/blue colors and existing tagline.

Favicon generation preserves source proportions with centered square padding.
No symbol tracing, logo substitution, or wordmark-as-favicon was used.
The 180-pixel icon is necessarily a slight upscale of the supplied source.
New share-card visual acceptance remains pending owner review; no production
promotion is authorized.

## Changed implementation files

- `src/website/assets.ts`: self-hosted favicon and preview endpoints.
- `src/website/ui.ts`: favicon links, 1200 x 630 Open Graph/Twitter image metadata
  and request-origin social image URL for nonproduction validation.
- `src/index.ts`: pass website request origin and add meeting favicon head link.
- `src/account/ui.ts`, `src/dashboard/ui.ts`, `src/calendar/ui.ts`,
  `src/scheduler/ui.ts`, `src/contacts/ui.ts`, `src/settings/ui.ts`: favicon head
  links only, including the invitation page.
- `tests/website-growth.test.ts`: metadata, PNG dimensions and app favicon
  coverage.
- Six new PNG assets under `assets/website`.

## Validation

- Full suite: 17 files, 440 tests passed.
- Typecheck passed.
- Default build dry-run and staging-config deployment dry-run passed.
- Live staging: all six website routes, account and meeting routes returned 200.
- All five live generated PNG endpoints returned GET/HEAD 200, `image/png`, and
  SHA-256 hashes identical to local committed files.
- All six staging pages reference the staging-hosted social image in both
  Open Graph and Twitter metadata; existing unique page titles remain intact.
- Live browser sweep of six pages at requested 1280- and 390-pixel viewport
  widths reported no horizontal overflow, broken images or pending images.
  Actual document client widths were 1265 and 375 with scrollbars.
- Additional mobile-menu screenshot attempts encountered an integrated-browser
  viewport/visibility limitation; no successful new menu interaction or saved
  screenshot set is claimed.
- Before/after home and social-card previews were shown in the conversation.
  The new preview is directly available at the staging social-image endpoint.
- Production was checked read-only and still referenced the previous team image
  and wordmark favicon after staging deployment.
- No new live authenticated-account, multi-party meeting, or physical-device
  media qualification was performed. Existing regression coverage was retained.
- Unrelated untracked `README.txt` was left untouched.
