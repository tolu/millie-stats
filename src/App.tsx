import { createMemo, createSignal, For, Loading } from "solid-js";
import { SYMPTOMS } from "./symptoms";
import { formatLong, osloDay } from "./lib/date";
import { EMPTY_ENTRY, isFlagged, withFlag, withNote } from "./lib/entry";
import type { DayEntry } from "./lib/entry";
import { getDay, saveDay } from "./server/db";

// Step 2 harness: deliberately unstyled. It exists to exercise the real data
// layer end to end against D1. Step 3 replaces it with the actual interface.

export default function App() {
  const [day] = createSignal(osloDay());
  const [draft, setDraft] = createSignal<DayEntry | null>(null);
  const [status, setStatus] = createSignal("");

  // Solid 2: a computation may return a promise, and reading it downstream
  // suspends until it settles. No createResource any more.
  const stored = createMemo(async () => await getDay(day()));
  const entry = createMemo(() => draft() ?? stored()?.entry ?? EMPTY_ENTRY);

  async function persist(next: DayEntry) {
    setDraft(next);
    setStatus("lagrer…");
    try {
      const { updatedAt } = await saveDay(day(), next);
      setStatus(`lagret ${updatedAt}`);
    } catch (error) {
      setStatus(`feilet: ${String(error)}`);
    }
  }

  return (
    <main style="font-family: system-ui, sans-serif; padding: 2rem; max-width: 40rem">
      <h1>Millie</h1>
      <p>{formatLong(day())}</p>
      <Loading fallback={<p>laster…</p>}>
        <For each={SYMPTOMS}>
          {(symptom) => (
            <label style="display: block; margin: .5rem 0">
              <input
                type="checkbox"
                checked={isFlagged(entry(), symptom.id)}
                onChange={(e) =>
                  void persist(withFlag(entry(), symptom.id, e.currentTarget.checked))
                }
              />{" "}
              <strong>{symptom.label}</strong>
              <br />
              <small>{symptom.help}</small>
            </label>
          )}
        </For>
        <textarea
          rows={4}
          style="width: 100%"
          value={entry().note}
          onChange={(e) => void persist(withNote(entry(), e.currentTarget.value))}
        />
      </Loading>
      <p>
        <small>{status()}</small>
      </p>
    </main>
  );
}
