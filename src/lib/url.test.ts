import { describe, expect, it } from "vitest";
import { dayFromSearch, routeFromSearch, searchForRoute } from "./url";
import type { Route } from "./url";

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

describe("routeFromSearch", () => {
  it("reads both parts", () => {
    expect(routeFromSearch("?view=journal", TODAY)).toEqual({ view: "journal", day: TODAY });
    expect(routeFromSearch("?view=journal&d=2026-07-01", TODAY)).toEqual({
      view: "journal",
      day: "2026-07-01",
    });
    expect(routeFromSearch("?d=2026-07-01", TODAY)).toEqual({ view: "day", day: "2026-07-01" });
    expect(routeFromSearch("", TODAY)).toEqual({ view: "day", day: TODAY });
  });

  it("falls back to the day view for anything it does not recognise", () => {
    // An unknown ?view= must land on a working page, never a blank one.
    for (const bad of ["?view=nonsense", "?view=", "?view=JOURNAL", "?view=journal2"]) {
      expect(routeFromSearch(bad, TODAY).view).toBe("day");
    }
  });

  it("applies the same day hardening on the journal's entry point", () => {
    // The ?d=2026-02-31 hole, at a second door.
    expect(routeFromSearch("?view=journal&d=2026-02-31", TODAY)).toEqual({
      view: "journal",
      day: TODAY,
    });
    expect(routeFromSearch("?view=journal&d=2099-01-01", TODAY).day).toBe(TODAY);
  });
});

describe("searchForRoute", () => {
  it("keeps today's day view clean", () => {
    expect(searchForRoute({ view: "day", day: TODAY }, TODAY)).toBe("");
  });

  it("names anything else", () => {
    expect(searchForRoute({ view: "day", day: "2026-07-01" }, TODAY)).toBe("?d=2026-07-01");
    expect(searchForRoute({ view: "journal", day: TODAY }, TODAY)).toBe("?view=journal");
    expect(searchForRoute({ view: "journal", day: "2026-07-01" }, TODAY)).toBe(
      "?view=journal&d=2026-07-01",
    );
  });

  it("round-trips every combination", () => {
    // Catches parameter-order and encoding slips in one assertion.
    const routes: Route[] = [
      { view: "day", day: TODAY },
      { view: "day", day: "2026-07-01" },
      { view: "journal", day: TODAY },
      { view: "journal", day: "2026-07-01" },
    ];
    for (const route of routes) {
      expect(routeFromSearch(searchForRoute(route, TODAY), TODAY)).toEqual(route);
    }
  });
});
