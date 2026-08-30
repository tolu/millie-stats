import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { formatLong } from "./lib/date";
import { isFlagged } from "./lib/entry";
import type { DayEntry } from "./lib/entry";
import { SYMPTOMS } from "./symptoms";
import Masthead from "./Masthead";
import { listNotes } from "./server/db";
import type { NoteRecord } from "./server/db";

const PAGE = 10;

/**
 * The journal: every day that has a note, newest first.
 *
 * Read-only on purpose. The day view already edits and shows photos, so each
 * entry's date is a link into it rather than a second place to change things.
 */
export default function Journal(props: {
  onDay: () => void;
  onOpenDay: (day: string) => void;
}) {
  // Rendered state.
  const [rows, setRows] = createSignal<NoteRecord[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [error, setError] = createSignal("");

  // Control state, deliberately plain rather than signals: each of these is
  // read back in the same tick it is written, and signal writes are batched.
  // As signals, the guard would still read `loading === true` on re-entry and
  // the cursor would still be the previous page's, so the same page would load
  // twice. Same rule as `edit` in Day.tsx.
  let loading = false;
  let finished = false;
  let failed = false;
  let cursor: string | undefined;
  let sentinel: HTMLDivElement | undefined;

  /**
   * Whether the sentinel is on screen *right now*, measured rather than
   * remembered. The observer's own flag cannot answer this during a load: it
   * reports asynchronously, so immediately after a page is appended it still
   * says "visible" even though the new rows have just pushed the sentinel off
   * screen. Trusting it loaded three pages before the list had been scrolled.
   */
  function sentinelInView(): boolean {
    if (!sentinel) return false;
    return sentinel.getBoundingClientRect().top <= window.innerHeight;
  }

  async function loadMore(): Promise<void> {
    if (loading || finished) return;
    loading = true;
    setBusy(true);
    setError("");
    try {
      // No suspending memo anywhere in this page. A memo that read the cursor
      // would return a new promise per page, and every downstream read would
      // suspend — blanking the whole accumulated list behind a fallback on
      // each "load more". Photos.tsx documents the same trap.
      const page =
        cursor === undefined ? await listNotes(PAGE) : await listNotes(PAGE, cursor);
      // Callback form: appending must build on the latest array, never on one
      // read back after a batched write.
      setRows((current) => [...current, ...page]);
      cursor = page.at(-1)?.day ?? cursor;
      failed = false;
      // A short page means there is nothing after it.
      if (page.length < PAGE) {
        finished = true;
        setDone(true);
      }
    } catch (cause) {
      // Caught here rather than left to <Errored>, which would replace the
      // whole signed-in view — masthead and all — for a failed page six.
      // `finished` stays false on purpose, so a retry is still possible.
      failed = true;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      loading = false;
      setBusy(false);
    }
    // A viewport taller than the first page leaves the sentinel on screen, and
    // IntersectionObserver only reports a CHANGE in intersection — no further
    // notification would arrive and loading would stall with the sentinel in
    // full view. Keep going until the content pushes it off screen, the data
    // runs out, or a page fails.
    if (!finished && !failed && sentinelInView()) await loadMore();
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    },
    // Enough to fetch before the reader reaches the bottom, but not so much
    // that the fill-the-viewport re-entry below keeps going for pages. At
    // 600px a tall phone loaded three pages before it had been scrolled once.
    { rootMargin: "200px 0px" },
  );

  onSettled(() => {
    void loadMore();
    return () => observer.disconnect();
  });

  return (
    <>
      <Masthead to="day" onToggle={props.onDay} />
      <main class="journal">
        <h2 class="journal-heading">Journal</h2>
        <ul class="journal-list">
          <For each={rows()}>
            {(row) => <Entry row={row} onOpen={props.onOpenDay} />}
          </For>
        </ul>

        {/* Always rendered, so the observer never loses its target. What stops
            the loading is `finished`, not removing this element. */}
        <div
          class="journal-end"
          ref={(el) => {
            sentinel = el;
            observer.observe(el);
          }}
        >
          <Show when={busy()}>
            <p class="muted">laster…</p>
          </Show>
          <Show when={error()}>
            <p class="login-error" role="alert">
              {error()}
            </p>
            <button type="button" class="add-photo" onClick={() => void loadMore()}>
              Prøv igjen
            </button>
          </Show>
          <Show when={done() && rows().length === 0}>
            <p class="muted">Ingen notater ennå.</p>
          </Show>
          <Show when={done() && rows().length > 0}>
            <p class="muted">Det var alt.</p>
          </Show>
        </div>
      </main>
    </>
  );
}

function Entry(props: { row: NoteRecord; onOpen: (day: string) => void }) {
  return (
    <li class="entry">
      <div class="entry-head">
        {/* The heading is the way back into the day itself. */}
        <button
          type="button"
          class="entry-day"
          onClick={() => props.onOpen(props.row.day)}
        >
          {formatLong(props.row.day)}
        </button>
        <Show when={props.row.hasPhotos}>
          <span class="entry-photos" role="img" aria-label="Har bilder">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="8.5" cy="10" r="1.5" />
              <path d="M21 16l-5-5-6 6" />
            </svg>
          </span>
        </Show>
        <Marks entry={props.row.entry} />
      </div>
      <p class="entry-note">{props.row.entry.note}</p>
    </li>
  );
}

/**
 * The day's symptoms as one small bar — a transpose of the Strip in Trends,
 * which shows one symptom across many days.
 *
 * Two states here, not three. Trends' third state is "nobody logged this day",
 * and every row in this list has a note, so it is a logged day by
 * construction. If this page ever lists days without notes, the third state
 * has to come back: an unlogged day is null, never zero.
 *
 * Driven by SYMPTOMS, so a fifth symptom widens it with no change here.
 */
function Marks(props: { entry: DayEntry }) {
  const hits = createMemo(() => SYMPTOMS.filter((s) => isFlagged(props.entry, s.id)));
  const label = createMemo(() =>
    hits().length === 0
      ? "Ingen symptomer"
      : hits()
          .map((s) => s.label)
          .join(", "),
  );

  return (
    <span class="entry-marks" role="img" aria-label={label()}>
      <For each={SYMPTOMS}>
        {(symptom) => (
          <span
            class="entry-mark"
            style={{
              background: isFlagged(props.entry, symptom.id)
                ? symptom.color
                : "var(--line-strong)",
            }}
          />
        )}
      </For>
    </span>
  );
}
