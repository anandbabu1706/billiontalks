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
export class JobsError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
export function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new JobsError(400, "invalid_identifier");
  return value;
}
export const DAY = 86_400_000;
