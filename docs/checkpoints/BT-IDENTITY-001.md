# BT-IDENTITY-001 - Account and Identity Foundation

Date: 2026-09-30.

## Scope

This checkpoint consolidates the BillionTalks Account and Identity backend foundation before profile and UI work. The account module is independent of meeting Durable Objects, realtime media, recording, and R2 behavior.

## Account Architecture

- `src/account/domain.ts` defines the public account, credential, verification, session, and password-reset domain shapes.
- `src/account/validation.ts` normalizes and validates registration and account inputs.
- `src/account/repository.ts` owns D1 queries and persistence boundaries.
- `src/account/service.ts` coordinates registration and account operations.
- `src/account/authentication.ts` owns login, logout, session lookup, and login rate limiting.
- `src/account/email-verification.ts` owns verification-token lifecycle behavior.
- `src/account/password-reset.ts` owns forgot-password and reset-password lifecycle behavior.
- `src/account/api.ts` exposes the account routes through the Worker.

The Worker exposes registration, login, logout, `/api/accounts/me`, email verification and resend, forgot-password, and reset-password endpoints through the `ACCOUNT_DB` binding.

## Persistence

Account data uses a dedicated Cloudflare D1 database, `billiontalks-accounts`, bound as `ACCOUNT_DB`. D1 provides relational constraints and globally unique normalized email and mobile identities without coupling account state to meeting Durable Objects.

## Registration Model

Accounts use application-generated `acct_` UUID identifiers. Registration stores normalized email, E.164-compatible mobile number, ISO country code, account status, verification timestamps, Terms acceptance, optional marketing consent, and timestamps. New accounts begin in `PENDING_EMAIL_VERIFICATION`. Password credentials are stored in a separate one-to-one table.

## Password Policy and Hashing

Passwords require at least 8 Unicode code points and no more than 1,024 UTF-8 bytes. Passwords are not trimmed or composition-filtered. Hashing uses Web Crypto PBKDF2-HMAC-SHA-256 with a random 128-bit salt, 600,000 iterations, and a 256-bit derived key. Stored encodings include the algorithm and work factor. Unknown-email login performs a dummy derivation to reduce timing-based enumeration.

## Email Verification

Verification tokens are generated with Web Crypto randomness, stored only as SHA-256 hashes, expire after 24 hours, and are single-use. Resend is limited to one token per account per 60 seconds; issuing a new token supersedes an unused prior token. Outbound email delivery is not implemented in this checkpoint.

## Sessions and Login Protection

Sessions store only SHA-256 hashes of random 256-bit tokens and expire after seven days. The plaintext token is issued in an `HttpOnly; SameSite=Lax` cookie scoped to `/api/accounts`, with `Secure` enabled for HTTPS. Session lookup requires an unexpired, unrevoked session and an active, verified account.

Login attempts are rate-limited by hashed email and client-IP scopes to ten attempts per 15-minute window. Successful login clears the relevant counters, and stale counters are pruned after 24 hours.

## Forgot and Reset Password

Forgot-password responses are generic. Reset tokens are stored as SHA-256 hashes, expire after 45 minutes, and are limited to one issue per account per 60 seconds. Email/IP request limits allow ten attempts per 15-minute window. Issuing a replacement supersedes unused reset tokens. Reset consumes the token, replaces the PBKDF2 credential, and revokes all account sessions in one D1 batch; it does not create a new session.

## Migrations

- `0001_accounts.sql` creates accounts, password credentials, and identity constraints.
- `0002_email_verification_tokens.sql` creates email verification tokens and lookup indexes.
- `0003_account_sessions.sql` creates account sessions, expiry/account indexes, and login rate-limit storage.
- `0004_password_reset_tokens.sql` creates password-reset tokens, lifecycle constraints, and account/purpose/created and expiry indexes.

All four migrations are applied to the remote `billiontalks-accounts` D1 database, with no pending migrations.

## Validation and Boundaries

- `npm test`: 148 tests passed across 6 files.
- `npm run typecheck`: passed for application and tests.
- `npm run build`: passed using Wrangler dry-run; no Worker deployment was performed.
- No UI or outbound email delivery is included yet.
- No production accounts, sessions, or reset tokens were created.
- V0 meeting, admission, realtime media, reconnect, screen sharing, recording, chat, SFU, and R2 behavior remains untouched.
- DNS, secrets, `.env`, `.vscode`, and local configuration remain untouched.