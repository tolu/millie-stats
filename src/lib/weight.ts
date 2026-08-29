// Weight over time, and the interpolation that fills the days between.
//
// Weight is unlike the symptom flags: a day nobody weighed her still had a
// weight, and it sat somewhere between the measurements either side. So unlike
// `trends.ts`, which refuses to draw across a gap because an unlogged day is
// genuinely unknown, this module does interpolate — but the chart draws the
// measured points as dots, so the difference between observed and inferred
// survives to the eye.
//
// Beyond the first and last measurement it extends flat rather than
// continuing the slope. Projecting a trend past the last real number is how a
// chart invents weight loss that never happened.

import { diffDays } from "./date";
import { isWeight, roundKg } from "./entry";
import type { DayEntry } from "./entry";

/**
 * Her normal weight, the line everything is read against. Fixed on purpose:
 * a baseline that drifts with the data is not a baseline. Change it here if
 * she settles at a different normal.
 *
 * It is a REFERENCE only, never a data point. Seeding the series at 16 before
 * the first measurement would draw a fake ramp from 16 up to whatever she
 * actually weighed.
 */
export const BASELINE_KG = 16;

type EntriesByDay = ReadonlyMap<string, DayEntry>;

export type Measurement = { readonly day: string; readonly kg: number };

export type WeightPoint = {
  readonly day: string;
  /** Always a real number: a view only exists when something is known. */
  readonly kg: number;
  /** True only where she was actually put on the scale. */
  readonly measured: boolean;
};

export type WeightView = {
  readonly points: readonly WeightPoint[];
  /**
   * The most recent real measurement behind this view. May predate the window
   * — the readout shows its date, so an old number never reads as a new one.
   */
  readonly latest: Measurement;
};

/** A measurement placed on the window's index axis; the anchor sits negative. */
type Known = { readonly offset: number; readonly kg: number; readonly measured: boolean };

/**
 * One point per day in `days`, or null when nothing has ever been measured —
 * in which case the caller shows an empty state rather than a flat baseline
 * that would look like data.
 *
 * `anchor` is the latest measurement strictly before the window, fetched
 * separately. It carries its DAY, not just its weight: without the date there
 * is nothing to interpolate against, and the line would sit flat and then drop
 * vertically in a single day — a cliff that never happened, drawn on a chart a
 * vet may read.
 */
export function weightView(
  days: readonly string[],
  entries: EntriesByDay,
  anchor: Measurement | null,
): WeightView | null {
  const start = days[0];
  if (start === undefined) return null;

  const known: Known[] = [];
  let latest: Measurement | null = null;

  if (anchor && anchor.day < start && isWeight(anchor.kg)) {
    // Negative offset: a real position on the same axis, so the run up to the
    // first in-window measurement is a slope like any other.
    known.push({ offset: diffDays(start, anchor.day), kg: anchor.kg, measured: false });
    latest = anchor;
  }

  days.forEach((day, index) => {
    const kg = entries.get(day)?.weight;
    if (kg === undefined) return;
    known.push({ offset: index, kg, measured: true });
    latest = { day, kg };
  });

  if (!latest || known.length === 0) return null;

  // One pass with a cursor: `known` is already ascending by offset.
  let cursor = 0;
  const points = days.map((day, index): WeightPoint => {
    while (cursor + 1 < known.length && known[cursor + 1]!.offset <= index) cursor++;
    const left = known[cursor]!;
    const right = known[cursor + 1];

    if (left.offset === index && left.measured) return { day, kg: left.kg, measured: true };
    // Before the first measurement, or after the last: flat, never sloped.
    if (index < left.offset || !right) return { day, kg: left.kg, measured: false };

    const ratio = (index - left.offset) / (right.offset - left.offset);
    return { day, kg: left.kg + (right.kg - left.kg) * ratio, measured: false };
  });

  return { points, latest };
}

/** Norwegian decimals use a comma. "16,4" */
export function formatKg(kg: number): string {
  return kg.toFixed(1).replace(".", ",");
}

/**
 * Reads what someone typed into the weight field.
 *
 * Accepts both "16,4" and "16.4": Norwegian writes decimals with a comma, but
 * a phone keyboard's decimal key produces whichever the locale feels like, and
 * `<input type="number">` silently reports an empty string for the one it does
 * not like. Parsing text ourselves is the only way to accept both.
 */
export function parseKg(input: string): number | null {
  const text = input.trim().replace(",", ".");
  if (text === "") return null;
  const kg = Number(text);
  return isWeight(kg) ? roundKg(kg) : null;
}
