// A page loaded before a deploy cannot talk to the worker after it.
//
// @solidjs/vite-plugin stamps every server-function call with the id of the
// build that served the page, and a worker from another build answers 409
// without running the function. The client rejects that call — and the 404
// for an id the new build lacks — with `unknownFunction: true`. That is the
// right default: every save carries the whole day, so an old page writing an
// old shape could drop a field the new one added. But the id is random per
// build, so EVERY deploy strands a tab left open on the phone.

/** Whether a failed server-function call came from a page older than the worker. */
export function isStaleBuild(cause: unknown): boolean {
  return cause instanceof Error && (cause as { unknownFunction?: unknown }).unknownFunction === true;
}

export const STALE_BUILD_MESSAGE = "Appen er oppdatert. Last inn siden på nytt.";

/**
 * The text to show for a failure. The plugin's own message for a stale page is
 * English and names an implementation detail; this one says what to do.
 */
export function errorMessage(cause: unknown): string {
  if (isStaleBuild(cause)) return STALE_BUILD_MESSAGE;
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * What a reload would throw away, as it is visible on the page: an open
 * dialog (a weight being typed, a workout being edited, a dictation, a photo
 * awaiting "Sikker? Slett") or a save that has not landed. A save that failed
 * still holds the only copy of the edit, so it counts too.
 */
export const UNSAVED_WORK =
  'dialog[open], output.status[data-state="saving"], output.status[data-state="error"]';
