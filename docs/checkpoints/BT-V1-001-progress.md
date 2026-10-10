# BT-V1-001 — Account UI and email delivery (implementation checkpoint)

Branch: `bt-v1-001-account-ui-email` (not merged or deployed).

## Account surface

The Worker serves `GET /account` as a standalone account UI. It handles login, registration, verification/resend, forgot/reset password, profile updates and logout using the existing D1 account API. The signed-out meeting page still allows guest joins and V0 meeting operations; public Recent Meetings is hidden. Full signed-in dashboard is deferred to BT-V1-002.

## Email provider

The `AccountEmailSender` interface in `src/account/email-delivery.ts` makes the provider swappable. The initial implementation uses Resend's HTTP API with Workers-compatible `fetch`. No secret is committed to source.

Set the following Worker environment variables/secrets out of band:
- `RESEND_API_KEY` — Cloudflare Worker secret, from the Resend service.
- `ACCOUNT_EMAIL_FROM` — verified sending identity (for example `BillionTalks <no-reply@your-verified-domain>`).
- `ACCOUNT_PUBLIC_ORIGIN` — HTTPS public origin, including trailing slash and no path (for example `https://your-existing-worker-hostname/`).

Manual work: register a Resend account, verify a sender domain (or allowed sending identity), provision the Worker secret and configuration. Do not change DNS as part of this implementation; coordinate sender verification separately with the domain owner. Outbound email will **not** work before this setup. Provider-free, arbitrary-recipient transactional mail is not available through Cloudflare Email Routing alone.

### Failure behavior

Registration fails closed with 503 if email is not configured. If the provider fails after the D1 account is created, the API also returns a sanitized 503 while keeping the pending account recoverable through resend verification after the existing cooldown.

Resend verification and forgot password return generic responses so account existence cannot be inferred. Existing D1 tokens stay short-lived and single-purpose: email verification 24 hours and password reset 45 minutes. Tokens are not written to logs and the account page has `Referrer-Policy: no-referrer`. Cookie-authenticated account mutations reject cross-origin browser writes based on Origin / Sec-Fetch-Site.

## Automated validation

- `npm ci`: passed.
- `npx vitest run tests/account-v1-email-ui.test.ts`: **7 tests passed**.
- Account foundation and email regression suites: **58 tests passed**.
- `npm test`: **282 tests passed**, seven test files.
- `npm run typecheck`: passed.
- `npm run build`: passed as Wrangler `--dry-run`; no deployment occurred.
- `git diff --check`: passed.

The V0 browser tests now assert that Home routes account creation to `/account#register` and keeps signed-out Recent Meetings hidden, matching the V1 account boundary. The account foundation harness uses an isolated fake mailer; provider configuration and API behavior remain covered separately.

### Isolated staging readiness

The separate [wrangler.v1-staging.jsonc](../../wrangler.v1-staging.jsonc) configuration targets:

- Worker: `billiontalks-v1-staging` (not deployed)
- D1: `billiontalks-v1-staging-accounts` (`7677f8da-7540-4780-bda3-28c9f7b504bb`)
- R2: `billiontalks-v1-staging-recordings`
- Account sender: `BillionTalks <no-reply@mail.billiontalks.com>`
- Public origin: `https://billiontalks-v1-staging.anandjob1706.workers.dev/`

All four account migrations were applied to the staging D1 only. The Resend API key has not been provisioned. The staging dry-run confirmed staging-only D1/R2 bindings and the Durable Object migration; deployment is still pending separate authorization.

Remaining qualification work includes real Resend delivery and provider-failure/retry integration, browser verification and reset flows, and physical V0 meeting/media regression before any production deployment.

**Status: implementation in progress, NOT signed off.** Automated validation is passing; physical/browser/provider qualification is still required.
