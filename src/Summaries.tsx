import { createMemo, createSignal, For, Loading, refresh, Show } from "solid-js";
import { addDays, formatShort } from "./lib/date";
import { listSummaries } from "./server/db";
import { summarise } from "./server/summarise";

const RANGES = [
  { id: "week", label: "Siste uke", days: 7 },
  { id: "month", label: "Siste måned", days: 30 },
  { id: "quarter", label: "Siste 90 dager", days: 90 },
] as const;

export default function Summaries(props: { endDay: string }) {
  const [range, setRange] = createSignal<(typeof RANGES)[number]>(RANGES[1]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [open, setOpen] = createSignal<string | null>(null);

  const all = createMemo(async () => await listSummaries(20));

  const from = createMemo(() => addDays(props.endDay, -(range().days - 1)));

  async function generate() {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      const result = await summarise(from(), props.endDay);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Read again rather than prepended here. One request after a call that
      // took seconds, and the list is never anything but the server's.
      await refresh(all);
      setOpen(result.summary.id);
    } catch (cause) {
      // Only genuine faults land here; expected failures come back as data.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="summaries" aria-labelledby="summaries-heading">
      <h2 id="summaries-heading">Oppsummering</h2>

      <div class="summary-controls">
        <div class="window-toggle" role="group" aria-label="Periode å oppsummere">
          <For each={RANGES}>
            {(option) => (
              <label>
                <input
                  type="radio"
                  name="summary-range"
                  checked={range().id === option.id}
                  onChange={() => setRange(option)}
                />
                {option.label}
              </label>
            )}
          </For>
        </div>
        <button type="button" class="generate" disabled={busy()} onClick={() => void generate()}>
          {busy() ? "Skriver…" : "Lag oppsummering"}
        </button>
      </div>

      <p class="muted">
        {formatShort(from())}–{formatShort(props.endDay)}
      </p>

      <Show when={error()}>
        <p class="login-error" role="alert">
          {error()}
        </p>
      </Show>

      <Loading fallback={<p class="muted">laster…</p>}>
        <Show
          when={all().length > 0}
          fallback={<p class="muted">Ingen oppsummeringer ennå.</p>}
        >
          <ul class="summary-list">
            <For each={all()}>
              {(summary) => (
                <li class={open() === summary.id ? "summary open" : "summary"}>
                  <button
                    type="button"
                    class="summary-head"
                    aria-expanded={open() === summary.id ? "true" : "false"}
                    onClick={() => {
                      setOpen(open() === summary.id ? null : summary.id);
                    }}
                  >
                    <span>
                      {formatShort(summary.from)}–{formatShort(summary.to)}
                    </span>
                    <small>
                      {summary.loggedDays}/{summary.totalDays} dager ført
                    </small>
                  </button>
                  <Show when={open() === summary.id}>
                    <div class="summary-body">
                      <p class="recap">{summary.recap}</p>
                      <h3>Til veterinæren</h3>
                      <pre class="brief">{summary.brief}</pre>
                      <button
                        type="button"
                        class="copy"
                        onClick={() => void navigator.clipboard.writeText(summary.brief)}
                      >
                        Kopier
                      </button>
                    </div>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Loading>
    </section>
  );
}
