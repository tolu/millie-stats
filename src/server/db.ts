"use server";

import { isDay } from "../lib/date";
import { type DayEntry, parseEntry, serializeEntry } from "../lib/entry";

// The binding is reached through a lazy dynamic import rather than a top-level
// `import { env } from "cloudflare:workers"`. Start mode's post-build step
// imports this bundle in *Node* to prerender the document shell, and Node
// cannot resolve the cloudflare: scheme at link time. Deferring it keeps the
// shell render off this path entirely.
async function db(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  return (env as unknown as { DB: D1Database }).DB;
}

export type DayRecord = {
  readonly day: string;
  readonly entry: DayEntry;
  readonly updatedAt: string;
};

/** A note longer than this is a paste accident or an attack, not a journal. */
const MAX_NOTE = 10_000;
/** Roughly two years. Guards against a range query pulling the whole table. */
const MAX_RANGE_DAYS = 750;

function assertDay(value: string, label: string): string {
  if (!isDay(value)) throw new Error(`${label} is not a calendar day`);
  return value;
}

type Row = { day: string; data: string; updated_at: string };

function toRecord(row: Row): DayRecord {
  return { day: row.day, entry: parseEntry(row.data), updatedAt: row.updated_at };
}

export async function getDay(day: string): Promise<DayRecord | null> {
  assertDay(day, "day");
  const row = await (await db())
    .prepare(`SELECT day, data, updated_at FROM days WHERE day = ?1`)
    .bind(day)
    .first<Row>();
  return row ? toRecord(row) : null;
}

/** Inclusive at both ends, ascending. Only days that were actually logged. */
export async function getRange(from: string, to: string): Promise<DayRecord[]> {
  assertDay(from, "from");
  assertDay(to, "to");
  const { results } = await (await db())
    .prepare(
      `SELECT day, data, updated_at FROM days
       WHERE day >= ?1 AND day <= ?2
       ORDER BY day ASC
       LIMIT ?3`,
    )
    .bind(from, to, MAX_RANGE_DAYS)
    .all<Row>();
  return results.map(toRecord);
}

/**
 * Upsert one day. A blank entry still writes a row on purpose: unticking
 * everything means "this day was logged and nothing happened", which is
 * different from a day nobody filled in. Callers must therefore only invoke
 * this on a real user edit, never on mere navigation.
 */
export async function saveDay(
  day: string,
  entry: DayEntry,
): Promise<{ day: string; updatedAt: string }> {
  assertDay(day, "day");
  if (entry.note.length > MAX_NOTE) {
    throw new Error(`Note is too long (${entry.note.length} characters)`);
  }
  const updatedAt = new Date().toISOString();
  await (await db())
    .prepare(
      `INSERT INTO days (day, data, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(day) DO UPDATE SET data = ?2, updated_at = ?3`,
    )
    .bind(day, serializeEntry(entry), updatedAt)
    .run();
  return { day, updatedAt };
}

/** Removes a day entirely, returning it to "never logged". */
export async function clearDay(day: string): Promise<void> {
  assertDay(day, "day");
  await (await db()).prepare(`DELETE FROM days WHERE day = ?1`).bind(day).run();
}
