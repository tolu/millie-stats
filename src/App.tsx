import {
  createMemo,
  createSignal,
  For,
  Errored,
  Loading,
  Match,
  onCleanup,
  Switch,
  untrack,
} from "solid-js";
import "./styles.css";
import { SYMPTOMS } from "./symptoms";
import { addDays, formatLong, osloDay } from "./lib/date";
import { EMPTY_ENTRY, isFlagged, withFlag, withNote } from "./lib/entry";
import type { DayEntry } from "./lib/entry";
import { dayFromSearch, searchForDay } from "./lib/url";
import { createWriteQueue } from "./lib/writeQueue";
import Trends from "./Trends";
import Login from "./Login";
import type { WriteState } from "./lib/writeQueue";
import { getDay, saveDay } from "./server/db";

/** Typing shouldn't fire a write per keystroke. Ticking a box should. */
const NOTE_DEBOUNCE_MS = 500;

type AuthState = { authorised: boolean; configured: boolean };

export default function App() {
  const [auth, setAuth] = createSignal<AuthState | null>(null);

  // Asked once on boot. The document shell is a static prerendered file, so it
  // cannot carry per-request state — the client has to discover it.
  void fetch("/_auth")
    .then((r) => r.json() as Promise<AuthState>)
    .then(setAuth)
    .catch(() => setAuth({ authorised: false, configured: true }));

  // An explicit three-state view rather than nested <Show>: the nested form
  // kept the login on screen after a successful sign-in, because the outer
  // condition stayed truthy and its callback never re-evaluated.
  const view = createMemo(() => {
    const state = auth();
    if (!state) return "checking" as const;
    return state.authorised ? ("journal" as const) : ("login" as const);
  });

  return (
    <Switch>
      <Match when={view() === "checking"}>
        <div class="login" />
      </Match>
      <Match when={view() === "login"}>
        <Login onSuccess={() => setAuth({ configured: true, authorised: true })} />
      </Match>
      <Match when={view() === "journal"}>
        {/* A failed read must not take the whole page down. Without this a
            single database hiccup replaces the app with a blank error page and
            no way back. */}
        <Errored fallback={(error, reset) => <Failure error={error} reset={reset} />}>
          <Journal />
        </Errored>
      </Match>
    </Switch>
  );
}

function Failure(props: { error: unknown; reset: () => void }) {
  const message = createMemo(() => {
    const raw = props.error;
    const value = typeof raw === "function" ? (raw as () => unknown)() : raw;
    return value instanceof Error ? value.message : String(value);
  });

  return (
    <div class="failure" role="alert">
      <h2>Noe gikk galt</h2>
      <p class="muted">{message()}</p>
      <button type="button" onClick={() => props.reset()}>
        Prøv igjen
      </button>
    </div>
  );
}

function Journal() {
  const today = osloDay();
  const [day, setDayRaw] = createSignal(dayFromSearch(location.search, today));
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

  function goTo(next: string) {
    if (next > today) return;
    const move = () => {
      // A pending note save belongs to the day being left, so flush it before
      // the queue is reset - otherwise navigating away loses what was typed.
      clearTimeout(noteTimer);
      const pending = draft();
      if (pending && pending.day === day()) queue.push(pending);
      queue.detach();
      setDraft(null);
      setStatus("idle");
      setDayRaw(next);
      history.replaceState(null, "", searchForDay(next, today) || location.pathname);
    };
    // Crossfade the day label rather than snapping it.
    if (document.startViewTransition) document.startViewTransition(move);
    else move();
  }

  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(noteTimer));

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
    <div class="shell">
      <header class="masthead">
        <img class="mark" src="/millie-mark.webp" alt="" width="56" height="56" />
        <div>
          <h1>Millie</h1>
          <p>Pinnedyr og Border Collie</p>
        </div>
        <button
          type="button"
          class="icon-button"
          popovertarget="about"
          aria-label="Om registreringene"
        >
          ?
        </button>
      </header>

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
          max={today}
          tabindex="-1"
          aria-hidden="true"
          onChange={(e) => e.currentTarget.value && goTo(e.currentTarget.value)}
        />

        {day() === today ? (
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
            <button type="button" class="today" onClick={() => goTo(today)}>
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
                <label class="symptom">
                  <input
                    type="checkbox"
                    checked={isFlagged(entry(), symptom.id)}
                    onChange={(e) => toggle(symptom.id, e.currentTarget.checked)}
                  />
                  <span class="label">{symptom.label}</span>
                  <span class="help">{symptom.help}</span>
                </label>
              )}
            </For>
          </fieldset>

          <label class="note">
            <span>Notat</span>
            <textarea
              value={entry().note}
              placeholder="Hva skjedde i dag?"
              onInput={(e) => editNote(e.currentTarget.value)}
            />
          </label>

          <output class="status" data-state={status()} aria-live="polite">
            {statusText()}
          </output>

          <Trends endDay={today} version={dataVersion()} />
        </main>
      </Loading>

      <div popover id="about">
        <h2>Hva betyr avkrysningene?</h2>
        <dl>
          <For each={SYMPTOMS}>
            {(symptom) => (
              <>
                <dt>{symptom.label}</dt>
                <dd>{symptom.help}</dd>
              </>
            )}
          </For>
        </dl>
        <p>
          En dag uten registrering betyr at den ikke ble ført — ikke at
          ingenting skjedde.
        </p>
      </div>
    </div>
  );
}
