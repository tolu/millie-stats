import { describe, expect, it } from "vitest";
import {
  EMPTY_ENTRY,
  isBlank,
  isFlagged,
  parseEntry,
  serializeEntry,
  withFlag,
  isWorkoutDone,
  withNote,
  withWeight,
  withWorkout,
  workoutsDone,
} from "./entry";

describe("serialization", () => {
  it("round-trips a real entry", () => {
    const entry = { flags: { nagging: true, "slow-walk": true }, note: "rolig kveld" };
    expect(parseEntry(serializeEntry(entry))).toEqual(entry);
  });

  it("stores only true flags, so unchecked and never-set are identical", () => {
    const stored = serializeEntry({ flags: { nagging: true, gnikking: false }, note: "" });
    expect(JSON.parse(stored)).toEqual({ flags: { nagging: true }, note: "" });
  });

  it("trims the note", () => {
    expect(parseEntry(serializeEntry({ flags: {}, note: "  hei  " })).note).toBe("hei");
  });

  it("keeps an all-false day distinguishable from no day at all", () => {
    // A logged day with nothing wrong still serializes to a real row. The
    // charts and the AI summary both depend on being able to tell these apart.
    const stored = serializeEntry({ flags: {}, note: "" });
    expect(stored).toBe('{"flags":{},"note":""}');
    expect(parseEntry(stored)).toEqual(EMPTY_ENTRY);
  });
});

describe("parseEntry tolerance", () => {
  it("degrades to an empty day instead of throwing", () => {
    // One corrupt row must not take down the whole journal.
    for (const bad of ["", "{", "null", "[]", '"a string"', "42"]) {
      expect(parseEntry(bad)).toEqual(EMPTY_ENTRY);
    }
  });

  it("ignores junk inside a well-formed object", () => {
    expect(parseEntry('{"flags":{"napping":"yes","x":1,"ok":true},"note":7}')).toEqual({
      flags: { ok: true },
      note: "",
    });
  });

  it("survives a missing flags object", () => {
    expect(parseEntry('{"note":"bare notat"}')).toEqual({ flags: {}, note: "bare notat" });
  });
});

describe("updates", () => {
  it("sets and clears flags immutably", () => {
    const base = EMPTY_ENTRY;
    const on = withFlag(base, "nagging", true);
    expect(isFlagged(on, "nagging")).toBe(true);
    expect(isFlagged(base, "nagging")).toBe(false);

    const off = withFlag(on, "nagging", false);
    expect(isFlagged(off, "nagging")).toBe(false);
    expect(Object.keys(off.flags)).toHaveLength(0);
  });

  it("replaces the note without touching flags", () => {
    const entry = withNote(withFlag(EMPTY_ENTRY, "gnikking", true), "notat");
    expect(entry).toEqual({ flags: { gnikking: true }, note: "notat" });
  });

  it("knows when a day carries no information", () => {
    expect(isBlank(EMPTY_ENTRY)).toBe(true);
    expect(isBlank({ flags: {}, note: "   " })).toBe(true);
    expect(isBlank({ flags: { nagging: true }, note: "" })).toBe(false);
    expect(isBlank({ flags: {}, note: "x" })).toBe(false);
  });
});

describe("weight", () => {
  it("round-trips a weighed day", () => {
    const entry = { flags: { nagging: true }, note: "veid", weight: 16.4 };
    expect(parseEntry(serializeEntry(entry))).toEqual(entry);
  });

  it("omits the key entirely when she was not weighed", () => {
    // A day without a weight must serialize byte-for-byte as it did before
    // weights existed, or every historical row would look changed.
    expect(serializeEntry({ flags: {}, note: "" })).toBe('{"flags":{},"note":""}');
    expect(parseEntry('{"flags":{},"note":""}')).toEqual(EMPTY_ENTRY);
  });

  it("never writes 0 for a day she was not weighed", () => {
    // Same rule as an unlogged day: absent is not zero.
    const cleared = withWeight({ flags: {}, note: "", weight: 16 }, null);
    expect("weight" in cleared).toBe(false);
    expect(serializeEntry(cleared)).toBe('{"flags":{},"note":""}');
  });

  it("drops a junk weight rather than throwing", () => {
    for (const bad of ['"16"', "null", "0", "-3", "1e9", "true", '{"kg":16}']) {
      const parsed = parseEntry(`{"flags":{},"note":"","weight":${bad}}`);
      expect(parsed.weight).toBeUndefined();
    }
    expect(parseEntry('{"flags":{},"note":"","weight":16.4}').weight).toBe(16.4);
  });

  it("stores at most one decimal", () => {
    expect(withWeight(EMPTY_ENTRY, 16.449).weight).toBe(16.4);
    expect(parseEntry('{"flags":{},"note":"","weight":16.46}').weight).toBe(16.5);
  });

  it("counts a weight as information, so the day is not blank", () => {
    expect(isBlank({ flags: {}, note: "", weight: 16 })).toBe(false);
    expect(isBlank(withWeight({ flags: {}, note: "", weight: 16 }, null))).toBe(true);
  });

  it("keeps the weight when a flag or the note changes", () => {
    // withFlag once rebuilt the entry from named fields, which silently erased
    // the weight the moment a checkbox was ticked.
    const weighed = { flags: {}, note: "", weight: 16.2 };
    expect(withFlag(weighed, "nagging", true).weight).toBe(16.2);
    expect(withFlag(withFlag(weighed, "nagging", true), "nagging", false).weight).toBe(16.2);
    expect(withNote(weighed, "kveldstur").weight).toBe(16.2);
  });

  it("keeps flags and the note when the weight changes", () => {
    const day = { flags: { gnikking: true }, note: "notat" };
    expect(withWeight(day, 17)).toEqual({ flags: { gnikking: true }, note: "notat", weight: 17 });
  });
});

describe("workouts", () => {
  const id = "3f1c0c2e-6d2a-4b8e-9a7d-1f0e2d3c4b5a";

  it("round-trips a day the workout was done", () => {
    const entry = { flags: { nagging: true }, note: "øvelser", workouts: { [id]: true as const } };
    expect(parseEntry(serializeEntry(entry))).toEqual(entry);
  });

  it("omits the key entirely when nothing was done", () => {
    // Same rule as weight: a day without a tick must serialize byte-for-byte
    // as it did before workouts existed.
    expect(serializeEntry({ flags: {}, note: "" })).toBe('{"flags":{},"note":""}');
    expect(parseEntry('{"flags":{},"note":""}').workouts).toBeUndefined();
  });

  it("removes the key when the last tick is cleared", () => {
    const done = withWorkout(EMPTY_ENTRY, id, true);
    expect(isWorkoutDone(done, id)).toBe(true);
    const cleared = withWorkout(done, id, false);
    expect("workouts" in cleared).toBe(false);
    expect(serializeEntry(cleared)).toBe('{"flags":{},"note":""}');
  });

  it("drops junk ticks rather than throwing", () => {
    for (const bad of ["1", '"yes"', "null", "[]", '{"x":false}', '{"x":1}']) {
      const parsed = parseEntry(`{"flags":{},"note":"","workouts":${bad}}`);
      expect(parsed.workouts).toBeUndefined();
    }
    expect(parseEntry(`{"flags":{},"note":"","workouts":{"${id}":true,"junk":"yes"}}`).workouts)
      .toEqual({ [id]: true });
  });

  it("lists the ids done that day", () => {
    expect(workoutsDone(EMPTY_ENTRY)).toEqual([]);
    expect(workoutsDone(withWorkout(withWorkout(EMPTY_ENTRY, "a", true), "b", true))).toEqual(["a", "b"]);
  });

  it("counts a tick as information, so the day is not blank", () => {
    expect(isBlank(withWorkout(EMPTY_ENTRY, id, true))).toBe(false);
    expect(isBlank(withWorkout(withWorkout(EMPTY_ENTRY, id, true), id, false))).toBe(true);
  });

  it("keeps the ticks when a flag, the note or the weight changes", () => {
    // The withFlag trap again: every with* helper must spread the entry.
    const done = withWorkout({ flags: {}, note: "", weight: 16.2 }, id, true);
    expect(withFlag(done, "nagging", true).workouts).toEqual({ [id]: true });
    expect(withNote(done, "kveldstur").workouts).toEqual({ [id]: true });
    expect(withWeight(done, 17).workouts).toEqual({ [id]: true });
    expect(withWeight(done, null).workouts).toEqual({ [id]: true });
  });

  it("keeps flags, the note and the weight when a tick changes", () => {
    const day = { flags: { gnikking: true }, note: "notat", weight: 16.2 };
    expect(withWorkout(day, id, true)).toEqual({ ...day, workouts: { [id]: true } });
    expect(withWorkout(withWorkout(day, id, true), id, false)).toEqual(day);
  });
});
