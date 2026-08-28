// Turning whatever the camera produced into something worth uploading.
//
// This is not an optimisation. A photo off a phone is 2-5 MB, and on mobile
// data that is a ten-second upload each — for an image that will be looked at
// on a 400-point-wide screen. Resizing before the upload is the difference
// between the feature being usable outdoors and not.
//
// Two useful side effects of re-encoding through a canvas: EXIF is dropped,
// which takes the home GPS coordinates with it, and iOS hands `image/*` file
// inputs a JPEG rather than the HEIC it stores, so there is nothing exotic to
// decode here.
//
// Only fitWithin and isAcceptableImage are tested; everything below them is a
// thin shell over canvas APIs that vitest has no DOM for. Step 5 verifies the
// shell in a real browser, which is also the only place the format question
// below can honestly be answered.

/** The long edge of the copy shown in the viewer. */
const FULL_EDGE = 1600;
/** The long edge of the grid thumbnail, at 2x for retina. */
const THUMB_EDGE = 400;

const FULL_QUALITY = 0.82;
const THUMB_QUALITY = 0.7;
/** One retry for a photo that somehow still exceeds the route's ceiling. */
const SALVAGE_QUALITY = 0.55;

/**
 * A ceiling on the *source* file, so a video picked by mistake fails here in
 * a millisecond rather than after decoding. Generous: a 48MP HEIC off a recent
 * iPhone arrives as a JPEG of roughly 10 MB.
 */
export const MAX_SOURCE_BYTES = 40_000_000;

export type Dimensions = { readonly width: number; readonly height: number };

/**
 * Scales to fit `max` on the long edge. Never upscales — enlarging a small
 * photo costs bytes and adds nothing.
 */
export function fitWithin(width: number, height: number, max: number): Dimensions {
  if (width <= 0 || height <= 0) throw new Error(`Not an image size: ${width}x${height}`);
  if (max <= 0) throw new Error(`Not a maximum edge: ${max}`);

  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };

  const scale = max / longest;
  // The floor at 1 is load-bearing: a 4000x2 panorama would otherwise round to
  // a height of 0, and a zero-height canvas throws on drawImage.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Structural, not `File`, so it is callable from a test without a DOM. */
export type SourceFile = { readonly type: string; readonly size: number };

export function isAcceptableImage(file: SourceFile): boolean {
  return file.type.startsWith("image/") && file.size > 0 && file.size <= MAX_SOURCE_BYTES;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

let detected: Promise<string> | undefined;

/**
 * WebP *encoding* is the one browser capability here worth not assuming — a
 * browser that displays WebP happily may still hand back a PNG from toBlob,
 * which would be several times larger than the JPEG we would have chosen.
 * Asking once and reading the type back off the result settles it.
 *
 * Nothing downstream cares which one wins: the R2 key carries no extension and
 * the content type travels with the object.
 */
export function encodeFormat(): Promise<string> {
  detected ??= (async () => {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const blob = await toBlob(probe, "image/webp", 0.8);
    return blob?.type === "image/webp" ? "image/webp" : "image/jpeg";
  })();
  return detected;
}

type Rendered = Dimensions & { readonly blob: Blob };

async function render(
  bitmap: ImageBitmap,
  maxEdge: number,
  type: string,
  quality: number,
): Promise<Rendered> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Nettleseren kunne ikke behandle bildet");
  // Without this a 4000px photo drawn straight into 400px aliases badly.
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);

  const blob = await toBlob(canvas, type, quality);
  if (!blob) throw new Error("Kunne ikke komprimere bildet");
  return { blob, width, height };
}

export type PreparedPhoto = Dimensions & {
  readonly full: Blob;
  readonly thumb: Blob;
};

/**
 * Both sizes from one decode. Generating the thumbnail here rather than
 * transforming server-side is what keeps this feature free and dependency-free
 * — it is one extra draw call.
 */
export async function prepare(file: File, ceiling: number): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, {
    // Without this, every portrait photo arrives on its side: the orientation
    // lives in EXIF, and the canvas does not read EXIF.
    imageOrientation: "from-image",
  });
  try {
    const type = await encodeFormat();
    let full = await render(bitmap, FULL_EDGE, type, FULL_QUALITY);
    // Vanishingly unlikely at 1600px, but a hard upload failure the user has
    // no way to act on is worse than one more encode.
    if (full.blob.size > ceiling) {
      full = await render(bitmap, FULL_EDGE, type, SALVAGE_QUALITY);
    }
    const thumb = await render(bitmap, THUMB_EDGE, type, THUMB_QUALITY);
    return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
  } finally {
    // Frees the decoded bitmap now rather than at the next GC. Five 12MP
    // photos held at once is real memory on a phone.
    bitmap.close();
  }
}
