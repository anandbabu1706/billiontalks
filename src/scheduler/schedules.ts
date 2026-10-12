import type { D1AccountDatabase } from "../account/repository";
import { MeetingAccessMode, type Meeting } from "../meeting";

export type ScheduledMeetingStatus = "SCHEDULED" | "STARTING" | "STARTED" | "ENDED" | "CANCELLED";

export type ScheduledMeeting = {
  id: string;
  ownerAccountId: string;
  title: string;
  agenda: string;
  localDate: string;
  localTime: string;
  durationMinutes: number;
  timeZone: string;
  startsAt: string;
  guestAccess: MeetingAccessMode;
  status: ScheduledMeetingStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ScheduledMeetingInput = {
  title: string;
  agenda: string;
  date: string;
  time: string;
  durationMinutes: number;
  timeZone: string;
  guestAccess: MeetingAccessMode;
};

type ScheduleRow = {
  meeting_id: string;
  owner_account_id: string;
  title: string;
  agenda: string;
  local_date: string;
  local_time: string;
  duration_minutes: number;
  time_zone: string;
  starts_at: string;
  guest_access: MeetingAccessMode;
  status: ScheduledMeetingStatus;
  revision: number;
  created_at: string;
  updated_at: string;
};

export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleValidationError";
  }
}

export class ScheduleConflictError extends Error {
  constructor(message = "This meeting changed. Refresh and try again.") {
    super(message);
    this.name = "ScheduleConflictError";
  }
}

function mapSchedule(row: ScheduleRow): ScheduledMeeting {
  return {
    id: row.meeting_id,
    ownerAccountId: row.owner_account_id,
    title: row.title,
    agenda: row.agenda,
    localDate: row.local_date,
    localTime: row.local_time,
    durationMinutes: row.duration_minutes,
    timeZone: row.time_zone,
    startsAt: row.starts_at,
    guestAccess: row.guest_access,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SCHEDULE_COLUMNS = `meeting_id, owner_account_id, title, agenda, local_date, local_time,
  duration_minutes, time_zone, starts_at, guest_access, status, revision, created_at, updated_at`;

function isDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
}

function dateTimeParts(instant: number, timeZone: string): number[] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const values = new Map(parts.map((part) => [part.type, Number(part.value)]));
  return [values.get("year")!, values.get("month")!, values.get("day")!, values.get("hour")!, values.get("minute")!, values.get("second")!];
}

export function resolveLocalStart(date: string, time: string, timeZone: string): string {
  if (!isDate(date)) throw new ScheduleValidationError("Choose a valid meeting date.");
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new ScheduleValidationError("Choose a valid meeting start time.");

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new ScheduleValidationError("Choose a valid IANA time zone.");
  }

  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = match.slice(1).map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const expected = [year, month, day, hour, minute, 0];
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = localAsUtc + hours * 60 * 60 * 1000;
    const parts = dateTimeParts(sample, timeZone);
    offsets.add(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]) - sample);
  }

  const candidates = [...offsets]
    .map((offset) => localAsUtc - offset)
    .filter((instant) => dateTimeParts(instant, timeZone).every((part, index) => part === expected[index]))
    .sort((left, right) => left - right);
  if (!candidates.length) {
    throw new ScheduleValidationError("That local time does not exist because the clocks move forward. Choose another time.");
  }
  return new Date(candidates[0]).toISOString();
}

export function validateScheduledMeetingInput(value: unknown, now = Date.now()): ScheduledMeetingInput & { startsAt: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ScheduleValidationError("A meeting schedule is required.");
  }
  const body = value as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (body.agenda !== undefined && typeof body.agenda !== "string") {
    throw new ScheduleValidationError("Meeting agenda must be text.");
  }
  const agenda = typeof body.agenda === "string" ? body.agenda.trim() : "";
  const date = typeof body.date === "string" ? body.date : "";
  const time = typeof body.time === "string" ? body.time : "";
  const timeZone = typeof body.timeZone === "string" ? body.timeZone.trim() : "";

  if (!title || title.length > 120 || /[\u0000-\u001f\u007f]/u.test(title)) {
    throw new ScheduleValidationError("Meeting title must be between 1 and 120 characters.");
  }
  if (agenda.length > 1000) throw new ScheduleValidationError("Meeting agenda must be 1,000 characters or fewer.");
  const durationMinutes = body.durationMinutes;
  if (typeof durationMinutes !== "number" || ![30, 45, 60, 90, 120].includes(durationMinutes)) {
    throw new ScheduleValidationError("Choose a supported meeting duration.");
  }
  if (!Object.values(MeetingAccessMode).includes(body.guestAccess as MeetingAccessMode)) {
    throw new ScheduleValidationError("Choose a supported guest-access policy.");
  }
  const startsAt = resolveLocalStart(date, time, timeZone);
  if (Date.parse(startsAt) <= now) throw new ScheduleValidationError("Meeting start time must be in the future.");

  return {
    title,
    agenda,
    date,
    time,
    durationMinutes,
    timeZone,
    guestAccess: body.guestAccess as MeetingAccessMode,
    startsAt,
  };
}

export class D1ScheduleRepository {
  constructor(private readonly database: D1AccountDatabase) {}

  async create(ownerAccountId: string, input: ScheduledMeetingInput & { startsAt: string }, now: string): Promise<ScheduledMeeting> {
    const id = `btm_${crypto.randomUUID()}`;
    await this.database.prepare(
      `INSERT INTO scheduled_meetings (
        meeting_id, owner_account_id, title, agenda, local_date, local_time, duration_minutes,
        time_zone, starts_at, guest_access, status, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', 1, ?, ?)`,
    ).bind(id, ownerAccountId, input.title, input.agenda, input.date, input.time, input.durationMinutes, input.timeZone, input.startsAt, input.guestAccess, now, now).run();
    const created = await this.getOwned(id, ownerAccountId);
    if (!created) throw new Error("The scheduled meeting could not be read after creation.");
    return created;
  }

  async getOwned(id: string, ownerAccountId: string): Promise<ScheduledMeeting | null> {
    const row = await this.database.prepare(
      `SELECT ${SCHEDULE_COLUMNS} FROM scheduled_meetings WHERE meeting_id = ? AND owner_account_id = ?`,
    ).bind(id, ownerAccountId).first<ScheduleRow>();
    return row ? mapSchedule(row) : null;
  }

  async getPublicStatus(id: string): Promise<ScheduledMeetingStatus | null> {
    const row = await this.database.prepare(
      "SELECT status FROM scheduled_meetings WHERE meeting_id = ?",
    ).bind(id).first<{ status: ScheduledMeetingStatus }>();
    return row?.status ?? null;
  }

  async listOwned(ownerAccountId: string): Promise<ScheduledMeeting[]> {
    const statement = this.database.prepare(
      `SELECT ${SCHEDULE_COLUMNS} FROM scheduled_meetings
       WHERE owner_account_id = ? ORDER BY starts_at ASC, created_at DESC`,
    ).bind(ownerAccountId);
    if (!statement.all) throw new Error("The D1 database does not support schedule listing.");
    const result = await statement.all<ScheduleRow>();
    return result.results.map(mapSchedule);
  }

  async listUpcoming(ownerAccountId: string, now: string): Promise<ScheduledMeeting[]> {
    const statement = this.database.prepare(
      `SELECT ${SCHEDULE_COLUMNS} FROM scheduled_meetings
       WHERE owner_account_id = ? AND status IN ('SCHEDULED', 'STARTING') AND starts_at >= ?
       ORDER BY starts_at ASC`,
    ).bind(ownerAccountId, now);
    if (!statement.all) throw new Error("The D1 database does not support schedule listing.");
    const result = await statement.all<ScheduleRow>();
    return result.results.map(mapSchedule);
  }

  async updateOwned(id: string, ownerAccountId: string, revision: number, input: ScheduledMeetingInput & { startsAt: string }, now: string): Promise<ScheduledMeeting> {
    const result = await this.database.prepare(
      `UPDATE scheduled_meetings SET title = ?, agenda = ?, local_date = ?, local_time = ?,
        duration_minutes = ?, time_zone = ?, starts_at = ?, guest_access = ?, revision = revision + 1, updated_at = ?
       WHERE meeting_id = ? AND owner_account_id = ? AND revision = ? AND status = 'SCHEDULED'`,
    ).bind(input.title, input.agenda, input.date, input.time, input.durationMinutes, input.timeZone, input.startsAt, input.guestAccess, now, id, ownerAccountId, revision).run() as { meta?: { changes?: number } };
    if (result.meta?.changes !== 1) throw new ScheduleConflictError();
    const updated = await this.getOwned(id, ownerAccountId);
    if (!updated) throw new Error("The updated meeting could not be read.");
    return updated;
  }

  async cancelOwned(id: string, ownerAccountId: string, revision: number, now: string): Promise<ScheduledMeeting> {
    const result = await this.database.prepare(
      `UPDATE scheduled_meetings SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
       WHERE meeting_id = ? AND owner_account_id = ? AND revision = ? AND status = 'SCHEDULED'`,
    ).bind(now, id, ownerAccountId, revision).run() as { meta?: { changes?: number } };
    if (result.meta?.changes !== 1) throw new ScheduleConflictError("This meeting can no longer be cancelled. Refresh to see its current status.");
    const cancelled = await this.getOwned(id, ownerAccountId);
    if (!cancelled) throw new Error("The cancelled meeting could not be read.");
    return cancelled;
  }

  async claimStart(id: string, ownerAccountId: string, revision: number, now: string): Promise<ScheduledMeeting> {
    const current = await this.getOwned(id, ownerAccountId);
    if (current?.status === "STARTING" && current.revision === revision) return current;
    const result = await this.database.prepare(
      `UPDATE scheduled_meetings SET status = 'STARTING', revision = revision + 1, updated_at = ?
       WHERE meeting_id = ? AND owner_account_id = ? AND revision = ? AND status = 'SCHEDULED'`,
    ).bind(now, id, ownerAccountId, revision).run() as { meta?: { changes?: number } };
    if (result.meta?.changes !== 1) throw new ScheduleConflictError("This meeting changed before it could start. Refresh and try again.");
    const starting = await this.getOwned(id, ownerAccountId);
    if (!starting) throw new Error("The meeting starting state could not be read.");
    return starting;
  }

  async markStarted(id: string, ownerAccountId: string, revision: number, now: string): Promise<ScheduledMeeting> {
    const result = await this.database.prepare(
      `UPDATE scheduled_meetings SET status = 'STARTED', revision = revision + 1, updated_at = ?
       WHERE meeting_id = ? AND owner_account_id = ? AND revision = ? AND status = 'STARTING'`,
    ).bind(now, id, ownerAccountId, revision).run() as { meta?: { changes?: number } };
    if (result.meta?.changes !== 1) {
      const current = await this.getOwned(id, ownerAccountId);
      if (current?.status === "STARTED") return current;
      throw new ScheduleConflictError("The meeting room started, but the schedule status changed. Refresh to continue.");
    }
    const started = await this.getOwned(id, ownerAccountId);
    if (!started) throw new Error("The started meeting could not be read.");
    return started;
  }

  async markEnded(id: string, now: string): Promise<void> {
    await this.database.prepare(
      `UPDATE scheduled_meetings SET status = 'ENDED', revision = revision + 1, updated_at = ?
       WHERE meeting_id = ? AND status = 'STARTED'`,
    ).bind(now, id).run();
  }
}

export async function ensureScheduledLiveRoom(
  schedule: ScheduledMeeting,
  createRoom: (input: { title: string; hostUserId: string; accessMode: MeetingAccessMode; meetingId: string }) => Promise<Meeting>,
  getRoom: (meetingId: string) => Promise<Meeting | undefined>,
): Promise<Meeting> {
  const existing = await getRoom(schedule.id);
  if (existing) {
    if (existing.hostId !== schedule.ownerAccountId) throw new ScheduleConflictError("The meeting identifier is already in use.");
    return existing;
  }
  try {
    return await createRoom({
      title: schedule.title,
      hostUserId: schedule.ownerAccountId,
      accessMode: schedule.guestAccess,
      meetingId: schedule.id,
    });
  } catch (error) {
    const raced = await getRoom(schedule.id);
    if (raced?.hostId === schedule.ownerAccountId) return raced;
    throw error;
  }
}
