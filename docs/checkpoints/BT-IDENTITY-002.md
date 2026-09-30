# BT-IDENTITY-002 - Profile Management

Date: 2026-09-30.

## Scope

This checkpoint adds secure authenticated profile management for the existing account foundation. `GET /api/accounts/me` remains available, and authenticated users can use `PATCH /api/accounts/me` to update only:

- full name
- country
- mobile number
- marketing consent

Account ID, email, email verification status, mobile verification status, account status, and future plan or entitlement data remain read-only or unimplemented. Email changes are not supported; a future email-change flow must be separate and require re-verification.

## Authentication and Ownership

The PATCH handler resolves the existing account session before parsing or applying the update. The repository update is keyed by the resolved account ID, so request bodies cannot select another account. Invalid, missing, expired, revoked, or otherwise unusable sessions are rejected.

Responses use the existing safe public account projection. Password credentials, password hashes, token hashes, session hashes, reset tokens, and internal rate-limit records are never returned.

## Validation Rules

- Updates are partial, but the request must contain at least one supported field.
- Full names are NFC-normalized, trimmed, non-empty, control-character-free, and limited to 200 Unicode code points.
- Country values are normalized to uppercase and validated as ISO 3166-1 alpha-2 codes.
- Mobile numbers are normalized to compact international E.164 format and must remain present at the account level; clearing is not allowed.
- Marketing consent must be an explicit boolean when supplied.
- Unknown or immutable fields, including email, are rejected rather than silently ignored.

## Mobile Uniqueness and Verification

The existing unique D1 constraint on normalized mobile numbers enforces account-level uniqueness. Duplicate mobile updates return a conflict without changing the account. When the normalized mobile number changes, `mobile_verified_at` is reset to `NULL`. SMS verification is not implemented in this checkpoint.

## Persistence

No migration was required. The existing `accounts` table already contains the editable profile fields, mobile uniqueness constraint, mobile verification timestamp, marketing consent fields, and `updated_at`. The update is persisted through the existing D1 repository boundary.

## Validation Baseline and Boundaries

- `npm test`: 162 tests passed across 6 files.
- `npm run typecheck`: passed for application and tests.
- `npm run build`: passed using Wrangler dry-run; no Worker deployment was performed.
- No UI has been added yet.
- V0 meeting, admission, realtime media, reconnect, screen sharing, recording, chat, SFU, and R2 behavior remains untouched.
- DNS, secrets, `.env`, `.vscode`, and local configuration remain untouched.