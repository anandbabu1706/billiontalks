# BillionJobs AI-ready capability roadmap

This register records owner-approved product direction from EP-08, not permission to activate providers, transfer applicant data or make automated decisions. `FOUNDATION IMPLEMENTED` means only the named non-AI/local contract foundation exists. `PROPOSED` requires a separately authorized milestone with purpose, consent, legal/security/cost review, evaluation, provenance, human oversight and fallback.

| ID | Capability | Status and boundary |
|---|---|---|
| BJ-AI-001 | Explainable job-to-profile matching | FOUNDATION IMPLEMENTED: deterministic disclosed-field rules, unknown handling and configurable weights; no AI or automatic action. |
| BJ-AI-002 | Natural-language candidate search | PROPOSED: translate intent into visible-field filters; recruiter confirms the query and results remain permission-scoped. |
| BJ-AI-003 | Job-description assistance | PROPOSED: bounded drafting from employer inputs; human approval and bias/claim checks required. |
| BJ-AI-004 | Professional-profile assistance | PROPOSED: candidate-controlled drafting; never silently change or publish profile data. |
| BJ-AI-005 | Résumé assistance | DEFERRED: résumé upload/storage is excluded; future processing requires file-safety, consent and retention design. |
| BJ-AI-006 | Candidate interview preparation | CONTRACT FOUNDATION IMPLEMENTED: purpose-specific provider-neutral boundary plus deterministic checklist; AI coaching remains proposed and candidate-controlled. |
| BJ-AI-007 | Interview-question generation | CONTRACT FOUNDATION IMPLEMENTED: purpose-specific boundary plus deterministic job-relevant templates; generated questions require later provider authorization, human review and prohibited-topic safeguards. |
| BJ-AI-008 | Consent-based interview summaries | PROPOSED after recording/transcript authorization: participant consent, provenance, corrections and strict access required. |
| BJ-AI-009 | Recruiter assistance | CONTRACT FOUNDATION IMPLEMENTED: provider-neutral purpose/authorization/output boundary; no provider configured. |
| BJ-AI-010 | Candidate follow-up automation | PROPOSED: candidate-visible, opt-out, rate-limited and human-controlled; no external messaging in EP-08. |
| BJ-AI-011 | Recruitment analytics assistance | NON-AI FOUNDATION IMPLEMENTED: event-derived metrics and explicit denominators; narrative/predictive AI remains proposed. |
| BJ-AI-012 | Skill-gap explanations | CONTRACT FOUNDATION IMPLEMENTED: provider-neutral purpose only; future output must explain disclosed gaps as unknown/partial evidence, never a hidden rejection rule. |
| BJ-AI-013 | Career-development guidance | PROPOSED candidate-controlled feature; separate from employer selection decisions. |
| BJ-AI-014 | Fraud and abuse prevention | PROPOSED decision support only; human review, appeal and evidence limits required. |
| BJ-AI-015 | Multilingual assistance | PROPOSED: preserve meaning, source text and correction path; do not infer protected traits. |
| BJ-AI-016 | Recruitment agents | DEFERRED: no autonomous sourcing, outreach, screening, scheduling or status changes without new explicit approval. |
| BJ-AI-017 | Candidate job recommendations | PROPOSED opt-in feature using disclosed preferences; explanation and user controls required. |
| BJ-AI-018 | Recruiter candidate recommendations | PROPOSED: assignment/visibility scoped, explainable and human-reviewed; no automatic ranking decision. |
| BJ-AI-019 | Model governance and evaluation | PROPOSED prerequisite: versioned evaluations, drift/bias monitoring, incident rollback, usage/cost limits and audit retention. |
| BJ-AI-020 | Shared BillionAI integration | DEFERRED: independent product boundary, consent, service authorization, data minimization and fallback required before connection. |

The shared extension contract may be reused only when the specific capability is authorized. It is not a generic channel for sending profiles, applications, notes, interviews or Meetings data to a model.

EP-10 also registers purpose-limited contracts for interviewer assistance, multilingual interview assistance, consent-dependent summaries and feedback assistance. These interfaces do not configure a provider or authorize recording, transcription, data transfer, automated assessment, facial/emotion/personality inference or employment decisions. BJ-AI-008 remains proposed because no interview content is captured.
