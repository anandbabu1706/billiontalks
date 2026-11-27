# EP-06 company and recruiter management

The local Jobs workspace at /jobs/companies supports free registration, profile edits, explicit company selection, invitations, role changes and revocation. Sign in with an email-verified synthetic account and complete the existing Jobs eligibility attestation. Company details are self-reported.

Use npm run jobs:dev -- --enable-jobs. The launcher supplies the existing synthetic_candidate session. API tests seed several distinct email-verified synthetic identities to exercise invitation handoff. An inviter receives an ID and token once. The intended recipient pastes the combined code in the Companies workspace while signed in to the verified recipient account. Codes expire after seven days. The local flow sends no mail. Treat recipient hashes as personal data if this design is extended to real accounts.

Company commands verify tenant, actor, role and current company revision in the same database statement as the change and audit event. Owners appoint administrators. Administrators manage recruiters. Removal revokes membership and clears listing assignments. Owner membership is protected by database triggers. The owner must remain enrolled while the company exists. Ownership transfer, company retirement and recovery require a future approved policy.

A moderator can restrict a company through the scoped API. Restriction blocks recruiting actions and removes that company as a basis for candidate discovery. Eligible users can submit a reason-coded company report. Operational review, appeals, production invitation delivery and retention procedures remain release dependencies.

The entitlement endpoint exposes the EP-04 free plan and existing quota counters for EP-07. Reuse the tenant guard and PostingQuota service when adding posting screens and APIs. Profile projection and application assignment remain separate access decisions.

Run npm run typecheck and npm run test:jobs. The committed evidence records the full suite and development file inventory. Automated dashboard checks use JSDOM and the local Worker. Device layout and assistive technology qualification remain pending.

Additional cash expenditure was INR 0.
