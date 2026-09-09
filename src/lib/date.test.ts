import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  formatShort,
  formatWeekday,
  fromEpochDay,
  isDay,
  isWeekend,
  lastNDays,
  osloDay,
  rangeDays,
  toEpochDay,
  startOfWeek,
  weekdayIndex,
} from "./date";

// Norway moves the clocks on the last Sunday in March and October.
// In 2026 that is 29 March (CET +1 -> CEST +2) and 25 October (+2 -> +1).
// These are the two days a year a naive implementation loses or duplicates
// an entry, which is why they get their own tests.

describe("osloDay", () => {
  it("uses the Oslo midnight boundary, not UTC's", () => {
    // 23:30 UTC in January is 00:30 the NEXT day in Oslo (CET, +1).
    expect(osloDay(new Date("2026-01-05T23:30:00Z"))).toBe("2026-01-06");
    // 22:30 UTC in July is 00:30 the NEXT day in Oslo (CEST, +2).
    expect(osloDay(new Date("2026-07-05T22:30:00Z"))).toBe("2026-07-06");
    // ...but 22:30 UTC in January is still 23:30 the SAME day in Oslo.
    expect(osloDay(new Date("2026-01-05T22:30:00Z"))).toBe("2026-01-05");
  });

  it("is correct either side of the spring forward", () => {
    // 00:30 UTC on 29 March is 01:30 Oslo, still CET. Clocks jump at 02:00.
    expect(osloDay(new Date("2026-03-29T00:30:00Z"))).toBe("2026-03-29");
    // 23:30 UTC on 28 March is 00:30 Oslo on the 29th.
    expect(osloDay(new Date("2026-03-28T23:30:00Z"))).toBe("2026-03-29");
    // 22:30 UTC on 28 March is 23:30 Oslo, still the 28th.
    expect(osloDay(new Date("2026-03-28T22:30:00Z"))).toBe("2026-03-28");
  });

  it("is correct either side of the autumn fall back", () => {
    // 22:30 UTC on 24 Oct is 00:30 Oslo on the 25th (still CEST, +2).
    expect(osloDay(new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    // 23:30 UTC on 25 Oct is 00:30 Oslo on the 26th (now CET, +1).
    expect(osloDay(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-26");
    // 22:30 UTC on 25 Oct is 23:30 Oslo, still the 25th.
    expect(osloDay(new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-25");
  });
});

describe("calendar arithmetic", () => {
  it("adds a day across the spring forward without skipping", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
  });

  it("adds a day across the fall back without repeating", () => {
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("gives a DST week exactly seven days", () => {
    expect(rangeDays("2026-03-26", "2026-04-01")).toHaveLength(7);
    expect(rangeDays("2026-10-22", "2026-10-28")).toHaveLength(7);
  });

  it("handles month, year and leap boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // 2028 is a leap year
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01"); // 2026 is not
  });

  it("round-trips through the epoch-day integer", () => {
    for (const day of ["1970-01-01", "2026-08-26", "2026-03-29", "2026-10-25"]) {
      expect(fromEpochDay(toEpochDay(day))).toBe(day);
    }
  });

  it("measures distance in whole days, signed", () => {
    expect(diffDays("2026-08-01", "2026-08-31")).toBe(30);
    expect(diffDays("2026-08-31", "2026-08-01")).toBe(-30);
    expect(diffDays("2026-03-28", "2026-03-30")).toBe(2);
  });
});

describe("ranges", () => {
  it("is inclusive at both ends", () => {
    expect(rangeDays("2026-08-24", "2026-08-26")).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
    ]);
  });

  it("is empty when reversed", () => {
    expect(rangeDays("2026-08-26", "2026-08-24")).toEqual([]);
  });

  it("counts back N days inclusive of the end day", () => {
    expect(lastNDays("2026-08-26", 3)).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
    ]);
    expect(lastNDays("2026-08-26", 1)).toEqual(["2026-08-26"]);
    expect(lastNDays("2026-08-26", 0)).toEqual([]);
    expect(lastNDays("2026-08-26", 90)).toHaveLength(90);
  });
});

describe("validation", () => {
  it("rejects malformed and impossible dates", () => {
    expect(isDay("2026-08-26")).toBe(true);
    expect(isDay("2026-2-6")).toBe(false);
    expect(isDay("not a date")).toBe(false);
    expect(isDay("2026-02-31")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("2026-02-29")).toBe(false); // 2026 is not a leap year
    expect(isDay("2028-02-29")).toBe(true);
  });

  it("throws rather than guessing on bad input", () => {
    // The selected day arrives from the ?d= query parameter, so hostile and
    // malformed values reach these helpers directly. Failing loudly beats
    // returning "NaN-NaN-NaN" and writing that to the database as a row key.
    expect(() => toEpochDay("nonsense")).toThrow();
    expect(() => addDays("nonsense", 1)).toThrow();
    expect(() => addDays("2026-02-31", 1)).toThrow();
    expect(() => diffDays("nope", "2026-08-26")).toThrow();
    expect(() => rangeDays("2026-08-26", "nope")).toThrow();
    expect(() => lastNDays("<script>", 30)).toThrow();
    expect(() => weekdayIndex("")).toThrow();
  });
});

describe("weekdays and formatting", () => {
  it("knows the weekday", () => {
    expect(weekdayIndex("2026-08-26")).toBe(3); // a Wednesday
    expect(isWeekend("2026-08-29")).toBe(true); // Saturday
    expect(isWeekend("2026-08-30")).toBe(true); // Sunday
    expect(isWeekend("2026-08-26")).toBe(false);
  });

  it("formats without shifting the day", () => {
    // The bug this guards: formatting via local time can render 25. aug.
    expect(formatShort("2026-08-26")).toContain("26");
    expect(formatShort("2026-01-01")).toContain("1");
    expect(formatWeekday("2026-08-26")).toBeTruthy();
  });
});

describe("startOfWeek", () => {
  it("is Monday-first, whatever the weekday", () => {
    expect(startOfWeek("2026-09-07")).toBe("2026-09-07"); // Monday maps to itself
    expect(startOfWeek("2026-09-09")).toBe("2026-09-07"); // Wednesday
    expect(startOfWeek("2026-09-13")).toBe("2026-09-07"); // Sunday belongs to the week before
  });

  it("crosses month and year boundaries", () => {
    expect(startOfWeek("2027-01-01")).toBe("2026-12-28"); // a Friday
    expect(startOfWeek("2026-10-01")).toBe("2026-09-28");
  });

  it("is unmoved by the clock changes", () => {
    // Both 2026 DST Sundays. Local-time arithmetic here can land on Saturday
    // evening and shift the whole week back a day.
    expect(startOfWeek("2026-03-29")).toBe("2026-03-23");
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19");
  });

  it("throws on bad input like the rest of the module", () => {
    expect(() => startOfWeek("2026-02-31")).toThrow();
  });
});
