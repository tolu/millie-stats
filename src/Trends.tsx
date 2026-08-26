import { createMemo, createSignal, For, Loading, Show } from "solid-js";
import { SYMPTOMS } from "./symptoms";
import { formatShort, lastNDays } from "./lib/date";
import type { DayEntry } from "./lib/entry";
import { coverage, rollingAverage, seriesFor, statsFor } from "./lib/trends";
import type { Presence } from "./lib/trends";
import { getRange } from "./server/db";

const ROLLING_WINDOW = 7;

type Props = {
  /** The last day of the window — normally today. */
  endDay: string;
  /** Bumped after every save so the charts pick up the current day's edit. */
  version: number;
};

const WINDOWS = [30, 90] as const;

export default function Trends(props: Props) {
  const [span, setSpan] = createSignal<30 | 90>(30);
  const days = createMemo(() => lastNDays(props.endDay, span()));

  const entries = createMemo(async () => {
    props.version; // re-read after a save
    const span = days();
    const first = span[0];
    const last = span.at(-1);
    if (!first || !last) return new Map<string, DayEntry>();
    const records = await getRange(first, last);
    return new Map(records.map((r) => [r.day, r.entry]));
  });

  const cover = createMemo(() => coverage(days(), entries()));

  return (
    <section class="trends" aria-labelledby="trends-heading">
      <div class="trends-head">
        <h2 id="trends-heading">Siste {span()} dager</h2>
        <div class="window-toggle" role="group" aria-label="Lengde på perioden">
          <For each={WINDOWS}>
            {(size) => (
              <label>
                <input
                  type="radio"
                  name="window"
                  checked={span() === size}
                  onChange={() => setSpan(size)}
                />
                {size}
              </label>
            )}
          </For>
        </div>
      </div>

      <Loading fallback={<p class="muted">laster trender…</p>}>
        <p class="muted">
          {cover().logged} av {cover().total} dager ført
          <Show when={cover().logged > 0}>
            {" · "}
            {formatShort(days()[0] ?? props.endDay)}–{formatShort(props.endDay)}
          </Show>
        </p>

        <Show
          when={cover().logged > 0}
          fallback={<p class="muted">Ingen registreringer i denne perioden ennå.</p>}
        >
          <div class="heat">
            <For each={SYMPTOMS}>
              {(symptom) => {
                const series = createMemo(() =>
                  seriesFor(days(), entries(), symptom.id),
                );
                const stats = createMemo(() =>
                  statsFor(days(), entries(), symptom.id),
                );
                return (
                  <>
                    <span class="heat-name">{symptom.label}</span>
                    <span class="heat-count">
                      {stats().hits}/{stats().loggedDays}
                    </span>
                    <Strip series={series()} days={days()} label={symptom.label} />
                  </>
                );
              }}
            </For>
          </div>

          <h3>Snitt over {ROLLING_WINDOW} dager</h3>
          <div class="sparks">
            <For each={SYMPTOMS}>
              {(symptom) => {
                const rolling = createMemo(() =>
                  rollingAverage(seriesFor(days(), entries(), symptom.id), ROLLING_WINDOW),
                );
                const latest = createMemo(() => {
                  for (let i = rolling().length - 1; i >= 0; i--) {
                    const value = rolling()[i];
                    if (value !== null && value !== undefined) return value;
                  }
                  return null;
                });
                return (
                  <figure class="spark">
                    <figcaption>
                      <span>{symptom.label}</span>
                      <strong>
                        {latest() === null ? "–" : `${Math.round((latest() ?? 0) * 100)}%`}
                      </strong>
                    </figcaption>
                    <Sparkline values={rolling()} label={symptom.label} />
                  </figure>
                );
              }}
            </For>
          </div>
        </Show>
      </Loading>
    </section>
  );
}

/**
 * One symptom's day-by-day strip.
 *
 * Three states, not two: a bright cell is a hit, a grey cell is a day that was
 * logged with nothing wrong, and a nearly invisible cell is a day nobody
 * filled in. Collapsing the last two would turn gaps into good news.
 */
function Strip(props: { series: Presence[]; days: string[]; label: string }) {
  const CELL = 4;
  const GAP = 1;
  const width = createMemo(() => props.series.length * (CELL + GAP) - GAP);

  return (
    <svg
      class="heat-strip"
      viewBox={`0 0 ${width()} ${CELL}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${props.label}: ${props.series.filter((v) => v === 1).length} dager av ${props.series.filter((v) => v !== null).length} ført`}
    >
      <For each={props.series}>
        {(value, index) => (
          <rect
            x={index() * (CELL + GAP)}
            y={0}
            width={CELL}
            height={CELL}
            rx={1}
            fill={
              value === 1
                ? "var(--blue)"
                : value === 0
                  ? "var(--line-strong)"
                  : "var(--heat-empty)"
            }
          >
            <title>{props.days[index()]}</title>
          </rect>
        )}
      </For>
    </svg>
  );
}

/**
 * Small multiples rather than one four-series chart: four lines overlaid on a
 * phone are unreadable, and four shades of the same blue are indistinguishable.
 * A gap in the data breaks the line instead of being interpolated across.
 */
function Sparkline(props: { values: (number | null)[]; label: string }) {
  const W = 100;
  const H = 28;

  const segments = createMemo(() => {
    const out: string[] = [];
    let current: string[] = [];
    const count = props.values.length;
    props.values.forEach((value, i) => {
      if (value === null || value === undefined) {
        if (current.length > 1) out.push(current.join(" "));
        current = [];
        return;
      }
      const x = count === 1 ? W / 2 : (i / (count - 1)) * W;
      const y = H - value * H;
      current.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    });
    if (current.length > 1) out.push(current.join(" "));
    return out;
  });

  return (
    <svg
      class="spark-svg"
      viewBox={`0 -2 ${W} ${H + 4}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Utvikling for ${props.label}`}
    >
      <line x1="0" y1={H} x2={W} y2={H} class="spark-base" />
      <For each={segments()}>
        {(points) => <polyline points={points} class="spark-line" />}
      </For>
    </svg>
  );
}
