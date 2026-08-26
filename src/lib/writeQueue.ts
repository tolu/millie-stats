// Serialises saves so that overlapping edits cannot land out of order.
//
// The bug this exists to prevent: tick a box, then immediately type a note.
// Two writes go out; if the second finishes first, the slower one lands last
// and reinstates the older entry. Every write carries the WHOLE day, so
// last-write-wins is only safe when "last" means last-issued, not
// last-to-return. Queueing gives us that.

export type WriteState = "idle" | "saving" | "saved" | "error";

export type WriteQueue<T> = {
  /** Queue a write. Later calls always land after earlier ones. */
  push(value: T): void;
  /**
   * Stop reporting status for writes issued so far. It deliberately does NOT
   * cancel them: a queued write carries real user input, and dropping it to
   * tidy up a status line would lose data.
   */
  detach(): void;
};

export function createWriteQueue<T>(
  write: (value: T) => Promise<unknown>,
  onState: (state: WriteState, error?: string) => void,
): WriteQueue<T> {
  let chain: Promise<unknown> = Promise.resolve();
  let inFlight = 0;
  let generation = 0;

  return {
    push(value: T) {
      const era = generation;
      inFlight++;
      onState("saving");
      chain = chain
        .then(async () => {
          // The write always runs. Only the status reporting is scoped to the
          // era it was issued in, so a save for yesterday cannot flash
          // "lagret" over today.
          await write(value);
          if (era === generation && inFlight === 1) onState("saved");
        })
        .catch((cause: unknown) => {
          if (era !== generation) return;
          onState("error", cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          inFlight--;
        });
    },
    detach() {
      generation++;
      onState("idle");
    },
  };
}
