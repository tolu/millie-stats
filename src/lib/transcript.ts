// What a live transcription session says back, and how it becomes text in
// the note. Pure, so the protocol's quirks are pinned down by tests rather
// than rediscovered on a phone.
//
// Observed on gemini-3.5-transcribe-live, 2026-11-14:
// - An interim is the whole turn so far, not an increment. Each replaces the last.
// - A final closes a turn and replaces its interim. A long pause starts a new turn.
// - After `audioStreamEnd` the last final arrives, then `generationComplete`.
// - In SMART mode the final is the cleaned text; the interim is raw.

export type ServerEvent =
  | { readonly kind: "setup" }
  | { readonly kind: "activityStart" }
  | { readonly kind: "interim"; readonly text: string }
  | { readonly kind: "final"; readonly text: string }
  | { readonly kind: "complete" };

type Raw = {
  setupComplete?: unknown;
  voiceActivity?: { type?: unknown };
  serverContent?: {
    interimInputTranscription?: { text?: unknown };
    inputTranscription?: { text?: unknown };
    generationComplete?: unknown;
  };
};

/** Never throws: an unknown or malformed message is simply no events. */
export function parseServerMessage(data: string): ServerEvent[] {
  let msg: Raw;
  try {
    msg = JSON.parse(data) as Raw;
  } catch {
    return [];
  }
  if (!msg || typeof msg !== "object") return [];

  const events: ServerEvent[] = [];
  if (msg.setupComplete) events.push({ kind: "setup" });
  if (msg.voiceActivity?.type === "ACTIVITY_START") events.push({ kind: "activityStart" });
  const content = msg.serverContent;
  const interim = content?.interimInputTranscription?.text;
  if (typeof interim === "string") events.push({ kind: "interim", text: interim });
  const final = content?.inputTranscription?.text;
  if (typeof final === "string") events.push({ kind: "final", text: final });
  if (content?.generationComplete) events.push({ kind: "complete" });
  return events;
}

export type Transcript = {
  /** Cleaned text of every finished turn, in order. */
  readonly finals: readonly string[];
  /** Raw text of the turn still being spoken. */
  readonly interim: string;
  /**
   * Whether a turn is still being spoken, so a final is still owed. A pause
   * closes a turn on its own, often before the button is released; waiting
   * for another final then waits for one that never comes.
   */
  readonly open: boolean;
};

export const EMPTY_TRANSCRIPT: Transcript = { finals: [], interim: "", open: false };

export function reduceTranscript(t: Transcript, event: ServerEvent): Transcript {
  switch (event.kind) {
    case "activityStart":
      return { ...t, open: true };
    // An interim opens a turn too: activity events are not documented per turn.
    case "interim":
      return { ...t, interim: event.text, open: true };
    case "final": {
      const text = event.text.trim();
      return { ...t, finals: text ? [...t.finals, text] : t.finals, interim: "", open: false };
    }
    default:
      return t;
  }
}

/**
 * Finished turns plus the one in progress. Also what is kept if the last
 * final never comes: raw words beat lost words, and the note is edited anyway.
 */
export function transcriptText(t: Transcript): string {
  return [...t.finals, t.interim.trim()].filter(Boolean).join(" ");
}

/** Dictation adds on a new line. It never replaces what is already there. */
export function appendToNote(note: string, dictated: string): string {
  const text = dictated.trim();
  if (!text) return note;
  const before = note.trimEnd();
  return before ? `${before}\n${text}` : text;
}
