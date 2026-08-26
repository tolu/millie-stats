import { describe, expect, it } from "vitest";
import type { DayEntry } from "../lib/entry";
import { buildUserMessage, SYSTEM_PROMPT } from "./prompt";

const HIT: DayEntry = { flags: { napping: true }, note: "nappet mye etter turen" };
const CLEAR: DayEntry = { flags: {}, note: "" };

const fixture = new Map<string, DayEntry>([
  ["2026-08-24", HIT],
  ["2026-08-26", CLEAR],
  // 2026-08-25 deliberately absent: never logged.
  ["2026-08-21", HIT],
]);

const request = {
  from: "2026-08-24",
  to: "2026-08-26",
  previousFrom: "2026-08-21",
  previousTo: "2026-08-23",
  entries: fixture,
};

describe("buildUserMessage", () => {
  it("writes unlogged days out explicitly instead of omitting them", () => {
    // The single most important property of this prompt. A missing row in a
    // list of dates reads as "nothing happened"; the model must instead see
    // that nobody filled the day in.
    const message = buildUserMessage(request);
    expect(message).toContain("2026-08-25 | ");
    expect(message).toContain("IKKE FØRT");
  });

  it("reports how much of each period was covered", () => {
    const message = buildUserMessage(request);
    expect(message).toContain("3 dager, 2 ført, 1 ikke ført");
  });

  it("marks flags as JA and nei", () => {
    const message = buildUserMessage(request);
    const row = message.split("\n").find((l) => l.startsWith("2026-08-24 |"));
    expect(row).toContain("JA");
    expect(row).toContain("nei");
  });

  it("carries the note through verbatim", () => {
    expect(buildUserMessage(request)).toContain("nappet mye etter turen");
  });

  it("includes the previous period for comparison, and says so", () => {
    const message = buildUserMessage(request);
    expect(message).toContain("2026-08-21 til 2026-08-23");
    expect(message).toContain("kun til sammenligning");
  });

  it("is stable for a fixed input", () => {
    // Guards against an accidental reordering or format change going
    // unnoticed: the prompt is the thing the vet summary reasons from.
    expect(buildUserMessage(request)).toMatchSnapshot();
  });
});

describe("SYSTEM_PROMPT", () => {
  it("states the gap rule", () => {
    expect(SYSTEM_PROMPT).toContain("ikke ble ført");
    expect(SYSTEM_PROMPT).toContain("Tolk aldri hull som symptomfrie dager");
  });

  it("forbids diagnosing", () => {
    expect(SYSTEM_PROMPT).toContain("Du stiller ikke diagnose");
    expect(SYSTEM_PROMPT).toContain("ikke foreslå behandling");
  });

  it("carries Millie's background", () => {
    expect(SYSTEM_PROMPT).toContain("28. januar 2018");
    expect(SYSTEM_PROMPT).toContain("ryggvirvlene");
  });

  it("lists every tracked symptom, so adding one cannot silently skip the prompt", () => {
    for (const label of ["Gnikking", "Napping", "Lydsensitiv", "Slow walk"]) {
      expect(SYSTEM_PROMPT).toContain(label);
    }
  });

  it("asks for both outputs in Norwegian", () => {
    expect(SYSTEM_PROMPT).toContain("Svar alltid på norsk");
    expect(SYSTEM_PROMPT).toContain("**brief**");
    expect(SYSTEM_PROMPT).toContain("**recap**");
  });
});
