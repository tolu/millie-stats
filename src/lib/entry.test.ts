import { describe, expect, it } from "vitest";
import {
  EMPTY_ENTRY,
  isBlank,
  isFlagged,
  parseEntry,
  serializeEntry,
  withFlag,
  withNote,
  withWeight,
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
