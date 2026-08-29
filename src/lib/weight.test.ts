import { describe, expect, it } from "vitest";
import { BASELINE_KG, formatKg, parseKg, weightView } from "./weight";
import type { Measurement } from "./weight";
import type { DayEntry } from "./entry";

const DAYS = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"];

function entries(byDay: Record<string, Partial<DayEntry>>): Map<string, DayEntry> {
  return new Map(
    Object.entries(byDay).map(([day, e]) => [day, { flags: {}, note: "", ...e }]),
  );
}

const kgs = (
  days: readonly string[],
  map: Map<string, DayEntry>,
  anchor: Measurement | null = null,
) => weightView(days, map, anchor)?.points.map((p) => p.kg) ?? null;

describe("weightView", () => {
  it("interpolates evenly across a gap", () => {
    expect(kgs(DAYS, entries({ "2026-08-01": { weight: 16 }, "2026-08-05": { weight: 17 } })))
      .toEqual([16, 16.25, 16.5, 16.75, 17]);
  });

  it("interpolates across an uneven gap", () => {
    expect(kgs(DAYS, entries({ "2026-08-02": { weight: 16 }, "2026-08-04": { weight: 18 } })))
      .toEqual([16, 16, 17, 18, 18]);
  });

  it("extends flat past the first and last measurement, never continuing the slope", () => {
    // Projecting the downward trend past 08-04 would draw weight loss that was
    // never observed.
    const series = kgs(DAYS, entries({ "2026-08-02": { weight: 18 }, "2026-08-04": { weight: 16 } }));
    expect(series?.[0]).toBe(18);
    expect(series?.[4]).toBe(16);
  });

  it("draws a flat line from a single measurement", () => {
    expect(kgs(DAYS, entries({ "2026-08-03": { weight: 16.4 } })))
      .toEqual([16.4, 16.4, 16.4, 16.4, 16.4]);
  });

  it("is null when she has never been weighed", () => {
    // Not the baseline: a flat 16 kg line would look like data.
    expect(weightView(DAYS, entries({ "2026-08-02": { note: "tur" } }), null)).toBeNull();
    expect(weightView([], entries({}), null)).toBeNull();
  });

  it("marks only real measurements as measured", () => {
    const view = weightView(
      DAYS,
      entries({ "2026-08-01": { weight: 16 }, "2026-08-03": { weight: 17 } }),
      null,
    );
    expect(view?.points.map((p) => p.measured)).toEqual([true, false, true, false, false]);
  });

  it("keeps one point per requested day", () => {
    const view = weightView(DAYS, entries({ "2026-08-01": { weight: 16 } }), null);
    expect(view?.points.map((p) => p.day)).toEqual(DAYS);
  });
});

describe("weightView with an anchor before the window", () => {
  const anchor: Measurement = { day: "2026-07-27", kg: 15 }; // 5 days before DAYS[0]

  it("slopes from the anchor instead of stepping off a cliff", () => {
    // The bug this replaces: the anchor's date was discarded, so the line sat
    // flat at 15 and then jumped to 17 in a single day — a fall that never
    // happened, on a chart a vet may read.
    const series = kgs(DAYS, entries({ "2026-08-03": { weight: 17 } }), anchor);
    // 2026-07-27 (15 kg) to 2026-08-03 (17 kg) is 7 days, so +2/7 per day.
    expect(series?.[0]).toBeCloseTo(15 + (2 / 7) * 5, 6);
    expect(series?.[1]).toBeCloseTo(15 + (2 / 7) * 6, 6);
    expect(series?.[2]).toBe(17);
    // Strictly rising, no vertical step anywhere.
    const steps = (series ?? []).slice(1).map((kg, i) => (kg ?? 0) - (series?.[i] ?? 0));
    expect(Math.max(...steps)).toBeLessThan(0.5);
  });

  it("never draws the anchor as a measured dot", () => {
    const view = weightView(DAYS, entries({ "2026-08-03": { weight: 17 } }), anchor);
    expect(view?.points.map((p) => p.measured)).toEqual([false, false, true, false, false]);
  });

  it("reports the anchor as the latest reading when the window holds none", () => {
    // The bug this replaces: the readout scanned only the window, found
    // nothing, and rendered a bold "0,0 kg" while the chart drew a real line.
    const view = weightView(DAYS, entries({}), anchor);
    expect(view).not.toBeNull();
    expect(view?.latest).toEqual(anchor);
    expect(kgs(DAYS, entries({}), anchor)).toEqual([15, 15, 15, 15, 15]);
  });

  it("prefers an in-window measurement as the latest reading", () => {
    const view = weightView(DAYS, entries({ "2026-08-03": { weight: 17 } }), anchor);
    expect(view?.latest).toEqual({ day: "2026-08-03", kg: 17 });
  });

  it("ignores an anchor that is not actually before the window", () => {
    const bogus: Measurement = { day: "2026-08-04", kg: 99 };
    expect(kgs(DAYS, entries({ "2026-08-01": { weight: 16 } }), bogus))
      .toEqual([16, 16, 16, 16, 16]);
  });
});

describe("formatKg", () => {
  it("uses a Norwegian decimal comma", () => {
    expect(formatKg(16)).toBe("16,0");
    expect(formatKg(16.44)).toBe("16,4");
    expect(formatKg(16.46)).toBe("16,5");
  });

  it("rounds an interpolated value to one decimal", () => {
    // Interpolation lands on values like 16.333…; the chart caption must not
    // show them at full precision.
    expect(formatKg(16 + 1 / 3)).toBe("16,3");
  });
});

describe("BASELINE_KG", () => {
  it("is fixed at her normal weight", () => {
    expect(BASELINE_KG).toBe(16);
  });
});

describe("parseKg", () => {
  it("accepts both a comma and a dot", () => {
    // The whole reason this is not <input type="number">: a Norwegian keyboard
    // offers a comma, and a number input reports "" for the separator it
    // dislikes, which reads to the user as their typing being ignored.
    expect(parseKg("16,4")).toBe(16.4);
    expect(parseKg("16.4")).toBe(16.4);
    expect(parseKg(" 16,4 ")).toBe(16.4);
    expect(parseKg("16")).toBe(16);
  });

  it("rounds to one decimal", () => {
    expect(parseKg("16,449")).toBe(16.4);
  });

  it("rejects anything that is not a weight", () => {
    for (const bad of ["", "   ", "abc", "16,4,5", "-16", "0", "1e9", "NaN", "16kg"]) {
      expect(parseKg(bad)).toBeNull();
    }
  });
});
