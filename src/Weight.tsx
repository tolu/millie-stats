import { createMemo, createSignal, flush, Show } from "solid-js";
import { formatLong } from "./lib/date";
import { BASELINE_KG, formatKg, parseKg } from "./lib/weight";
import { lastWeight } from "./server/db";

/**
 * The weight button in the masthead, and the dialog behind it.
 *
 * The button doubles as a readout: on a day she was weighed it shows the
 * number, so the masthead answers "what did she weigh" without a tap.
 */
export default function Weight(props: {
  day: string;
  /** This day's weight, if she was weighed. */
  weight: number | undefined;
  onSave: (kg: number | null) => void;
}) {
  const [draft, setDraft] = createSignal("");
  const [error, setError] = createSignal("");
  /** Set once the user types, so a late prefill cannot overwrite them. */
  const [touched, setTouched] = createSignal(false);
  /** Identifies one opening, so a slow reply for a previous one is ignored. */
  let opening = 0;

  let dialog!: HTMLDialogElement;
  let field!: HTMLInputElement;

  const label = createMemo(() =>
    props.weight === undefined ? "Vekt" : `${formatKg(props.weight)} kg`,
  );

  function open() {
    setError("");
    setTouched(false);
    const own = props.weight;

    // Opens immediately on something sensible. Awaiting the server first would
    // make the tap do nothing at all until it replied — a dead button on a bad
    // connection, which reads as the app being broken.
    setDraft(formatKg(own ?? BASELINE_KG));
    // flush() before select(): Solid 2 commits setters on a microtask, so
    // selecting here would otherwise act on the field's previous contents and
    // the selection would collapse when the new value landed. That turned the
    // prefill into something you had to backspace over.
    flush();
    dialog.showModal();
    field.select();

    // This day's own weight wins outright. Otherwise refine the baseline guess
    // with the last weight on record, so a re-weigh is a nudge not a retype.
    if (own !== undefined) return;
    const token = ++opening;
    void lastWeight()
      .then((previous) => {
        // Ignore a reply that belongs to an earlier opening, and never
        // overwrite something the user has already typed.
        if (token !== opening || !dialog.open || touched() || !previous) return;
        setDraft(formatKg(previous.kg));
        flush();
        field.select();
      })
      .catch(() => {
        // The baseline is already in the field; a failed lookup costs nothing.
      });
  }

  function save() {
    const kg = parseKg(draft());
    if (kg === null) {
      setError("Skriv vekten i kilo, for eksempel 16,4");
      return;
    }
    props.onSave(kg);
    dialog.close();
  }

  function clear() {
    props.onSave(null);
    dialog.close();
  }

  return (
    <>
      <button
        type="button"
        class="weight-button"
        data-set={props.weight === undefined ? "no" : "yes"}
        onClick={open}
      >
        {label()}
      </button>

      <dialog class="weight-dialog" ref={dialog} onClose={() => setError("")}>
        {/* The button sits above the date navigation, so the day it writes to
            has to be spelled out — otherwise "which day is this?" is a guess. */}
        <h2>Vekt for {formatLong(props.day)}</h2>

        <label class="weight-field">
          <input
            ref={field}
            // Text, not number: a number input reports an empty string for a
            // decimal separator it does not like, so a Norwegian comma would
            // read as "my typing is being ignored". parseKg takes both.
            type="text"
            inputmode="decimal"
            size="4"
            autocomplete="off"
            value={draft()}
            onInput={(e) => {
              setDraft(e.currentTarget.value);
              setTouched(true);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
          />
          <span>kg</span>
        </label>

        <Show when={error()}>
          <p class="login-error" role="alert">
            {error()}
          </p>
        </Show>

        <div class="weight-actions">
          <button type="button" class="close" onClick={() => dialog.close()}>
            Avbryt
          </button>
          <Show when={props.weight !== undefined}>
            <button type="button" class="delete" onClick={clear}>
              Fjern
            </button>
          </Show>
          <button type="button" class="save" onClick={save}>
            Lagre
          </button>
        </div>
      </dialog>
    </>
  );
}
