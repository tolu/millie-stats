import { createMemo, createSignal, For, Loading, onSettled, untrack } from "solid-js";
import { SYMPTOMS } from "./symptoms";
import { addDays, formatLong } from "./lib/date";
import { EMPTY_ENTRY, isFlagged, withFlag, withNote, withWeight } from "./lib/entry";
import type { DayEntry } from "./lib/entry";
import { createWriteQueue } from "./lib/writeQueue";
import type { WriteState } from "./lib/writeQueue";
import Masthead from "./Masthead";
import Photos from "./Photos";
import Weight from "./Weight";
import Trends from "./Trends";
import Summaries from "./Summaries";
import { getDay, saveDay } from "./server/db";

/** Typing shouldn't fire a write per keystroke. Ticking a box should. */
const NOTE_DEBOUNCE_MS = 500;

export default function Day(props: {
  today: string;
  /** Read from props, never copied into a signal: <Match> keeps this component
   *  mounted while the day changes, so a copy made at mount would go stale. */
  day: string;
  onDay: (day: string) => void;
  onJournal: () => void;
}) {
  const today = () => props.today;
  const day = () => props.day;
  const [status, setStatus] = createSignal<WriteState>("idle");
  const [error, setError] = createSignal("");
  // Bumped on every successful save so the charts below reflect the edit that
  // was just made, without refetching on every keystroke.
  const [dataVersion, setDataVersion] = createSignal(0);

  // The optimistic layer: what the user has typed or ticked but which may not
  // have reached D1 yet. Tagged with its day so switching days never shows a
  // draft belonging to a different one.
  const [draft, setDraft] = createSignal<{ day: string; entry: DayEntry } | null>(null);

  // Solid 2: a computation may return a promise; reading it downstream
  // suspends until it settles.
  const stored = createMemo(async () => await getDay(day()));

  const entry = createMemo((): DayEntry => {
    const local = draft();
    if (local && local.day === day()) return local.entry;
    return stored()?.entry ?? EMPTY_ENTRY;
  });

  /** Flushes whatever is pending for the day being left. */
  function flushPending() {
    clearTimeout(noteTimer);
    const pending = draft();
    if (pending && pending.day === day()) queue.push(pending);
  }

  function goTo(next: string) {
    if (next > today()) return;
    const move = () => {
      // A pending note save belongs to the day being left, so flush it before
      // the queue is reset - otherwise navigating away loses what was typed.
      flushPending();
      queue.detach();
      setDraft(null);
      setStatus("idle");
      props.onDay(next);
    };
    // Crossfade the day label rather than snapping it. Scoped to a day change
    // on purpose — a whole-page swap would capture the next page's loading
    // state and crossfade into "laster…".
    if (document.startViewTransition) document.startViewTransition(move);
    else move();
  }

  function toJournal() {
    // Leaving the page unmounts this component, so the same flush applies.
    flushPending();
    props.onJournal();
  }

  let noteField!: HTMLTextAreaElement;

  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  // Flushes on disposal rather than discarding. Until this page could unmount,
  // clearing the timer was harmless because the debounce always got to fire.
  // Now, typing a note and immediately leaving the page would throw the write
  // away silently — no request issued, no error, the text simply gone.
  onSettled(() => () => flushPending());

  // Writes are queued rather than fired in parallel: every save carries the
  // whole day, so a slow one landing after a fast one would reinstate stale
  // data. See lib/writeQueue.
  const queue = createWriteQueue<{ day: string; entry: DayEntry }>(
    ({ day: target, entry: value }) => saveDay(target, value),
    (state, message) => {
      setStatus(state);
      setError(message ?? "");
      if (state === "saved") setDataVersion((n) => n + 1);
    },
  );

  /**
   * Applies an edit to the LATEST entry and queues the save.
   *
   * The base comes from the setter callback, never from reading the memo back:
   * Solid 2 batches signal writes, so two edits in the same tick would both
   * derive from the same stale value and the second would silently drop the
   * first. That is exactly how a ticked box got wiped by the following note.
   */
  function edit(change: (current: DayEntry) => DayEntry): DayEntry {
    const target = day();
    let next!: DayEntry;
    setDraft((previous) => {
      const base =
        previous && previous.day === target
          ? previous.entry
          : (untrack(stored)?.entry ?? EMPTY_ENTRY);
      next = change(base);
      return { day: target, entry: next };
    });
    return next;
  }

  function toggle(symptomId: string, on: boolean) {
    const next = edit((current) => withFlag(current, symptomId, on));
    clearTimeout(noteTimer);
    queue.push({ day: day(), entry: next });
  }

  // Same shape as toggle: a weight is a discrete act, so it saves at once
  // rather than being debounced like typing.
  function editWeight(kg: number | null) {
    const next = edit((current) => withWeight(current, kg));
    clearTimeout(noteTimer);
    queue.push({ day: day(), entry: next });
  }

  function editNote(note: string) {
    const next = edit((current) => withNote(current, note));
    const target = day();
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => queue.push({ day: target, entry: next }), NOTE_DEBOUNCE_MS);
  }

  let picker!: HTMLInputElement;

  const statusText = createMemo(() => {
    switch (status()) {
      case "saving":
        return "lagrer…";
      case "saved":
        return "lagret";
      case "error":
        return `kunne ikke lagre: ${error()}`;
      default:
        return "";
    }
  });

  return (
    <>
      <Masthead to="journal" onToggle={toJournal}>
        <Weight day={day()} weight={entry().weight} onSave={editWeight} />
      </Masthead>

      <nav class="datenav" aria-label="Velg dag">
        <button
          type="button"
          class="chevron"
          onClick={() => goTo(addDays(day(), -1))}
          aria-label="Forrige dag"
        >
          ‹
        </button>

        <button type="button" class="current" onClick={() => picker.showPicker()}>
          {formatLong(day())}
        </button>
        <input
          ref={picker}
          type="date"
          value={day()}
          max={today()}
          tabindex="-1"
          aria-hidden="true"
          onChange={(e) => e.currentTarget.value && goTo(e.currentTarget.value)}
        />

        {day() === today() ? (
          <button
            type="button"
            class="chevron"
            disabled
            aria-label="Kan ikke gå fram i tid"
          >
            ›
          </button>
        ) : (
          <>
            <button
              type="button"
              class="chevron"
              onClick={() => goTo(addDays(day(), 1))}
              aria-label="Neste dag"
            >
              ›
            </button>
            <button type="button" class="today" onClick={() => goTo(today())}>
              I dag
            </button>
          </>
        )}
      </nav>

      <Loading fallback={<p class="status">laster…</p>}>
        <main>
          <fieldset class="symptoms">
            <legend>Kryss av for dagen</legend>
            <For each={SYMPTOMS}>
              {(symptom) => (
                // The card is a div rather than a label so the info button can
                // live inside it: a label must not contain other interactive
                // content, and a click on it would otherwise toggle the box.
                <div class="symptom">
                  <label>
                    <input
                      type="checkbox"
                      checked={isFlagged(entry(), symptom.id)}
                      onChange={(e) => toggle(symptom.id, e.currentTarget.checked)}
                    />
                    <span class="label">{symptom.label}</span>
                  </label>
                  <button
                    type="button"
                    class="info"
                    popovertarget={`help-${symptom.id}`}
                    style={{ "anchor-name": `--anchor-${symptom.id}` }}
                    aria-label={`Hva betyr ${symptom.label}?`}
                  >
                    i
                  </button>
                  <div
                    popover
                    id={`help-${symptom.id}`}
                    class="help-pop"
                    style={{ "position-anchor": `--anchor-${symptom.id}` }}
                  >
                    <strong>{symptom.label}</strong>
                    <span>{symptom.help}</span>
                  </div>
                </div>
              )}
            </For>
          </fieldset>

          <label class="note">
            <span>Notat</span>
            <textarea
              ref={noteField}
              value={entry().note}
              placeholder="Hva skjedde i dag?"
              onInput={(e) => editNote(e.currentTarget.value)}
            />
          </label>

          <output class="status" data-state={status()} aria-live="polite">
            {statusText()}
          </output>

          <Photos
            day={day()}
            // A photo makes the day logged, so the charts below are stale.
            onChange={() => setDataVersion((n) => n + 1)}
            // What replaces requiring a note: a photo is almost always worth a
            // sentence, so the cursor goes there rather than a field being
            // made mandatory. Nothing else in this app blocks on input.
            onUploaded={() => noteField.focus()}
          />

          <Trends endDay={today()} version={dataVersion()} />

          <Summaries endDay={today()} />
        </main>
      </Loading>
    </>
  );
}
