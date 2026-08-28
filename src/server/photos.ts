// Photo storage: the D1 index and the R2 objects, kept in step.
//
// Bindings are passed in rather than reached through
// `import("cloudflare:workers")`. src/worker.ts is imported in *Node* to
// prerender the document shell, so nothing on that import path may touch the
// cloudflare: scheme — and narrow parameters keep this module from dragging an
// app-wide Env into every consumer's typecheck.
//
// This file has no "use server" directive on purpose: it is plain code called
// by the worker routes and by db.ts, not a set of RPC endpoints. Its arguments
// are bindings, which could never cross the wire anyway.

import { EMPTY_ENTRY, serializeEntry } from "../lib/entry";
import { photoKey } from "../lib/photo";

export type PhotoRecord = {
  readonly id: string;
  readonly day: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly createdAt: string;
};

type Row = {
  id: string;
  day: string;
  width: number;
  height: number;
  bytes: number;
  created_at: string;
};

function toRecord(row: Row): PhotoRecord {
  return {
    id: row.id,
    day: row.day,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    createdAt: row.created_at,
  };
}

/** Oldest first — the order they happened in, and the order of the index. */
export async function listPhotos(db: D1Database, day: string): Promise<PhotoRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT id, day, width, height, bytes, created_at FROM photos
       WHERE day = ?1
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(day)
    .all<Row>();
  return results.map(toRecord);
}

export async function countPhotos(db: D1Database, day: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM photos WHERE day = ?1`)
    .bind(day)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function insertPhoto(
  db: D1Database,
  photo: { id: string; day: string; width: number; height: number; bytes: number },
): Promise<PhotoRecord> {
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO photos (id, day, width, height, bytes, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(photo.id, photo.day, photo.width, photo.height, photo.bytes, createdAt)
    .run();
  return { ...photo, createdAt };
}

/**
 * Removes one photo. The row goes first and the objects after: a failure
 * between the two leaves an orphaned object, which is invisible and costs a
 * fraction of a cent. The opposite order would leave a row whose image 404s —
 * a visibly broken app. Upload runs the same trade the other way round.
 *
 * Returns false when there was no such photo, so the caller can answer 404.
 */
export async function deletePhoto(
  db: D1Database,
  bucket: R2Bucket,
  day: string,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM photos WHERE id = ?1 AND day = ?2`)
    .bind(id, day)
    .run();
  if (!result.meta.changes) return false;
  await bucket.delete([photoKey(day, id, "full"), photoKey(day, id, "thumb")]);
  return true;
}

/** Every photo on a day, bytes included. Used when a whole day is cleared. */
export async function deletePhotosForDay(
  db: D1Database,
  bucket: R2Bucket,
  day: string,
): Promise<void> {
  const photos = await listPhotos(db, day);
  if (photos.length === 0) return;
  await db.prepare(`DELETE FROM photos WHERE day = ?1`).bind(day).run();
  await bucket.delete(
    photos.flatMap((p) => [photoKey(day, p.id, "full"), photoKey(day, p.id, "thumb")]),
  );
}

/**
 * Marks a day as logged if it is not already, without touching it if it is.
 *
 * Uploading a photo means the day was filled in, and "logged" has exactly one
 * definition everywhere in this app: a row in `days` (see lib/trends.ts). This
 * gives a photo that meaning without teaching trends, coverage and the AI
 * prompt a second one.
 *
 * DO NOTHING rather than saveDay's DO UPDATE is load-bearing twice over: it
 * cannot wipe a day that already has ticks and a note, and it makes the order
 * against a concurrent queued save irrelevant in both directions.
 */
export async function ensureDay(db: D1Database, day: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO days (day, data, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(day) DO NOTHING`,
    )
    .bind(day, serializeEntry(EMPTY_ENTRY), new Date().toISOString())
    .run();
}
