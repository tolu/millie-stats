import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebounced } from "./debounce";

describe("createDebounced", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires the last value once the delay has passed", () => {
    const fired: string[] = [];
    const note = createDebounced<string>((v) => fired.push(v), 500);
    note.schedule("a");
    note.schedule("ab");
    vi.advanceTimersByTime(499);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual(["ab"]);
  });

  it("flushes exactly the value it holds, at once and only once", () => {
    // The bug: flushing read the draft signal back, got the value from before
    // the last keystroke, and cancelled the timer holding the right one.
    const fired: string[] = [];
    const note = createDebounced<string>((v) => fired.push(v), 500);
    note.schedule("typed just before the tab was put away");
    note.flush();
    expect(fired).toEqual(["typed just before the tab was put away"]);
    vi.advanceTimersByTime(1000);
    expect(fired).toHaveLength(1);
  });

  it("saves nothing when flushed with nothing pending", () => {
    // Leaving for the journal flushes, and so does the unmount that follows;
    // the second must not queue the whole day again.
    const fired: string[] = [];
    const note = createDebounced<string>((v) => fired.push(v), 500);
    note.flush();
    note.schedule("x");
    vi.advanceTimersByTime(500);
    note.flush();
    expect(fired).toEqual(["x"]);
  });

  it("drops the pending value on cancel", () => {
    // A tick saves the whole day, note included, so the note's own save is
    // redundant from then on.
    const fired: string[] = [];
    const note = createDebounced<string>((v) => fired.push(v), 500);
    note.schedule("x");
    note.cancel();
    note.flush();
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });
});
