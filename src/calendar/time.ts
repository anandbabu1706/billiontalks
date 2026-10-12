export type CalendarView = "month" | "week" | "day";

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function dateKeyInTimeZone(instant: string | number | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function addCalendarDays(dateKey: string, amount: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}

export function monthGridDates(dateKey: string): string[] {
  const [year, month] = dateKey.split("-").map(Number);
  const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
  const weekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const start = addCalendarDays(firstDay, -weekday);
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(start, index));
}

export function weekDates(dateKey: string, weekStartsOn = 0): string[] {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const offset = (weekday - weekStartsOn + 7) % 7;
  const start = addCalendarDays(dateKey, -offset);
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(start, index));
}

export function formatMeetingTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(new Date(instant));
}
