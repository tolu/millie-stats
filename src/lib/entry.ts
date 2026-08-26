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
};

export const EMPTY_ENTRY: DayEntry = { flags: {}, note: "" };

export function isFlagged(entry: DayEntry, symptomId: string): boolean {
  return entry.flags[symptomId] === true;
}

export function withFlag(entry: DayEntry, symptomId: string, on: boolean): DayEntry {
  const flags: Record<string, boolean> = { ...entry.flags };
  if (on) flags[symptomId] = true;
  else delete flags[symptomId];
  return { flags, note: entry.note };
}

export function withNote(entry: DayEntry, note: string): DayEntry {
  return { flags: entry.flags, note };
}

/** True when the day carries no information at all. */
export function isBlank(entry: DayEntry): boolean {
  return entry.note.trim() === "" && Object.keys(entry.flags).length === 0;
}

/** Drops false flags and trims the note, so stored rows stay minimal. */
export function serializeEntry(entry: DayEntry): string {
  const flags: Record<string, true> = {};
  for (const [id, on] of Object.entries(entry.flags)) {
    if (on) flags[id] = true;
  }
  return JSON.stringify({ flags, note: entry.note.trim() });
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
  return { flags, note };
}
