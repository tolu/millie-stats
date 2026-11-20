// A debounce that can be flushed with exactly what it is holding.
//
// The note waits out a debounce before it is queued, and has to be flushed
// early — on a change of day, on leaving the page, when the tab is put away.
// Flushing used to read the draft signal back, but signal writes are batched:
// a keystroke and a flush in the same tick read the value from before the
// keystroke, queued that, and cancelled the timer that held the right one.
// Holding the value here makes that impossible, and makes "is a note
// pending?" a fact rather than a guess, so a flush with nothing pending saves
// nothing.

export type Debounced<T> = {
  /** Replaces whatever is pending; `fire` runs with it after the delay. */
  schedule(value: T): void;
  /** Runs `fire` now with the pending value, if there is one. */
  flush(): void;
  /** Drops the pending value without running `fire`. */
  cancel(): void;
};

export function createDebounced<T>(fire: (value: T) => void, ms: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { value: T } | undefined;

  function cancel() {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  }

  function flush() {
    const held = pending;
    cancel();
    if (held) fire(held.value);
  }

  return {
    schedule(value) {
      cancel();
      pending = { value };
      timer = setTimeout(flush, ms);
    },
    flush,
    cancel,
  };
}
