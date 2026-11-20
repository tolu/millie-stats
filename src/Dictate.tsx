import { createSignal, onSettled, Show } from "solid-js";
import { formatLong } from "./lib/date";
import { type Dictation, startDictation } from "./lib/dictation";
import { EMPTY_TRANSCRIPT } from "./lib/transcript";

/** Below this the microphone hears a room, not a voice. */
const QUIET_RMS = 0.01;
/** Silence this long while recording earns a hint. */
const SILENCE_MS = 4_000;

/** A component, not a constant: a JSX element is one DOM node and can sit in one place. */
const Mic = () => (
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </>
);
const STAR = "M12 1.5 14.2 9.8 22.5 12 14.2 14.2 12 22.5 9.8 14.2 1.5 12 9.8 9.8Z";

/**
 * Dictation for the note, in a modal dialog. `showModal` makes the rest of the
 * page inert, so the day cannot change under the text and nothing else needs
 * locking. Ferdig keeps the text; Avbryt, Esc and Android's back gesture all
 * close the dialog, and closing any way but Ferdig throws the recording away.
 *
 * `session` is a plain variable because a click reads back what the previous
 * one wrote, and signal writes are batched.
 */
export default function Dictate(props: {
  /** The day the text is for, named in the dialog. */
  day: string;
  /** The finished, cleaned text. Called once per recording, never with "". */
  onText: (text: string) => void;
  buttonRef?: (button: HTMLButtonElement) => void;
}) {
  const [finishing, setFinishing] = createSignal(false);
  const [live, setLive] = createSignal(EMPTY_TRANSCRIPT);
  const [level, setLevel] = createSignal(0);
  const [silent, setSilent] = createSignal(false);
  const [error, setError] = createSignal("");

  let dialog!: HTMLDialogElement;
  let session: Dictation | null = null;
  let lastHeard = 0;

  function hear(rms: number) {
    const now = performance.now();
    if (rms >= QUIET_RMS) lastHeard = now;
    // Square root, so a normal speaking voice moves the orb most of the way.
    setLevel(Math.min(1, Math.sqrt(rms * 10)));
    setSilent(now - lastHeard > SILENCE_MS);
  }

  function start() {
    setError("");
    setLive(EMPTY_TRANSCRIPT);
    setLevel(0);
    setSilent(false);
    setFinishing(false);
    lastHeard = performance.now();
    dialog.showModal();
    // Inside the click: Chrome only lets audio start in a user gesture.
    session = startDictation({
      onText: setLive,
      onLevel: hear,
      // A failure ends the recording; whatever was understood is still kept.
      onError: (message) => {
        setError(message);
        void finish();
      },
    });
  }

  async function finish() {
    const current = session;
    if (!current) return;
    setFinishing(true);
    const text = await current.stop();
    // Whoever gets here first owns the text: an error and a click can both
    // finish one recording, and a close in the meantime has cleared `session`.
    if (session !== current) return;
    session = null;
    dialog.close();
    if (text) props.onText(text);
  }

  /** Every way out but Ferdig: the dialog closing, or the page going away. */
  function abandon() {
    session?.cancel();
    session = null;
  }

  onSettled(() => abandon);

  const said = () => live().finals.join(" ");

  return (
    <div class="dictate">
      <button type="button" ref={(el) => props.buttonRef?.(el)} onClick={start}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <Mic />
        </svg>
        Snakk inn
      </button>
      <output class="error">{error()}</output>

      <dialog
        id="dictation"
        class="weight-dialog dictation"
        ref={dialog}
        aria-labelledby="dictation-day"
        onClose={abandon}
      >
        <h2 id="dictation-day">
          {finishing() ? "Skriver til" : "Snakker inn til"} {formatLong(props.day)}
        </h2>

        {/* Column-reversed in CSS, so a long text keeps its newest line in view. */}
        <p class="live" aria-live="polite">
          <span>
            {said()} <span class="interim">{live().interim || (said() ? "" : "Snakk nå…")}</span>
          </span>
        </p>

        <div
          class="orb"
          data-state={finishing() ? "finishing" : silent() ? "quiet" : "listening"}
          style={{ "--level": String(level()) }}
          aria-hidden="true"
        >
          <span class="ring" />
          <span class="ring" />
          <span class="ring" />
          <svg class="core" viewBox="0 0 24 24" aria-hidden="true">
            <Mic />
          </svg>
          <svg class="spark" viewBox="0 0 24 24" aria-hidden="true">
            <path d={STAR} />
          </svg>
          <svg class="spark" viewBox="0 0 24 24" aria-hidden="true">
            <path d={STAR} />
          </svg>
          <svg class="spark" viewBox="0 0 24 24" aria-hidden="true">
            <path d={STAR} />
          </svg>
        </div>

        <Show when={silent() && !finishing()}>
          <p class="hint">Jeg hører ingenting. Er mikrofonen dekket?</p>
        </Show>

        <div class="weight-actions">
          <button type="button" class="close" commandfor="dictation" command="close">
            Avbryt
          </button>
          <button
            type="button"
            class="save"
            autofocus
            disabled={finishing()}
            onClick={() => void finish()}
          >
            {finishing() ? "Skriver…" : "Ferdig"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
