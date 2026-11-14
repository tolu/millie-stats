import { createSignal, onSettled } from "solid-js";
import { startDictation, type Dictation } from "./lib/dictation";
import { voiceToken } from "./server/voice";

/** Shorter than this, a press is a tap: it latches recording on instead. */
const TAP_MS = 300;

type Phase = "idle" | "holding" | "latched" | "finishing";

/**
 * Push-to-talk for the note. Hold to talk, release to stop; a quick tap
 * latches it on until the next tap, because holding for a minute on a phone
 * is tiring.
 *
 * The gesture state lives in plain variables, not signals: pointerdown and
 * pointerup read back what the other wrote, and signal writes are batched.
 * `view` is only what is drawn.
 */
export default function Dictate(props: {
  /** The finished, cleaned text. Called once per recording, never with "". */
  onText: (text: string) => void;
  /** True from the press until the text is in: the day must not change meanwhile. */
  onBusy: (busy: boolean) => void;
  buttonRef?: (button: HTMLButtonElement) => void;
}) {
  const [view, setView] = createSignal<Phase>("idle");
  const [live, setLive] = createSignal("");
  const [error, setError] = createSignal("");

  let phase: Phase = "idle";
  let session: Dictation | null = null;
  let pressedAt = 0;

  function enter(next: Phase) {
    phase = next;
    setView(next);
  }

  function start() {
    setError("");
    setLive("");
    props.onBusy(true);
    // Inside the press: Chrome only lets audio start in a user gesture.
    session = startDictation({
      getToken: voiceToken,
      onText: setLive,
      // A failure ends the recording; whatever was understood is still kept.
      onError: (message) => {
        setError(message);
        void stop();
      },
    });
    enter("holding");
  }

  async function stop() {
    const current = session;
    // Once only: an error, a release and a cancel can all arrive for one recording.
    if (!current || phase === "finishing") return;
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

  function onPointerDown(event: PointerEvent & { currentTarget: HTMLButtonElement }) {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pressedAt = event.timeStamp;
    if (phase === "idle") start();
    else if (phase === "latched") void stop();
  }

  function onPointerUp(event: PointerEvent) {
    if (phase !== "holding") return;
    if (event.timeStamp - pressedAt < TAP_MS) enter("latched");
    else void stop();
  }

  function onPointerCancel() {
    if (phase === "holding") void stop();
  }

  // Keyboard activation has no pointer events: Enter or Space toggles.
  function onClick(event: MouseEvent) {
    if (event.detail !== 0) return;
    if (phase === "idle") {
      start();
      enter("latched");
    } else if (phase === "latched") void stop();
  }

  const label = () => {
    switch (view()) {
      case "holding":
        return "Slipp for å stoppe";
      case "latched":
        return "Trykk for å stoppe";
      case "finishing":
        return "Skriver…";
      default:
        return "Hold for å snakke";
    }
  };

  return (
    <div class="dictate" data-phase={view()}>
      <button
        type="button"
        ref={(el) => props.buttonRef?.(el)}
        disabled={view() === "finishing"}
        aria-pressed={view() === "holding" || view() === "latched" ? "true" : "false"}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={onClick}
        onContextMenu={(e) => e.preventDefault()}
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
