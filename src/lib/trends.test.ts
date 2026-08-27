import { describe, expect, it } from "vitest";
import type { DayEntry } from "./entry";
import { coverage, presenceOn, rollingAverage, seriesFor, statsFor } from "./trends";

const HIT: DayEntry = { flags: { nagging: true }, note: "" };
const CLEAR: DayEntry = { flags: {}, note: "" };

function journal(pairs: Array<[string, DayEntry]>): Map<string, DayEntry> {
  return new Map(pairs);
}

describe("presence", () => {
  it("separates unlogged from logged-and-clear", () => {
    const entries = journal([
      ["2026-08-24", HIT],
      ["2026-08-25", CLEAR],
    ]);
    expect(presenceOn("2026-08-24", entries, "nagging")).toBe(1);
    expect(presenceOn("2026-08-25", entries, "nagging")).toBe(0);
    expect(presenceOn("2026-08-26", entries, "nagging")).toBe(null);
  });

  it("builds a series in the order of the days given", () => {
    const entries = journal([
      ["2026-08-24", HIT],
      ["2026-08-26", CLEAR],
    ]);
    expect(
      seriesFor(["2026-08-24", "2026-08-25", "2026-08-26"], entries, "nagging"),
    ).toEqual([1, null, 0]);
  });
});

describe("rollingAverage", () => {
  it("averages only logged days, never counting a gap as a zero", () => {
    // Two logged days, both hits, one gap between them. The honest answer is
    // 1.0 — treating the gap as a zero would report 0.67 and flatter the trend.
    expect(rollingAverage([1, null, 1], 3)).toEqual([1, 1, 1]);
  });

  it("returns null when the whole window is unlogged", () => {
    expect(rollingAverage([null, null, null], 3)).toEqual([null, null, null]);
  });

  it("uses a trailing window and ramps up at the start", () => {
    expect(rollingAverage([1, 0, 0, 0], 2)).toEqual([1, 0.5, 0, 0]);
  });

  it("drops days that fall out of the back of the window", () => {
    // With window 2, the leading 1 stops counting from index 2 onwards.
    expect(rollingAverage([1, 1, 0, 0], 2)).toEqual([1, 1, 0.5, 0]);
  });

  it("recovers the average after a gap inside the window", () => {
    expect(rollingAverage([0, null, 1], 3)).toEqual([0, 0, 0.5]);
  });

  it("rejects a nonsensical window", () => {
    expect(() => rollingAverage([1], 0)).toThrow();
  });
});

describe("statsFor", () => {
  it("rates against logged days, not calendar days", () => {
    // Three days in the range, only two logged, one of those a hit.
    // The rate is 1/2, not 1/3 — we did not observe the third day.
    const entries = journal([
      ["2026-08-24", HIT],
      ["2026-08-25", CLEAR],
    ]);
    expect(statsFor(["2026-08-24", "2026-08-25", "2026-08-26"], entries, "nagging")).toEqual({
      symptomId: "nagging",
      hits: 1,
      loggedDays: 2,
      rate: 0.5,
    });
  });

  it("reports null rather than zero when nothing was logged", () => {
    expect(statsFor(["2026-08-26"], journal([]), "nagging").rate).toBe(null);
  });
});

describe("coverage", () => {
  it("counts how much of the period was filled in", () => {
    const entries = journal([
      ["2026-08-24", HIT],
      ["2026-08-26", CLEAR],
    ]);
    expect(coverage(["2026-08-24", "2026-08-25", "2026-08-26"], entries)).toEqual({
      logged: 2,
      total: 3,
      ratio: 2 / 3,
    });
  });

  it("has no opinion about an empty range", () => {
    expect(coverage([], journal([])).ratio).toBe(null);
  });
});
