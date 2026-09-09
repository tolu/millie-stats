import { createMemo, createSignal, flush, For, Show, untrack } from "solid-js";
import { addDays, formatLong, formatShort, formatWeekday, rangeDays, startOfWeek } from "./lib/date";
import { isWorkoutDone } from "./lib/entry";
import type { DayEntry } from "./lib/entry";
import { isActiveOn, MAX_PER_WEEK, weekProgress } from "./lib/workouts";
import type { Workout } from "./lib/workouts";
import { getRange, listWorkouts, retireWorkout, saveWorkout } from "./server/db";

/**
 * The day's workouts: one tile per routine that applies to the day, with its
 * tick, how the week is going, and the dialog that defines them.
 *
 * Self-contained the way Photos and Weight are: it fetches its own
 * definitions and the week's rows, and owns its own dialog. The day view only
 * hands it the entry, takes the tick back through `onToggle`, and hears
 * `onChanged` when a definition changed so the charts refetch.
 */
export default function Workouts(props: {
  day: string;
  today: string;
  /** The day's entry, draft included, so a tick counts before it is saved. */
  entry: DayEntry;
  onToggle: (workoutId: string, done: boolean) => void;
  /** A definition was created, edited or retired. */
  onChanged: () => void;
}) {
  // Suspends once, at mount, alongside the day itself. Edits go through the
  // overlay below rather than a refetch: a re-suspending memo would blank the
  // whole page, since <main> sits in one <Loading>.
  const stored = createMemo(async () => await listWorkouts());
  const [edited, setEdited] = createSignal<Workout[] | null>(null);
  const workouts = createMemo((): Workout[] => edited() ?? stored());

  const active = createMemo(() => workouts().filter((w) => isActiveOn(w, props.day)));

  // The week's rows, keyed on the day like Photos' list. Other days in the
  // week only change by browsing to them, which changes the day and refetches.
  // The viewed day itself comes from props, so the count follows the checkbox.
  const weekStart = createMemo(() => startOfWeek(props.day));
  const weekDays = createMemo(() => rangeDays(weekStart(), addDays(weekStart(), 6)));
  const fetched = createMemo(async () => {
    const days = weekDays();
    return await getRange(days[0] ?? props.day, days[6] ?? props.day);
  });
  const weekEntries = createMemo(() => {
    const map = new Map(fetched().map((r) => [r.day, r.entry]));
    map.set(props.day, props.entry);
    return map;
  });

  const thisWeek = createMemo(() => weekStart() === startOfWeek(props.today));

  // ---- the dialog ----

  let dialog!: HTMLDialogElement;
  let nameField!: HTMLInputElement;
  let perWeekField!: HTMLInputElement;
  let startField!: HTMLInputElement;
  let descriptionField!: HTMLTextAreaElement;

  const [editing, setEditing] = createSignal<Workout | null>(null);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [confirming, setConfirming] = createSignal(false);

  function open(workout: Workout | null) {
    setEditing(workout);
    setError("");
    setConfirming(false);
    // flush() before touching the fields: Solid 2 commits setters on a
    // microtask, so the prefill would otherwise land on the previous state.
    flush();
    nameField.value = workout?.name ?? "";
    perWeekField.value = String(workout?.perWeek ?? 3);
    startField.value = workout?.startDay ?? props.today;
    descriptionField.value = workout?.description ?? "";
    dialog.showModal();
    nameField.focus();
  }

  function upsert(workout: Workout) {
    // The base comes from the current list, never from a value captured when
    // the dialog opened: signal writes are batched.
    const current = untrack(workouts);
    const next = current.some((w) => w.id === workout.id)
      ? current.map((w) => (w.id === workout.id ? workout : w))
      : [...current, workout];
    setEdited(next);
    props.onChanged();
  }

  async function save() {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      const reply = await saveWorkout({
        id: editing()?.id ?? null,
        name: nameField.value,
        description: descriptionField.value,
        perWeek: Number(perWeekField.value),
        startDay: startField.value,
      });
      if (!reply.ok) {
        setError(reply.message);
        return;
      }
      upsert(reply.workout);
      dialog.close();
    } catch {
      setError("Kunne ikke lagre øvelsen");
    } finally {
      setBusy(false);
    }
  }

  async function retire() {
    const workout = editing();
    if (!workout || busy()) return;
    if (!confirming()) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const reply = await retireWorkout(workout.id, props.today);
      if (!reply.ok) {
        setError(reply.message);
        return;
      }
      upsert(reply.workout);
      dialog.close();
    } catch {
      setError("Kunne ikke avslutte øvelsen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.day === props.today || active().length > 0}>
      <section class="workouts" aria-labelledby="workouts-heading">
        <div class="workouts-head">
          <h2 id="workouts-heading">Øvelser</h2>
          <Show when={props.day === props.today}>
            <button type="button" class="add-photo" onClick={() => open(null)}>
              Ny øvelse
            </button>
          </Show>
        </div>

        <Show
          when={active().length > 0}
          fallback={<p class="muted">Ingen øvelser ennå. Legg til den første.</p>}
        >
          <For each={active()}>
            {(workout) => {
              const progress = createMemo(() => weekProgress(workout, weekDays(), weekEntries()));
              return (
                // Same anatomy as a symptom tile, so the checkbox, the ⓘ and
                // the popover come from the existing rules.
                <div class="symptom workout">
                  <label>
                    <input
                      type="checkbox"
                      checked={isWorkoutDone(props.entry, workout.id)}
                      onChange={(e) => props.onToggle(workout.id, e.currentTarget.checked)}
                    />
                    <span class="workout-text">
                      <span class="label">{workout.name}</span>
                      <span class="workout-count">
                        {progress().done} av {progress().target}{" "}
                        {thisWeek()
                          ? "denne uka"
                          : `uka ${formatShort(weekStart())}–${formatShort(addDays(weekStart(), 6))}`}
                      </span>
                    </span>
                  </label>

                  <ul class="week-marks" aria-label="Uka så langt">
                    <For each={weekDays()}>
                      {(day) => (
                        <li
                          class="week-mark"
                          data-state={markState(workout, day, weekEntries(), props.today)}
                          data-current={day === props.day ? "true" : "false"}
                        >
                          <span>{formatWeekday(day).slice(0, 2)}</span>
                        </li>
                      )}
                    </For>
                  </ul>

                  <button
                    type="button"
                    class="info"
                    popovertarget={`help-wk-${workout.id}`}
                    style={{ "anchor-name": `--anchor-wk-${workout.id}` }}
                    aria-label={`Slik gjør vi ${workout.name}`}
                  >
                    i
                  </button>
                  <div
                    popover
                    id={`help-wk-${workout.id}`}
                    class="help-pop workout-pop"
                    style={{ "position-anchor": `--anchor-wk-${workout.id}` }}
                  >
                    <strong>{workout.name}</strong>
                    <span class="workout-description">
                      {workout.description || `${workout.perWeek} ganger i uka.`}
                    </span>
                    <button
                      type="button"
                      class="add-photo"
                      onClick={(e) => {
                        // Close the popover first, or it stays open under the
                        // modal and comes back when the dialog closes.
                        e.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
                        open(workout);
                      }}
                    >
                      Rediger
                    </button>
                  </div>
                </div>
              );
            }}
          </For>
        </Show>

        <dialog class="weight-dialog workout-dialog" ref={dialog} onClose={() => setError("")}>
          <h2>{editing() ? "Rediger øvelse" : "Ny øvelse"}</h2>

          <label class="workout-field">
            <span>Navn</span>
            <input ref={nameField} type="text" autocomplete="off" />
          </label>

          <label class="workout-field">
            <span>Ganger i uka</span>
            <input
              ref={perWeekField}
              type="number"
              inputmode="numeric"
              min="1"
              max={String(MAX_PER_WEEK)}
              step="1"
            />
          </label>

          <label class="workout-field">
            <span>Fra og med</span>
            <input ref={startField} type="date" max={props.today} />
          </label>

          <label class="workout-field">
            <span>Slik gjør vi det</span>
            <textarea ref={descriptionField} placeholder="Øvelser, repetisjoner, hold…" />
          </label>

          <Show when={editing()?.endDay}>
            {(end) => <p class="muted">Avsluttet {formatLong(end())}.</p>}
          </Show>

          <Show when={error()}>
            <p class="login-error" role="alert">
              {error()}
            </p>
          </Show>

          <div class="weight-actions">
            <button type="button" class="close" onClick={() => dialog.close()}>
              Avbryt
            </button>
            <Show when={editing() && !editing()?.endDay}>
              <button type="button" class="delete" disabled={busy()} onClick={() => void retire()}>
                {confirming() ? "Sikker? Avslutt" : "Avslutt"}
              </button>
            </Show>
            <button type="button" class="save" disabled={busy()} onClick={() => void save()}>
              Lagre
            </button>
          </div>
        </dialog>
      </section>
    </Show>
  );
}

/**
 * What one cell of the week strip shows. Outside the workout's dates the cell
 * is blank rather than missed; a day still to come is not missed either.
 */
function markState(
  workout: Workout,
  day: string,
  entries: ReadonlyMap<string, DayEntry>,
  today: string,
): "done" | "missed" | "future" | "outside" {
  if (!isActiveOn(workout, day)) return "outside";
  const entry = entries.get(day);
  if (entry && isWorkoutDone(entry, workout.id)) return "done";
  if (day > today) return "future";
  return "missed";
}
