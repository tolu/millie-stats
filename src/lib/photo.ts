// Photo identity and addressing.
//
// Pure by design — no bindings, no DOM — so the upload route, the serve route,
// the client and the tests all agree on one set of rules rather than each
// growing its own idea of what a valid photo URL looks like.

import { isDay } from "./date";

/** Enough for one incident. Also keeps a day's thumbnails to one grid row. */
export const MAX_PHOTOS_PER_DAY = 5;

/**
 * The display copy is resized client-side to 1600px on its long edge, which
 * lands well under this. The route still checks: the client is the thing being
 * defended against, not a thing to trust.
 */
export const MAX_UPLOAD_BYTES = 2_000_000;

export type PhotoVariant = "full" | "thumb";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isPhotoId(value: string): boolean {
  return UUID.test(value);
}

/**
 * The R2 key for one variant.
 *
 * The day is part of the key so the bucket is browsable by hand, and so the
 * serve route can build the key straight from its own path — rendering five
 * thumbnails would otherwise cost five D1 lookups for nothing.
 *
 * No file extension: which format the uploading browser could encode is not
 * fixed (Safari and Chrome disagree about WebP), and R2 carries the content
 * type in its own metadata anyway.
 */
export function photoKey(day: string, id: string, variant: PhotoVariant): string {
  return variant === "thumb" ? `${day}/${id}-thumb` : `${day}/${id}`;
}

/** The URL the client renders or deletes. Mirror of parsePhotoPath. */
export function photoUrl(day: string, id: string, variant: PhotoVariant): string {
  return variant === "thumb" ? `/_photo/${day}/${id}/thumb` : `/_photo/${day}/${id}`;
}

export type PhotoPath = {
  readonly day: string;
  readonly id: string;
  readonly variant: PhotoVariant;
};

/**
 * Parses `/_photo/{day}/{id}` and `/_photo/{day}/{id}/thumb`.
 *
 * Returns null for anything else, which is also what closes path traversal:
 * a segment containing `..` is neither a calendar day nor a uuid, so it can
 * never reach photoKey. The day is validated with isDay rather than a shape
 * regex, so `2026-02-31` is rejected too.
 */
export function parsePhotoPath(pathname: string): PhotoPath | null {
  const parts = pathname.split("/");
  // ["", "_photo", day, id] or ["", "_photo", day, id, "thumb"]
  if (parts.length < 4 || parts.length > 5) return null;
  if (parts[0] !== "" || parts[1] !== "_photo") return null;

  const day = parts[2] ?? "";
  const id = parts[3] ?? "";
  if (!isDay(day) || !isPhotoId(id)) return null;

  if (parts.length === 4) return { day, id, variant: "full" };
  return parts[4] === "thumb" ? { day, id, variant: "thumb" } : null;
}
