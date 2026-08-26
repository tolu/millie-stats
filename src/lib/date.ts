// Calendar-day handling, Europe/Oslo.
//
// The one genuinely dangerous operation in this app is "what day is it?".
// Everything else is calendar arithmetic on 'YYYY-MM-DD' strings, which is
// deliberately done in UTC: a calendar day is not an instant, so adding one
// day must never consult a timezone. Doing that arithmetic in local time is
// how apps lose or duplicate an entry on the two days a year the clocks move.
//
// Only osloDay() converts an instant to a day, and it delegates to Intl.

export const OSLO = "Europe/Oslo";

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const osloParts = new Intl.DateTimeFormat("en-US", {
  timeZone: OSLO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Oslo calendar date for an instant. Day boundary is midnight Oslo. */
export function osloDay(instant: Date = new Date()): string {
  const parts = osloParts.formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function isDay(value: string): boolean {
  try {
    toEpochDay(value);
    return true;
  } catch {
    return false;
  }
}

/** Days since the Unix epoch. The canonical integer form of a calendar day. */
export function toEpochDay(day: string): number {
  const m = DAY_RE.exec(day);
  if (!m) throw new Error(`Not a calendar day: ${day}`);
  const [, y, mo, d] = m;
  const epochDay = Date.UTC(Number(y), Number(mo) - 1, Number(d)) / 86_400_000;
  // Date.UTC happily rolls 2026-02-31 forward into March. A day string that
  // does not survive the round trip is not a real date, and accepting it would
  // let a bogus ?d= value become a database row key.
  if (fromEpochDay(epochDay) !== day) {
    throw new Error(`Not a calendar day: ${day}`);
  }
  return epochDay;
}

export function fromEpochDay(epochDay: number): string {
  const dt = new Date(epochDay * 86_400_000);
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(day: string, count: number): string {
  return fromEpochDay(toEpochDay(day) + count);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function diffDays(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** Every day from `from` to `to`, inclusive, ascending. Empty if reversed. */
export function rangeDays(from: string, to: string): string[] {
  const start = toEpochDay(from);
  const end = toEpochDay(to);
  const out: string[] = [];
  for (let d = start; d <= end; d++) out.push(fromEpochDay(d));
  return out;
}

/** The `count` days ending at `endDay` inclusive, ascending. */
export function lastNDays(endDay: string, count: number): string[] {
  if (count <= 0) return [];
  return rangeDays(addDays(endDay, -(count - 1)), endDay);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayIndex(day: string): number {
  return new Date(toEpochDay(day) * 86_400_000).getUTCDay();
}

export function isWeekend(day: string): boolean {
  const w = weekdayIndex(day);
  return w === 0 || w === 6;
}

const nbShort = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});
const nbLong = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});
const nbWeekdayShort = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "UTC",
  weekday: "short",
});

// Formatting reads the day back as a UTC instant on purpose — the string is
// already the Oslo calendar date, so re-interpreting it in a timezone would
// shift it.
function asUTC(day: string): Date {
  return new Date(toEpochDay(day) * 86_400_000);
}

/** "26. aug" */
export function formatShort(day: string): string {
  return nbShort.format(asUTC(day));
}

/** "onsdag 26. august" */
export function formatLong(day: string): string {
  return nbLong.format(asUTC(day));
}

/** "on." */
export function formatWeekday(day: string): string {
  return nbWeekdayShort.format(asUTC(day));
}
