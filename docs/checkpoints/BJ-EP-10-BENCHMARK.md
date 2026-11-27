# EP-10 interview benchmark and bounded design

Execution: EP-10 / BJ-V1-005 — Advanced Interview and Meetings Integration  
Date: 2026-11-27 (Asia/Calcutta)

## Public product benchmark

Official product documentation was reviewed for workflow patterns only. No proprietary implementation, text or interface was copied.

- LinkedIn Recruiter and Indeed support interview scheduling and candidate coordination.
- Microsoft Teams, Google Meet and Zoom demonstrate scheduled meeting, lobby/waiting-room and host-controlled admission patterns.
- Calendly demonstrates time-zone-aware availability and round-robin coordination patterns.
- Workable demonstrates structured interview kits and scorecards.
- Naukri's recruiter offering identifies interview scheduling as a recruiting workflow capability.

The bounded EP-10 design therefore uses proposed slots, explicit candidate confirmation/decline/alternative, time-zone display, panel roles, authenticated admission, structured feedback and portable UTC calendar data. It intentionally excludes external calendar synchronization, automatic scheduling, external notifications, recording, transcription and automatic hiring decisions.

## Sources reviewed

- https://www.linkedin.com/help/recruiter/answer/a416403
- https://www.linkedin.com/help/linkedin/answer/a418346
- https://www.indeed.com/help/employers/articles/how-to-use-the-indeed-scheduling-tool-to-schedule-interviews
- https://support.microsoft.com/en-us/teams/meetings/schedule-a-meeting-in-microsoft-teams
- https://support.microsoft.com/en-us/teams/meetings/using-the-lobby-in-microsoft-teams-meetings
- https://support.google.com/meet/answer/9302870
- https://support.google.com/meet/answer/16229038
- https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060700
- https://calendly.com/help/time-zones-overview
- https://calendly.com/help/round-robin-distribution-overview
- https://help.workable.com/hc/en-us/articles/115012304987-Creating-and-using-an-interview-kit-scorecard
- https://recruit.naukri.com/recruit/naukri-assist

## Product boundary

Jobs owns interview workflow, permissions, lifecycle, preparation, feedback and audit history. Meetings owns room/session behavior. The versioned adapter passes only an opaque meeting reference and an allowlist of authorized account IDs; Jobs does not read or write Meetings Durable Object state. Standalone Meetings routes and stored data retain their existing identity and behavior.

