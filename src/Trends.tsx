import { createMemo, createSignal, For, Loading, Show } from "solid-js";
import { SYMPTOMS } from "./symptoms";
import { formatShort, lastNDays } from "./lib/date";
import type { DayEntry } from "./lib/entry";
import { coverage, rollingAverage, seriesFor, statsFor } from "./lib/trends";
import type { EntriesByDay, Presence } from "./lib/trends";
import { BASELINE_KG, formatKg, weightView } from "./lib/weight";
import type { Measurement, WeightPoint } from "./lib/weight";
import { getRange, lastWeight } from "./server/db";

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

  // The window's rows, plus the last weigh-in before it. The anchor is a
  // separate one-row query rather than a wider range fetch: the chart needs
  // one measurement, not months of extra days, and a bounded query cannot miss
  // one that happens to fall outside an arbitrary lookback.
  const data = createMemo(async () => {
    props.version; // re-read after a save
    const span = days();
    const first = span[0];
    const last = span.at(-1);
    if (!first || !last) {
      return { entries: new Map<string, DayEntry>(), anchor: null };
    }
    const [records, anchor] = await Promise.all([
      getRange(first, last),
      lastWeight(first),
    ]);
    return { entries: new Map(records.map((r) => [r.day, r.entry])), anchor };
  });

  const entries = createMemo(() => data().entries);
  const anchor = createMemo(() => data().anchor);

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

          <WeightPanel days={days()} entries={entries()} anchor={anchor()} />

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

/**
 * Weight over the window.
 *
 * The dots are the truth and the line is inference, so the measured days are
 * drawn as solid points. Same instinct as the three-state symptom strip — the
 * eye must be able to tell what was observed from what was filled in.
 */
function WeightPanel(props: {
  days: string[];
  entries: EntriesByDay;
  anchor: Measurement | null;
}) {
  const view = createMemo(() => weightView(props.days, props.entries, props.anchor));

  // Read through memos rather than a <Show> callback, which does not re-run
  // while its condition stays truthy. Each guards on the view itself, so no
  // fallback value can ever reach a formatter — an earlier version rendered
  // `formatKg(latest()?.kg ?? 0)` and showed a bold "0,0 kg" for a live dog
  // whenever the only weigh-in predated the window.
  const points = createMemo((): WeightPoint[] => [...(view()?.points ?? [])]);
  const reading = createMemo(() => {
    const latest = view()?.latest;
    return latest === undefined ? "" : `${formatKg(latest.kg)} kg`;
  });
  const weighedOn = createMemo(() => {
    const latest = view()?.latest;
    return latest === undefined ? "" : formatShort(latest.day);
  });

  return (
    <section class="weight" aria-labelledby="weight-heading">
      <h3 id="weight-heading">Vekt</h3>
      <Show
        when={view()}
        fallback={<p class="muted">Ingen veiinger ennå — trykk «Vekt» øverst.</p>}
      >
        <p class="weight-read">
          <strong>{reading()}</strong>
          <span class="muted">
            {" · "}
            veid {weighedOn()}
          </span>
        </p>
        <div class="weight-chart">
          <WeightChart points={points()} />
        </div>
      </Show>
    </section>
  );
}

/** A weight range narrower than this is noise; letting it fill the chart
 *  would turn 100 grams of normal variation into a cliff. */
const MIN_SPAN_KG = 1;

function WeightChart(props: { points: WeightPoint[] }) {
  const W = 100;
  const H = 40;

  const bounds = createMemo(() => {
    const values = props.points
      .map((p) => p.kg)
      .filter((kg): kg is number => kg !== null);
    // The baseline is always in range: a chart of her weight that cannot show
    // normal is not telling you the thing you came for.
    let min = Math.min(...values, BASELINE_KG);
    let max = Math.max(...values, BASELINE_KG);
    const span = max - min;
    if (span < MIN_SPAN_KG) {
      const grow = (MIN_SPAN_KG - span) / 2;
      min -= grow;
      max += grow;
    }
    const pad = (max - min) * 0.12;
    return { min: min - pad, max: max + pad };
  });

  const x = (index: number): number => {
    const count = props.points.length;
    return count <= 1 ? W / 2 : (index / (count - 1)) * W;
  };
  const y = (kg: number): number => {
    const { min, max } = bounds();
    return H - ((kg - min) / (max - min)) * H;
  };

  const line = createMemo(() =>
    props.points.map((p, i) => `${x(i).toFixed(2)},${y(p.kg).toFixed(2)}`).join(" "),
  );

  const dots = createMemo(() =>
    props.points.map((p, i) => ({ ...p, i })).filter((p) => p.measured),
  );

  const summary = createMemo(() => {
    const measured = dots();
    const first = measured[0];
    const last = measured[measured.length - 1];
    if (!first || !last) return "Vekt over perioden";
    const count = measured.length;
    const times = count === 1 ? "1 veiing" : `${count} veiinger`;
    if (count === 1) return `Vekt ${formatKg(first.kg)} kg, ${times}`;
    return `Vekt fra ${formatKg(first.kg)} til ${formatKg(last.kg)} kg over ${times}`;
  });

  // Where the baseline sits, as a fraction of the plot's height. The label is
  // HTML rather than SVG <text>: preserveAspectRatio="none" stretches the
  // drawing horizontally, which would leave the text visibly distorted.
  const baselineOffset = createMemo(() => ((y(BASELINE_KG) + 3) / (H + 6)).toFixed(4));

  return (
    <div class="weight-plot">
    <svg
      class="weight-svg"
      viewBox={`0 -3 ${W} ${H + 6}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${summary()}. Stiplet referanselinje ved ${formatKg(BASELINE_KG)} kg.`}
    >
      <line
        class="weight-baseline"
        x1="0"
        y1={y(BASELINE_KG)}
        x2={W}
        y2={y(BASELINE_KG)}
      />
      <polyline class="weight-line" points={line()} />
      <For each={dots()}>
        {(point) => (
          // A zero-length line with a round cap, not a <circle>: the chart
          // stretches to its container with preserveAspectRatio="none", which
          // squashes a circle into an ellipse. Stroke width is immune to that
          // under non-scaling-stroke, so the cap stays a true dot at any width.
          <line
            class="weight-dot"
            x1={x(point.i)}
            y1={y(point.kg)}
            x2={x(point.i)}
            y2={y(point.kg)}
          >
            <title>
              {formatShort(point.day)}: {formatKg(point.kg)} kg
            </title>
          </line>
        )}
      </For>
    </svg>
      <span class="weight-ref" style={{ "--pos": baselineOffset() }} aria-hidden="true">
        {/* "16 kg", not "16,0 kg": it is a round reference, and the gutter it
            sits in is width taken from the chart. */}
        {Number.isInteger(BASELINE_KG) ? BASELINE_KG : formatKg(BASELINE_KG)} kg
      </span>
    </div>
  );
}
