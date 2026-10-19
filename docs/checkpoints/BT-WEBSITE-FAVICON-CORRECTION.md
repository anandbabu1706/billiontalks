# Website favicon and social preview correction

## Initial staging release

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

## Owner-authorized production release (2026-10-20)

This section supersedes the staging-only authorization and pending visual
acceptance above. The owner explicitly approved production release of the
correction qualified as staging version `6249cd70-aac8-4142-ae9a-752a9179096d`,
while excluding unrelated V1 reconnection development.

### Scope isolation and source verification

- Original correction branch: `bt-website-favicon-social-correction`, left
  undisturbed, including its unrelated untracked `README.txt`.
- Isolated release branch: `bt-website-favicon-production-release`.
- Production baseline: `490f03c16dc7dc135978a8ce99d075b6fa83f136`; its runtime
  source is identical to the previously deployed source
  `6c7febff118552231b1384f0c05e9add348886f6`.
- Only correction commits `7fa8cfd` and `63fedc3` were cherry-picked, producing
  `fc3f23c4372d0171a5c3c477673773becc2d1663` and deployed source commit
  **`59223d775418e0adb550f1e9a71c2a7388ae2485`**.
- All approved assets, website code and app favicon edits are identical to the
  approved staging source. The meeting service, meeting regression files,
  dependencies and production configuration remain identical to the production
  baseline. The only production entry-point edits are the favicon head link and
  passing the request origin into website metadata generation.
- V1 rejoin/readmission commit `2f90138` is not an ancestor of the release.
  No main merge or unrelated branch merge was performed.
- Downloaded all 16 approved staging modules and verified byte-for-byte equality
  with the staging source rebuild. Downloaded all 11 pre-release production
  modules: binary assets matched exactly, and JavaScript matched after accounting
  for nine dependency-path comments introduced by the isolated worktree junction.
  No executable production-baseline differences were present.

### Deployment identity and infrastructure

- Existing production Worker: `billiontalks-realtime-backend`.
- Authorized account: `2d48323814fb300c94661daac9ee80bf`.
- Production: https://billiontalks.com/.
- Active production version, at 100%:
  **`e6a55a3e-79bc-4845-a0fa-783d42a5e2ca`**.
- Version tag: `bt-favicon-59223d7`.
- Immediate rollback:
  **`d9102cb2-fbf3-479e-b816-08c38d50e782`**.
- Used the existing OAuth login with explicit empty environment file and
  process credential overrides excluded. Account membership and Workers write
  scope were confirmed before upload.
- Uploaded with `wrangler versions upload`, compared every candidate binding and
  runtime property to the rollback version, then activated the exact uploaded
  version with `wrangler versions deploy ...@100 --yes`.
- No trigger deployment was performed. Existing cron schedules and Worker-domain
  mappings match pre-release API snapshots exactly. D1 database, Durable Object
  namespace, R2 bucket, plain-text variables, runtime migration tag, compatibility
  date and all three secret binding names match the rollback version.
- No resources, tokens, secrets, migrations, DNS entries or additional services
  were created. Repository dotenv credentials were not changed.
- Downloaded all 16 active production modules after activation and verified exact
  byte-for-byte equality with the isolated production candidate build.

### Production qualification

- Selected website, routing, account, scheduler and meeting UI regressions:
  **236 passed, one pre-existing failure** across seven files (237 tests).
- The failure is
  `allows camera cycles ON -> OFF -> ON repeatedly with live tracks and preview state`
  in `tests/browser-ui.test.ts`, asserting a non-null `video.local-preview`.
  The exact failure was independently reproduced on the unchanged production
  baseline and the release candidate. No unrelated fix or test suppression was
  included.
- Production-candidate app/test typecheck and production dry-run build passed.
- All six public pages and seven app routes returned 200 after deployment:
  account, scheduler, meeting UI, Dashboard, Calendar, Contacts and Notifications.
- Compared pre/post normalized page bodies and styles for all 13 routes:
  unchanged. Page titles, descriptions, canonicals and indexing directives were
  unchanged.
- All six public pages now use the production-hosted branded 1200 x 630
  Open Graph/Twitter image. The five generated PNGs match committed and approved
  staging bytes, return `image/png`, support GET/HEAD 200, and return 304 for
  matching ETags.
- Live browser sweep of all six public pages at requested 1280/390 widths
  reported zero horizontal overflow, broken images or pending images.
  Document client widths were 1265/375 with scrollbars.
- Login browser check: `/account#login` returns 200 with the visible sign-in
  panel, password input and approved favicon.
- Guest scheduling browser check: `/schedule` returns its app shell, then
  correctly redirects to `/account#login`. Guest account and schedules APIs
  return the expected 401 both before and after deployment.
- Meeting browser check: `/ui` opens the existing Start or join a meeting screen
  with the approved favicon. The legacy root `?meeting=` route also returns the
  meeting interface without creating a meeting. `www` canonical redirect retains
  the meeting query.
- No signed-in browser session was available. This release does not claim a new
  credentialed login, authenticated scheduling write, or live multiparty media
  test. No production accounts, schedules or meetings were created for testing.

### Rollback

From the isolated production release worktree, use the same verified OAuth
procedure, excluding repository dotenv credentials and supplying an explicit
empty environment file:

```powershell
npx wrangler versions deploy d9102cb2-fbf3-479e-b816-08c38d50e782@100 --yes --config wrangler.jsonc --env-file <empty-env-file>
```

This is a code-only rollback to the immediately preceding production version.
Do not restore D1, rotate secrets, change resource bindings, redeploy triggers,
or promote the V1 reconnection branch as part of rollback.
