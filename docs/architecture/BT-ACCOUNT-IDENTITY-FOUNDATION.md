# BillionTalks Account and Identity Foundation

## Persistence recommendation

Use a dedicated Cloudflare D1 database for accounts. Accounts are globally queried by normalized email and E.164-compatible mobile number, and D1 unique constraints make those identities race-safe. Relational tables also fit profile lookup and future account-to-entitlement relationships; SQL migrations are manageable at this stage. D1 is a better fit than putting account records in meeting Durable Objects, which are partitioned around meeting IDs and do not provide global uniqueness or convenient cross-meeting profile queries.

The account module provides registration, email verification, login, authenticated account lookup, logout, and password-reset APIs through D1 repository boundaries. Verification tokens are generated with Web Crypto randomness, stored only as SHA-256 hashes, expire after 24 hours, and are single-use. Resend is rate-limited to one issue per account per 60 seconds; issuing a token supersedes prior unused tokens. Password-reset tokens are also stored as SHA-256 hashes, expire after 45 minutes, and can be issued at most once per account per 60 seconds; request limits additionally allow ten email/IP-scoped attempts per 15 minutes. Issuing a replacement supersedes unused reset tokens. Forgot-password responses are generic, and outbound email delivery is not implemented.

Account sessions store only the SHA-256 hash of a random 256-bit token and have a fixed seven-day expiry. The plaintext token is issued only in an `HttpOnly; SameSite=Lax` cookie scoped to `/api/accounts`, with `Secure` on HTTPS. Login attempt counters use SHA-256 hashes of email and client IP scopes, permit ten attempts per 15-minute window, and are cleared on successful login; stale counters are pruned after 24 hours. Password verification performs a dummy PBKDF2 derivation when an email has no account to reduce timing-based enumeration. Session resolution requires an unexpired, unrevoked session and an active, verified account. The current account work has not changed meeting Durable Objects, R2, or SFU configuration.

Password reset consumes the token, replaces the PBKDF2 password hash, and revokes all account sessions in one D1 batch. A reset does not create a new login session.

## Account model

`accounts.id` is an application-generated `acct_` UUID, independent of mutable contact details. The account row stores the normalized email, E.164-compatible mobile number, ISO 3166-1 alpha-2 country code, status, email/mobile verification timestamps, Terms version and acceptance timestamp, optional marketing consent value and timestamp, and creation/update timestamps. New accounts start as `PENDING_EMAIL_VERIFICATION`; verification itself is not implemented in this pass.

Password credentials live in a separate one-to-one table. Entitlements should be separate account-linked records, allowing future Free/Premium entitlement history without putting billing state on identity rows. Billing is not implemented here.

## Security and boundaries

The account module is independent of meeting and SFU modules. Its service validates and normalizes registration data, hashes the password, and passes only the public account model plus the hash to the repository. Repository lookup selects only public account columns. A duplicate email or mobile conflict has one generic identity-conflict error; callers should use similarly generic registration responses. Passwords and hashes must never be logged or included in API responses.

Password hashing uses Web Crypto PBKDF2-HMAC-SHA-256, a random 128-bit salt, 600,000 iterations, and a 256-bit derived key. PBKDF2 is available in Cloudflare Workers Web Crypto. The encoded hash carries its algorithm and work factor so a future migration can rehash on successful authentication. Password verification and authentication are outside this pass. Passwords are not trimmed or composition-filtered; validation requires at least 8 Unicode code points and caps UTF-8 input at 1,024 bytes to bound resource use.

Email normalization trims surrounding whitespace, normalizes Unicode to NFC, lowercases the local part and domain for case-insensitive account identity, converts internationalized domains to ASCII, and does not remove dots or plus-tags. Mobile formatting accepts only explicit international numbers and stores the compact `+`-prefixed representation; it does not infer a country calling code from the separate country field. Country values are checked against ISO 3166-1 alpha-2 codes.

## Future Cloudflare resource

Create one D1 database for account data and bind it as `ACCOUNT_DB`; apply `migrations/0001_accounts.sql` through Wrangler migrations. No D1 resource ID is present yet, and no deployment or production resource change is part of this pass.