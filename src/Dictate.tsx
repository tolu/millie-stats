import { createSignal, onSettled } from "solid-js";
import { startDictation, type Dictation } from "./lib/dictation";
import { voiceToken } from "./server/voice";

type Phase = "idle" | "recording" | "finishing";

/**
 * Dictation for the note: click to start, click to stop. Holding a button
 * down was tried and dropped — tiring on a phone and on a laptop alike.
 *
 * `phase` is a plain variable because a click reads back what the previous
 * one wrote, and signal writes are batched. `view` is only what is drawn.
 */
export default function Dictate(props: {
  /** The finished, cleaned text. Called once per recording, never with "". */
  onText: (text: string) => void;
  /** True from the click until the text is in: the day must not change meanwhile. */
  onBusy: (busy: boolean) => void;
  buttonRef?: (button: HTMLButtonElement) => void;
}) {
  const [view, setView] = createSignal<Phase>("idle");
  const [live, setLive] = createSignal("");
  const [error, setError] = createSignal("");

  let phase: Phase = "idle";
  let session: Dictation | null = null;

  function enter(next: Phase) {
    phase = next;
    setView(next);
  }

  function start() {
    setError("");
    setLive("");
    props.onBusy(true);
    // Inside the click: Chrome only lets audio start in a user gesture.
    session = startDictation({
      getToken: voiceToken,
      onText: setLive,
      // A failure ends the recording; whatever was understood is still kept.
      onError: (message) => {
        setError(message);
        void stop();
      },
    });
    enter("recording");
  }

  async function stop() {
    const current = session;
    // Once only: an error and a click can both arrive for one recording.
    if (!current || phase !== "recording") return;
    enter("finishing");
    const text = await current.stop();
    session = null;
    if (text) props.onText(text);
    setLive("");
    enter("idle");
    props.onBusy(false);
  }

  onSettled(() => () => {
    // Leaving the page abandons a recording rather than writing it to a day
    // that is no longer on screen.
    session?.cancel();
    session = null;
  });

  function toggle() {
    if (phase === "idle") start();
    else void stop();
  }

  const label = () => {
    switch (view()) {
      case "recording":
        return "Stopp";
      case "finishing":
        return "Skriver…";
      default:
        return "Snakk inn";
    }
  };

  return (
    <div class="dictate" data-phase={view()}>
      <button
        type="button"
        ref={(el) => props.buttonRef?.(el)}
        disabled={view() === "finishing"}
        aria-pressed={view() === "recording" ? "true" : "false"}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
        {label()}
      </button>
      <output aria-live="polite" class={error() ? "error" : ""}>
        {error() || live()}
      </output>
    </div>
  );
}
