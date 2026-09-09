import { describe, expect, it } from "vitest";
import { EMPTY_ENTRY, withWorkout } from "./entry";
import type { DayEntry } from "./entry";
import { isActiveOn, validateWorkout, weekProgress, weeklySeries } from "./workouts";
import type { Workout } from "./workouts";
import { rangeDays } from "./date";

const RYGG: Workout = {
  id: "rygg",
  name: "Ryggøvelser",
  description: "Sitt–stå ×10",
  perWeek: 3,
  startDay: "2026-08-31", // a Monday
  endDay: null,
};

const DONE: DayEntry = withWorkout(EMPTY_ENTRY, "rygg", true);
const OTHER: DayEntry = withWorkout(EMPTY_ENTRY, "annen", true);

function journal(pairs: Array<[string, DayEntry]>): Map<string, DayEntry> {
  return new Map(pairs);
}

describe("isActiveOn", () => {
  it("is inclusive at both ends", () => {
    const retired = { ...RYGG, endDay: "2026-09-09" };
    expect(isActiveOn(retired, "2026-08-30")).toBe(false);
    expect(isActiveOn(retired, "2026-08-31")).toBe(true);
    expect(isActiveOn(retired, "2026-09-09")).toBe(true); // retired today still shows today
    expect(isActiveOn(retired, "2026-09-10")).toBe(false);
  });

  it("runs open-ended without an end day", () => {
    expect(isActiveOn(RYGG, "2030-01-01")).toBe(true);
  });
});

describe("weekProgress", () => {
  const week = rangeDays("2026-09-07", "2026-09-13");

  it("counts only this workout's ticks", () => {
    const entries = journal([
      ["2026-09-07", DONE],
      ["2026-09-08", OTHER],
      ["2026-09-09", DONE],
    ]);
    expect(weekProgress(RYGG, week, entries)).toEqual({ done: 2, target: 3 });
  });

  it("treats an unlogged day as not done, not unknown", () => {
    // Unlike a symptom, a gap is a missed session: the target is a count.
    expect(weekProgress(RYGG, week, journal([]))).toEqual({ done: 0, target: 3 });
  });
});

describe("weeklySeries", () => {
  // Three whole weeks: 24–30 Aug (before start), 31 Aug–6 Sep, 7–13 Sep.
  const days = rangeDays("2026-08-24", "2026-09-13");

  it("skips weeks before the start and counts the rest", () => {
    const entries = journal([
      ["2026-08-25", DONE], // a tick before the start day is not counted
      ["2026-09-01", DONE],
      ["2026-09-03", DONE],
      ["2026-09-05", DONE],
    ]);
    expect(weeklySeries(RYGG, days, entries)).toEqual([
      null,
      { weekStart: "2026-08-31", done: 3, target: 3 },
      { weekStart: "2026-09-07", done: 0, target: 3 },
    ]);
  });

  it("counts a week that starts before the start day", () => {
    // Start on a Wednesday: that week still counts, from the start day on.
    const midweek = { ...RYGG, startDay: "2026-09-02" };
    const entries = journal([
      ["2026-09-01", DONE], // before the start, ignored
      ["2026-09-03", DONE],
    ]);
    expect(weeklySeries(midweek, days, entries)).toEqual([
      null,
      { weekStart: "2026-08-31", done: 1, target: 3 },
      { weekStart: "2026-09-07", done: 0, target: 3 },
    ]);
  });

  it("stops after the end day", () => {
    const retired = { ...RYGG, endDay: "2026-09-06" };
    expect(weeklySeries(retired, days, journal([]))).toEqual([
      null,
      { weekStart: "2026-08-31", done: 0, target: 3 },
      null,
    ]);
  });

  it("returns nothing for an empty window", () => {
    expect(weeklySeries(RYGG, [], journal([]))).toEqual([]);
  });
});

describe("validateWorkout", () => {
  const good = { name: " Ryggøvelser ", description: "Sitt–stå", perWeek: 3, startDay: "2026-09-09" };

  it("normalises a good input", () => {
    expect(validateWorkout(good)).toEqual({
      ok: true,
      value: { name: "Ryggøvelser", description: "Sitt–stå", perWeek: 3, startDay: "2026-09-09" },
    });
  });

  it("rejects each bad field with a message the user can act on", () => {
    const bad = (patch: Partial<typeof good>) => validateWorkout({ ...good, ...patch });
    expect(bad({ name: "  " })).toEqual({ ok: false, message: expect.stringContaining("navn") });
    expect(bad({ name: "x".repeat(81) }).ok).toBe(false);
    expect(bad({ description: "x".repeat(2001) }).ok).toBe(false);
    for (const perWeek of [0, 8, 2.5, Number.NaN]) {
      expect(bad({ perWeek })).toEqual({ ok: false, message: expect.stringContaining("1 til 7") });
    }
    expect(bad({ startDay: "2026-02-31" })).toEqual({ ok: false, message: expect.stringContaining("dato") });
  });
});
