import { describe, expect, it } from "vitest";
import { dayFromSearch, searchForDay } from "./url";

const TODAY = "2026-08-26";

describe("dayFromSearch", () => {
  it("takes a valid past day", () => {
    expect(dayFromSearch("?d=2026-07-01", TODAY)).toBe("2026-07-01");
  });

  it("falls back to today when absent", () => {
    expect(dayFromSearch("", TODAY)).toBe(TODAY);
    expect(dayFromSearch("?x=1", TODAY)).toBe(TODAY);
  });

  it("refuses malformed values rather than passing them to the database", () => {
    for (const bad of ["?d=nonsense", "?d=2026-02-31", "?d=", "?d=2026-13-01"]) {
      expect(dayFromSearch(bad, TODAY)).toBe(TODAY);
    }
  });

  it("clamps the future to today", () => {
    expect(dayFromSearch("?d=2027-01-01", TODAY)).toBe(TODAY);
  });
});

describe("searchForDay", () => {
  it("keeps today's URL clean", () => {
    expect(searchForDay(TODAY, TODAY)).toBe("");
  });

  it("names any other day", () => {
    expect(searchForDay("2026-07-01", TODAY)).toBe("?d=2026-07-01");
  });
});
