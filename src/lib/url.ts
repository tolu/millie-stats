// The selected day lives in the URL so a day is linkable and the back button
// works. Anything arriving here is untrusted: ?d= is user-supplied.

import { isDay, osloDay } from "./date";

/**
 * The day to show on load. Falls back to today for anything malformed, and
 * refuses future days — you cannot log a walk that has not happened.
 */
export function dayFromSearch(search: string, today: string = osloDay()): string {
  const requested = new URLSearchParams(search).get("d");
  if (!requested || !isDay(requested)) return today;
  return requested > today ? today : requested;
}

export function searchForDay(day: string, today: string = osloDay()): string {
  return day === today ? "" : `?d=${day}`;
}
