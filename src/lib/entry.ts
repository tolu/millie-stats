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

/** True when the day carries no information at all. */
export function isBlank(entry: DayEntry): boolean {
  return entry.note.trim() === "" && Object.keys(entry.flags).length === 0 &&
    entry.weight === undefined;
}

/** Drops false flags and trims the note, so stored rows stay minimal. */
export function serializeEntry(entry: DayEntry): string {
  const flags: Record<string, true> = {};
  for (const [id, on] of Object.entries(entry.flags)) {
    if (on) flags[id] = true;
  }
  // The weight key is omitted entirely when unset, so a day without one
  // serializes byte-for-byte as it did before weights existed.
  const out: { flags: typeof flags; note: string; weight?: number } = {
    flags,
    note: entry.note.trim(),
  };
  if (isWeight(entry.weight)) out.weight = roundKg(entry.weight);
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
  if (isWeight(rawWeight)) return { flags, note, weight: roundKg(rawWeight) };
  return { flags, note };
}
