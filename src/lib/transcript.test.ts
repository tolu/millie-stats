import { describe, expect, it } from "vitest";
import {
  appendToNote,
  EMPTY_TRANSCRIPT,
  parseServerMessage,
  reduceTranscript,
  type ServerEvent,
  transcriptText,
} from "./transcript";

const json = (value: unknown) => JSON.stringify(value);

describe("parseServerMessage", () => {
  // Shapes copied from a real session with gemini-3.5-transcribe-live.
  it("reads the messages a session actually sends", () => {
    expect(parseServerMessage(json({ setupComplete: {} }))).toEqual([{ kind: "setup" }]);
    expect(
      parseServerMessage(
        json({ serverContent: {}, voiceActivity: { type: "ACTIVITY_START", audioOffset: "0.2s" } }),
      ),
    ).toEqual([{ kind: "activityStart" }]);
    expect(
      parseServerMessage(json({ serverContent: { interimInputTranscription: { text: "I dag" } } })),
    ).toEqual([{ kind: "interim", text: "I dag" }]);
    expect(
      parseServerMessage(
        json({ serverContent: { inputTranscription: { text: "I dag gikk vi." } } }),
      ),
    ).toEqual([{ kind: "final", text: "I dag gikk vi." }]);
    expect(parseServerMessage(json({ serverContent: { generationComplete: true } }))).toEqual([
      { kind: "complete" },
    ]);
  });

  it("reads every event in a message that carries more than one", () => {
    expect(
      parseServerMessage(
        json({
          serverContent: { inputTranscription: { text: "Ferdig." }, generationComplete: true },
        }),
      ),
    ).toEqual([{ kind: "final", text: "Ferdig." }, { kind: "complete" }]);
  });

  it("ignores what it does not know, and garbage, instead of throwing", () => {
    expect(parseServerMessage(json({ usageMetadata: { totalTokenCount: 4 } }))).toEqual([]);
    expect(parseServerMessage("not json")).toEqual([]);
    expect(parseServerMessage(json(null))).toEqual([]);
    expect(
      parseServerMessage(json({ serverContent: { inputTranscription: { text: 42 } } })),
    ).toEqual([]);
  });
});

describe("reduceTranscript", () => {
  const run = (events: ServerEvent[]) => events.reduce(reduceTranscript, EMPTY_TRANSCRIPT);

  // Interims are the whole turn so far, not increments: each one replaces the last.
  it("replaces the interim rather than appending to it", () => {
    const t = run([
      { kind: "interim", text: "I dag" },
      { kind: "interim", text: "I dag gikk vi" },
    ]);
    expect(transcriptText(t)).toBe("I dag gikk vi");
  });

  it("lets the final replace the turn's interim", () => {
    const t = run([
      { kind: "interim", text: "Eh, i dag gikk vi liksom" },
      { kind: "final", text: "I dag gikk vi." },
    ]);
    expect(t.interim).toBe("");
    expect(transcriptText(t)).toBe("I dag gikk vi.");
  });

  it("keeps earlier turns when a long pause starts a new one", () => {
    const t = run([
      { kind: "final", text: "Lang tur." },
      { kind: "interim", text: "Hun var" },
    ]);
    expect(transcriptText(t)).toBe("Lang tur. Hun var");
  });

  it("knows whether a final is still owed", () => {
    expect(run([]).open).toBe(false);
    expect(run([{ kind: "activityStart" }]).open).toBe(true);
    expect(
      run([
        { kind: "final", text: "Lang tur." },
        { kind: "interim", text: "Hun" },
      ]).open,
    ).toBe(true);
  });

  // Regression: a pause before release closes the last turn by itself. Treating
  // "speech was heard" as "a final is coming" waited the full timeout for one
  // that never came — four seconds of a spinner after every such recording.
  it("is not open once a pause has closed the turn", () => {
    const t = run([
      { kind: "activityStart" },
      { kind: "interim", text: "Lang tur" },
      { kind: "final", text: "Lang tur." },
      { kind: "complete" },
    ]);
    expect(t.open).toBe(false);
  });

  it("drops blank finals", () => {
    expect(run([{ kind: "final", text: "  " }]).finals).toEqual([]);
  });
});

describe("appendToNote", () => {
  it("fills an empty note", () => {
    expect(appendToNote("", "Lang tur.")).toBe("Lang tur.");
    expect(appendToNote("  \n", "Lang tur.")).toBe("Lang tur.");
  });

  // Dictation adds; it never replaces what was already written that day.
  it("adds on a new line, never over what is there", () => {
    expect(appendToNote("Gnikket i kveld.", "Lang tur.")).toBe("Gnikket i kveld.\nLang tur.");
  });

  it("does not stack blank lines when the note already ends in one", () => {
    expect(appendToNote("Gnikket i kveld.\n\n", "Lang tur.")).toBe("Gnikket i kveld.\nLang tur.");
  });

  it("leaves the note alone when nothing was dictated", () => {
    expect(appendToNote("Gnikket i kveld.\n", "  ")).toBe("Gnikket i kveld.\n");
  });
});
