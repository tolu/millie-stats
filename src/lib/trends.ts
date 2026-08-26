// Trend maths for the 30/90-day charts.
//
// The rule that governs all of it: an unlogged day is `null`, never 0. A gap
// in the journal is missing information, not a good day. Averaging over gaps
// as if they were zeros would quietly flatter every trend — exactly the wrong
// direction for a symptom tracker.

import type { DayEntry } from "./entry";
import { isFlagged } from "./entry";

/** 1 = happened, 0 = logged and did not happen, null = not logged. */
export type Presence = 1 | 0 | null;

export type EntriesByDay = ReadonlyMap<string, DayEntry>;

export function presenceOn(
  day: string,
  entries: EntriesByDay,
  symptomId: string,
): Presence {
  const entry = entries.get(day);
  if (!entry) return null;
  return isFlagged(entry, symptomId) ? 1 : 0;
}

export function seriesFor(
  days: readonly string[],
  entries: EntriesByDay,
  symptomId: string,
): Presence[] {
  return days.map((day) => presenceOn(day, entries, symptomId));
}

/**
 * Trailing mean over the last `window` days, counting only logged days.
 * Returns null for a position whose whole window is unlogged — there is
 * nothing to average, and drawing a 0 there would be a lie.
 */
export function rollingAverage(
  series: readonly Presence[],
  window: number,
): (number | null)[] {
  if (window <= 0) throw new Error(`Window must be positive, got ${window}`);
  return series.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    let sum = 0;
    let logged = 0;
    for (let j = start; j <= i; j++) {
      const value = series[j];
      if (value === null || value === undefined) continue;
      sum += value;
      logged++;
    }
    return logged === 0 ? null : sum / logged;
  });
}

export type SymptomStats = {
  readonly symptomId: string;
  readonly hits: number;
  readonly loggedDays: number;
  /** Share of LOGGED days with a hit. null when nothing was logged. */
  readonly rate: number | null;
};

export function statsFor(
  days: readonly string[],
  entries: EntriesByDay,
  symptomId: string,
): SymptomStats {
  let hits = 0;
  let loggedDays = 0;
  for (const day of days) {
    const value = presenceOn(day, entries, symptomId);
    if (value === null) continue;
    loggedDays++;
    if (value === 1) hits++;
  }
  return {
    symptomId,
    hits,
    loggedDays,
    rate: loggedDays === 0 ? null : hits / loggedDays,
  };
}

export type Coverage = {
  readonly logged: number;
  readonly total: number;
  /** 0..1, or null for an empty range. */
  readonly ratio: number | null;
};

/** How much of the period was actually filled in. Reported to the AI too. */
export function coverage(days: readonly string[], entries: EntriesByDay): Coverage {
  let logged = 0;
  for (const day of days) if (entries.has(day)) logged++;
  return {
    logged,
    total: days.length,
    ratio: days.length === 0 ? null : logged / days.length,
  };
}
