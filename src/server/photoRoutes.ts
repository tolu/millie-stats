// The three photo routes: upload, serve, delete.
//
// They are worker routes rather than server functions because a server
// function serialises its arguments — sending image bytes through one means
// base64, a 33% penalty paid on exactly the leg of the journey that is slowest.
//
// Authentication is NOT checked here. src/worker.ts gates the whole /_photo
// prefix before dispatching, the same way it gates /_server. One gate in front
// of the data surface fails closed; a check repeated per route fails open the
// first time someone forgets one.
//
// Bindings arrive as parameters, so nothing on this import path reaches for
// the cloudflare: scheme — src/worker.ts is imported in Node to prerender the
// document shell, and Node cannot resolve it.

import { isDay, osloDay } from "../lib/date";
import {
  MAX_PHOTOS_PER_DAY,
  MAX_UPLOAD_BYTES,
  parsePhotoPath,
  photoKey,
} from "../lib/photo";
import { countPhotos, deletePhoto, ensureDay, insertPhoto } from "./photos";

/** No real photo is this big on a side; anything larger is a lie or a bug. */
const MAX_EDGE = 20_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Expected failures are returned with a message the interface can show, the
 * same convention the server functions follow. Genuine faults are left to
 * throw.
 */
function refuse(message: string, status: number): Response {
  return json({ ok: false, message }, status);
}

function positiveInt(value: FormDataEntryValue | null, max: number): number | null {
  if (typeof value !== "string") return null;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 && n <= max ? n : null;
}

function imageBlob(value: FormDataEntryValue | null): Blob | null {
  if (!(value instanceof Blob)) return null;
  if (value.size === 0 || value.size > MAX_UPLOAD_BYTES) return null;
  if (!value.type.startsWith("image/")) return null;
  return value;
}

async function upload(
  request: Request,
  db: D1Database,
  bucket: R2Bucket,
  url: URL,
): Promise<Response> {
  const day = url.searchParams.get("d") ?? "";
  if (!isDay(day)) return refuse("Ugyldig dato", 400);
  // Same rule as the date navigation: you cannot log a walk that has not
  // happened yet.
  if (day > osloDay()) return refuse("Kan ikke legge til bilde fram i tid", 400);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse("Opplastingen var ikke lesbar", 400);
  }

  // The client resizes before sending, but the client is the thing being
  // defended against, not a thing to trust.
  const full = imageBlob(form.get("full"));
  const thumb = imageBlob(form.get("thumb"));
  if (!full || !thumb) return refuse("Bildet var for stort eller ikke et bilde", 413);

  const width = positiveInt(form.get("width"), MAX_EDGE);
  const height = positiveInt(form.get("height"), MAX_EDGE);
  if (width === null || height === null) return refuse("Bildet manglet størrelse", 400);

  // Two tabs racing could land a sixth photo. Single-user app; a transaction
  // to prevent one photo of overshoot is not worth the machinery.
  if ((await countPhotos(db, day)) >= MAX_PHOTOS_PER_DAY) {
    return refuse(`Maks ${MAX_PHOTOS_PER_DAY} bilder per dag`, 409);
  }

  const id = crypto.randomUUID();

  // R2 before D1, deliberately. A failure between the two leaves an orphaned
  // object: invisible, and a fraction of a cent. The other order would leave a
  // row whose image 404s, which is a visibly broken app. Delete runs the same
  // trade the other way round.
  await Promise.all([
    bucket.put(photoKey(day, id, "full"), full, {
      httpMetadata: { contentType: full.type },
    }),
    bucket.put(photoKey(day, id, "thumb"), thumb, {
      httpMetadata: { contentType: thumb.type },
    }),
  ]);

  const record = await insertPhoto(db, { id, day, width, height, bytes: full.size });
  // A photo means the day was filled in. This is the only place that decision
  // is made; everything downstream still reads "logged" as a row in `days`.
  await ensureDay(db, day);

  return json({ ok: true, photo: record });
}

async function serve(
  bucket: R2Bucket,
  day: string,
  id: string,
  variant: "full" | "thumb",
): Promise<Response> {
  const object = await bucket.get(photoKey(day, id, variant));
  if (!object) return new Response(null, { status: 404 });

  const headers = new Headers();
  // Carries the content type R2 stored at upload, so the encode format the
  // browser happened to pick travels with the object.
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Immutable because the id is a uuid and the bytes never change. `private`
  // because these are behind a login and must never reach a shared cache.
  headers.set("cache-control", "private, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}

/**
 * Dispatches everything under /_photo. Returns 404 for a shape it does not
 * recognise, which is also what closes path traversal — see parsePhotoPath.
 */
export async function handlePhotoRequest(
  request: Request,
  db: D1Database,
  bucket: R2Bucket,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/_photo") {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    return upload(request, db, bucket, url);
  }

  const path = parsePhotoPath(url.pathname);
  if (!path) return new Response(null, { status: 404 });

  if (request.method === "GET") {
    return serve(bucket, path.day, path.id, path.variant);
  }

  if (request.method === "DELETE") {
    // A thumbnail has no independent existence; deleting is per photo.
    if (path.variant !== "full") return new Response(null, { status: 405 });
    const removed = await deletePhoto(db, bucket, path.day, path.id);
    return removed ? json({ ok: true }) : new Response(null, { status: 404 });
  }

  return new Response(null, { status: 405 });
}
