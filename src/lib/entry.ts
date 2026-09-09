// The stored shape of one day, and the JSON boundary around it.
//
// Storage rule that everything else depends on: the EXISTENCE of a row means
// the day was logged. A row whose flags are all false is a logged day on which
// nothing happened — meaningfully different from a day with no row at all,
// which means nobody filled it in. The charts and the AI summary both rely on
// that distinction, so serialization must never invent or drop rows.

export type DayEntry = {
  /** Only true flags are stored; a missing key means unchecked. */
  readonly flags: Readonly<Record<string, boolean>>;
  readonly note: string;
  /**
   * Kilos, one decimal. Absent means she was not weighed that day — which is
   * not the same as weighing nothing, so the key is omitted rather than
   * written as 0. At most one measurement per day.
   */
  readonly weight?: number;
  /**
   * Workouts done that day, keyed by workout id (a uuid from the `workouts`
   * table, written here and never changed). Only `true` is stored and the key
   * is absent when nothing was done, like `weight`.
   *
   * Two states, not three. A symptom on an unlogged day is unknown, but a
   * workout on an unlogged day is a missed session: the weekly target is a
   * count, and a day nobody ticked was a day it was not done. Ticking a
   * never-logged day creates its row — the same accepted cost as a weight.
   */
  readonly workouts?: Readonly<Record<string, true>>;
};

export const EMPTY_ENTRY: DayEntry = { flags: {}, note: "" };

export function isFlagged(entry: DayEntry, symptomId: string): boolean {
  return entry.flags[symptomId] === true;
}

export function withFlag(entry: DayEntry, symptomId: string, on: boolean): DayEntry {
  const flags: Record<string, boolean> = { ...entry.flags };
  if (on) flags[symptomId] = true;
  else delete flags[symptomId];
  // Spread rather than rebuilding from named fields: the earlier form listed
  // flags and note explicitly, so adding `weight` to the type silently made
  // ticking a box erase that day's weight.
  return { ...entry, flags };
}

export function withNote(entry: DayEntry, note: string): DayEntry {
  return { ...entry, note };
}

/** Generous bounds. This rejects nonsense, it does not diagnose a dog. */
const MIN_KG = 0.1;
const MAX_KG = 200;

/** Kilos are entered by hand and read back out of JSON; both can be junk. */
export function isWeight(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= MIN_KG && value <= MAX_KG;
}

/** Scales read to a gram; storing more decimals than that is false precision. */
export function roundKg(kg: number): number {
  return Math.round(kg * 10) / 10;
}

/** Sets or, with null, clears the day's weight. */
export function withWeight(entry: DayEntry, kg: number | null): DayEntry {
  if (kg === null || !isWeight(kg)) {
    // Deleted rather than set to undefined, so a cleared weight and a day that
    // never had one are the same object, and serialize identically.
    const next: { flags: DayEntry["flags"]; note: string; weight?: number } = { ...entry };
    delete next.weight;
    return next;
  }
  return { ...entry, weight: roundKg(kg) };
}

export function isWorkoutDone(entry: DayEntry, workoutId: string): boolean {
  return entry.workouts?.[workoutId] === true;
}

/** The ids of the workouts done that day, in stored order. */
export function workoutsDone(entry: DayEntry): string[] {
  return Object.keys(entry.workouts ?? {});
}

/** Ticks or unticks one workout for the day. */
export function withWorkout(entry: DayEntry, workoutId: string, done: boolean): DayEntry {
  const workouts: Record<string, true> = { ...entry.workouts };
  if (done) workouts[workoutId] = true;
  else delete workouts[workoutId];
  if (Object.keys(workouts).length === 0) {
    // Deleted rather than left empty, so a day whose last tick was cleared and
    // a day that never had one serialize identically.
    const next: { flags: DayEntry["flags"]; note: string; weight?: number; workouts?: Readonly<Record<string, true>> } = { ...entry };
    delete next.workouts;
    return next;
  }
  return { ...entry, workouts };
}

/** True when the day carries no information at all. */
export function isBlank(entry: DayEntry): boolean {
  return entry.note.trim() === "" && Object.keys(entry.flags).length === 0 &&
    entry.weight === undefined && workoutsDone(entry).length === 0;
}

/** Drops false flags and trims the note, so stored rows stay minimal. */
export function serializeEntry(entry: DayEntry): string {
  const flags: Record<string, true> = {};
  for (const [id, on] of Object.entries(entry.flags)) {
    if (on) flags[id] = true;
  }
  // The weight key is omitted entirely when unset, so a day without one
  // serializes byte-for-byte as it did before weights existed.
  const out: { flags: typeof flags; note: string; weight?: number; workouts?: Record<string, true> } = {
    flags,
    note: entry.note.trim(),
  };
  if (isWeight(entry.weight)) out.weight = roundKg(entry.weight);
  const workouts = onlyTrue(entry.workouts);
  if (workouts) out.workouts = workouts;
  return JSON.stringify(out);
}

/**
 * Tolerant by design: a corrupt or half-written row must degrade to an empty
 * day rather than throw, or one bad record takes the whole journal down.
 */
export function parseEntry(json: string): DayEntry {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return EMPTY_ENTRY;
  }
  if (typeof raw !== "object" || raw === null) return EMPTY_ENTRY;

  const record = raw as Record<string, unknown>;
  const flags: Record<string, boolean> = {};
  const rawFlags = record["flags"];
  if (typeof rawFlags === "object" && rawFlags !== null) {
    for (const [id, on] of Object.entries(rawFlags as Record<string, unknown>)) {
      if (on === true) flags[id] = true;
    }
  }
  const note = typeof record["note"] === "string" ? record["note"] : "";
  // A junk weight is dropped rather than thrown on, same as a junk flag: one
  // bad row must not take the journal down.
  const rawWeight = record["weight"];
  const workouts = onlyTrue(record["workouts"]);
  const out: { flags: typeof flags; note: string; weight?: number; workouts?: Record<string, true> } = {
    flags,
    note,
  };
  if (isWeight(rawWeight)) out.weight = roundKg(rawWeight);
  if (workouts) out.workouts = workouts;
  return out;
}

/**
 * The `true`-only map behind both flags and workouts: keeps the keys whose
 * value is exactly `true`, and returns undefined rather than an empty object
 * so callers can omit the key. Junk (a string, an array, `1`) yields nothing.
 */
function onlyTrue(raw: unknown): Record<string, true> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const out: Record<string, true> = {};
  for (const [id, on] of Object.entries(raw as Record<string, unknown>)) {
    if (on === true) out[id] = true;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
