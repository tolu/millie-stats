import { describe, expect, it, vi } from "vitest";
import { createWriteQueue } from "./writeQueue";
import type { WriteState } from "./writeQueue";

// These assertions are about ordering, not latency, so every waitFor gets a
// generous timeout: the default 1s can be missed on a loaded machine and turn
// a correct queue into a red build.
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createWriteQueue", () => {
  it("applies writes in the order they were issued, not the order they finish", async () => {
    // The data-loss scenario: a slow first write and a fast second one. If they
    // ran concurrently the slow one would land last and undo the newer edit.
    const first = deferred();
    const second = deferred();
    const landed: string[] = [];

    const queue = createWriteQueue<string>(async (value) => {
      if (value === "a") await first.promise;
      if (value === "b") await second.promise;
      landed.push(value);
    }, () => {});

    queue.push("a");
    queue.push("b");

    second.resolve(); // the later write becomes ready first...
    await Promise.resolve();
    expect(landed).toEqual([]); // ...and still has to wait

    first.resolve();
    await vi.waitFor(() => expect(landed).toEqual(["a", "b"]), { timeout: 5000 });
  });

  it("reports saving then saved", async () => {
    const states: WriteState[] = [];
    const queue = createWriteQueue<string>(async () => {}, (s) => states.push(s));
    queue.push("x");
    await vi.waitFor(() => expect(states).toContain("saved"), { timeout: 5000 });
    expect(states[0]).toBe("saving");
  });

  it("stays in saving until the last queued write lands", async () => {
    const gate = deferred();
    const states: WriteState[] = [];
    const queue = createWriteQueue<string>(async () => await gate.promise, (s) =>
      states.push(s),
    );
    queue.push("x");
    queue.push("y");
    expect(states.filter((s) => s === "saved")).toHaveLength(0);
    gate.resolve();
    await vi.waitFor(() => expect(states.at(-1)).toBe("saved"), { timeout: 5000 });
    // One "saved", not one per write.
    expect(states.filter((s) => s === "saved")).toHaveLength(1);
  });

  it("surfaces the error message", async () => {
    let captured = "";
    const queue = createWriteQueue<string>(
      async () => {
        throw new Error("D1 unavailable");
      },
      (state, error) => {
        if (state === "error") captured = error ?? "";
      },
    );
    queue.push("x");
    await vi.waitFor(() => expect(captured).toBe("D1 unavailable"), { timeout: 5000 });
  });

  it("still writes after detach — switching day must not discard typed input", async () => {
    const gate = deferred();
    const landed: string[] = [];
    const states: WriteState[] = [];
    const queue = createWriteQueue<string>(async (v) => {
      await gate.promise;
      landed.push(v);
    }, (s) => states.push(s));

    queue.push("note typed just before navigating");
    queue.detach();
    gate.resolve();
    await vi.waitFor(() => expect(landed).toEqual(["note typed just before navigating"]), {
      timeout: 5000,
    });
    // ...but its completion no longer reports against the new day.
    expect(states.at(-1)).toBe("idle");
  });
});
