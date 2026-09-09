// Weekly workouts: what one is, when it applies, and how a week scores.
//
// Pure calendar logic shared by the day view, the charts and the server's
// validation. Nothing here reads a signal or a database.
//
// Two states, not three. A symptom on an unlogged day is unknown, but a
// workout on an unlogged day is a missed session: the target is a count of
// days it was done, and a day nobody ticked was not one of them. The only
// "not counted" state is a whole week outside the workout's start and end,
// which is null so a chart can leave it blank rather than draw a zero.

import type { DayEntry } from "./entry";
import { isWorkoutDone } from "./entry";
import type { EntriesByDay } from "./trends";
import { addDays, isDay, startOfWeek } from "./date";

export type Workout = {
  /** A uuid. Written into days.data, so it can never change. */
  readonly id: string;
  readonly name: string;
  /** Multi-line instructions, shown while doing it. */
  readonly description: string;
  /** Target days per calendar week, 1–7: a day is done or not done. */
  readonly perWeek: number;
  /** First day it applies. Days before it do not show the workout. */
  readonly startDay: string;
  /** Last day it applies, inclusive. Null while it is still going. */
  readonly endDay: string | null;
};

export const MAX_NAME = 80;
export const MAX_DESCRIPTION = 2000;
export const MAX_PER_WEEK = 7;

/** Whether the workout shows on, and counts for, this day. */
export function isActiveOn(workout: Workout, day: string): boolean {
  return workout.startDay <= day && (workout.endDay === null || day <= workout.endDay);
}

export type WeekProgress = {
  readonly done: number;
  readonly target: number;
};

/** How many of the given days the workout was done on, against its target. */
export function weekProgress(
  workout: Workout,
  days: readonly string[],
  entries: EntriesByDay,
): WeekProgress {
  let done = 0;
  for (const day of days) {
    if (!isActiveOn(workout, day)) continue;
    const entry: DayEntry | undefined = entries.get(day);
    if (entry && isWorkoutDone(entry, workout.id)) done++;
  }
  return { done, target: workout.perWeek };
}

export type WeekBar = (WeekProgress & { readonly weekStart: string }) | null;

/**
 * One entry per calendar week the days touch, in order. Null for a week that
 * lies entirely before the start day or after the end day — not counted,
 * as opposed to counted and found wanting.
 */
export function weeklySeries(
  workout: Workout,
  days: readonly string[],
  entries: EntriesByDay,
): WeekBar[] {
  const weeks = new Map<string, string[]>();
  for (const day of days) {
    const start = startOfWeek(day);
    const bucket = weeks.get(start);
    if (bucket) bucket.push(day);
    else weeks.set(start, [day]);
  }
  return [...weeks].map(([weekStart, weekDays]) => {
    const weekEnd = addDays(weekStart, 6);
    const outside =
      weekEnd < workout.startDay || (workout.endDay !== null && workout.endDay < weekStart);
    if (outside) return null;
    return { weekStart, ...weekProgress(workout, weekDays, entries) };
  });
}

export type WorkoutInput = {
  readonly name: string;
  readonly description: string;
  readonly perWeek: number;
  readonly startDay: string;
};

/**
 * Checks and normalises what the form sends. Returned rather than thrown so
 * the message reaches the dialog: a thrown error arrives as "Internal Server
 * Error".
 */
export function validateWorkout(
  input: WorkoutInput,
): { ok: true; value: WorkoutInput } | { ok: false; message: string } {
  const name = input.name.trim();
  if (name === "") return { ok: false, message: "Øvelsen trenger et navn" };
  if (name.length > MAX_NAME) {
    return { ok: false, message: `Navnet kan være høyst ${MAX_NAME} tegn` };
  }
  const description = input.description.trim();
  if (description.length > MAX_DESCRIPTION) {
    return { ok: false, message: `Beskrivelsen kan være høyst ${MAX_DESCRIPTION} tegn` };
  }
  const perWeek = input.perWeek;
  if (!Number.isInteger(perWeek) || perWeek < 1 || perWeek > MAX_PER_WEEK) {
    return { ok: false, message: `Ganger i uka må være et helt tall fra 1 til ${MAX_PER_WEEK}` };
  }
  if (!isDay(input.startDay)) return { ok: false, message: "Startdatoen er ikke en gyldig dato" };
  return { ok: true, value: { name, description, perWeek, startDay: input.startDay } };
}
