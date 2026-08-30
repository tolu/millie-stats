// The route lives in the query string so a day, or the journal, is linkable
// and survives a reload. Anything arriving here is untrusted.

import { isDay, osloDay } from "./date";

export type View = "day" | "journal";

/**
 * `view` and `day` are orthogonal: `day` is which day is selected, `view` is
 * which page is showing it. The journal keeps the day so that leaving it
 * returns to the day you came from rather than to today.
 */
export type Route = { readonly view: View; readonly day: string };

/**
 * The day to show on load. Falls back to today for anything malformed, and
 * refuses future days — you cannot log a walk that has not happened.
 */
export function dayFromSearch(search: string, today: string = osloDay()): string {
  const requested = new URLSearchParams(search).get("d");
  if (!requested || !isDay(requested)) return today;
  return requested > today ? today : requested;
}

/**
 * The whole route. Only the exact string "journal" opens the journal —
 * anything else falls back to the day view, because an unrecognised ?view=
 * must land on a working page rather than a blank one.
 */
export function routeFromSearch(search: string, today: string = osloDay()): Route {
  const view: View =
    new URLSearchParams(search).get("view") === "journal" ? "journal" : "day";
  return { view, day: dayFromSearch(search, today) };
}

/** The query string for a route. Today's day view keeps a clean URL. */
export function searchForRoute(route: Route, today: string = osloDay()): string {
  const parts: string[] = [];
  if (route.view === "journal") parts.push("view=journal");
  if (route.day !== today) parts.push(`d=${route.day}`);
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}
