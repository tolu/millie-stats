import { describe, expect, it } from "vitest";
import {
  EMPTY_ENTRY,
  isBlank,
  isFlagged,
  parseEntry,
  serializeEntry,
  withFlag,
  withNote,
} from "./entry";

describe("serialization", () => {
  it("round-trips a real entry", () => {
    const entry = { flags: { napping: true, "slow-walk": true }, note: "rolig kveld" };
    expect(parseEntry(serializeEntry(entry))).toEqual(entry);
  });

  it("stores only true flags, so unchecked and never-set are identical", () => {
    const stored = serializeEntry({ flags: { napping: true, gnikking: false }, note: "" });
    expect(JSON.parse(stored)).toEqual({ flags: { napping: true }, note: "" });
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
    const on = withFlag(base, "napping", true);
    expect(isFlagged(on, "napping")).toBe(true);
    expect(isFlagged(base, "napping")).toBe(false);

    const off = withFlag(on, "napping", false);
    expect(isFlagged(off, "napping")).toBe(false);
    expect(Object.keys(off.flags)).toHaveLength(0);
  });

  it("replaces the note without touching flags", () => {
    const entry = withNote(withFlag(EMPTY_ENTRY, "gnikking", true), "notat");
    expect(entry).toEqual({ flags: { gnikking: true }, note: "notat" });
  });

  it("knows when a day carries no information", () => {
    expect(isBlank(EMPTY_ENTRY)).toBe(true);
    expect(isBlank({ flags: {}, note: "   " })).toBe(true);
    expect(isBlank({ flags: { napping: true }, note: "" })).toBe(false);
    expect(isBlank({ flags: {}, note: "x" })).toBe(false);
  });
});
