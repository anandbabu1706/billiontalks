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

Registration fails closed with 503 if email is not configured, to avoid creating unverified accounts that can never receive mail. Once the D1 account is created, an external provider outage can result in a 500 even though the account exists. Recovery is possible through resend verification after the existing cooldown; this scenario requires integration testing and UX follow-up.

Resend verification and forgot password return generic responses so account existence cannot be inferred. Existing D1 tokens stay short-lived and single-purpose: email verification 24 hours and password reset 45 minutes. Tokens are not written to logs and the account page has `Referrer-Policy: no-referrer`. Cookie-authenticated account mutations reject cross-origin browser writes based on Origin / Sec-Fetch-Site.

## Required validation before a merge

Run on an installed working copy of the branch:

```sh
npm ci
npx vitest run tests/account-v1-email-ui.test.ts
npm test
npm run typecheck
npm run build
git diff --check main...HEAD
```

Then run targeted browser + D1 integration tests for both happy and failure paths, including duplicate registration, email provider failure/retry, verified/unverified login, expires/used verification and reset links, unauthorized profile access, guest join, account redirects and CSRF. Run physical V0 meeting/media regression before production deployment.

**Status: implementation in progress, NOT signed off.** No test run or production qualification has been claimed here.
