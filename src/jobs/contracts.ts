/** Jobs never receives the host environment or Meetings capabilities. */
export type Identity = { subject: string; recipientHash?: string };
export type IdentityResolver = (request: Request) => Promise<Identity | null>;
export type Statement = {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};
export type JobsDatabase = { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown[]> };
/** Versioned anti-corruption boundary. Jobs receives opaque meeting references only. */
export type InterviewMeetingActivation = {
  interviewRef: string; title: string; hostSubject: string; participantSubjects: string[];
};
export interface MeetingsAdapterV1 {
  readonly version: "billiontalks-meetings.v1";
  activate(input: InterviewMeetingActivation): Promise<{ meetingRef: string; joinPath: string }>;
  authorizeJoin(meetingRef: string, interviewRef: string, subject: string, displayName: string): Promise<{ joinPath: string }>;
  revoke(meetingRef: string, interviewRef: string, hostSubject: string): Promise<void>;
}
export class JobsError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
export function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new JobsError(400, "invalid_identifier");
  return value;
}
export const DAY = 86_400_000;
