import {
  action,
  createMemo,
  createOptimisticStore,
  createSignal,
  flush,
  For,
  Loading,
  refresh,
  Show,
} from "solid-js";
import { formatLong } from "./lib/date";
import { isAcceptableImage, prepare } from "./lib/image";
import { MAX_PHOTOS_PER_DAY, MAX_UPLOAD_BYTES, photoUrl } from "./lib/photo";
import { photosForDay } from "./server/db";
import type { PhotoRecord } from "./server/photos";
import type { PreparedPhoto } from "./lib/image";

type UploadReply = { ok?: boolean; message?: string; photo?: PhotoRecord };

async function send(day: string, photo: PreparedPhoto): Promise<PhotoRecord> {
  const form = new FormData();
  form.append("full", photo.full);
  form.append("thumb", photo.thumb);
  form.append("width", String(photo.width));
  form.append("height", String(photo.height));

  const response = await fetch(`/_photo?d=${day}`, { method: "POST", body: form });
  // Expected refusals come back as {ok, message}; a 405 or a proxy error does
  // not, so a failed parse must not surface as "Unexpected token <".
  let body: UploadReply | null = null;
  try {
    body = (await response.json()) as UploadReply;
  } catch {
    body = null;
  }
  if (!body?.ok || !body.photo) {
    throw new Error(body?.message ?? "Opplastingen feilet");
  }
  return body.photo;
}

export default function Photos(props: {
  day: string;
  /** The day just became logged, or a photo went away. Charts are stale. */
  onChange: () => void;
  /** A batch finished. App uses this to put the cursor in the note. */
  onUploaded: () => void;
}) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [shown, setShown] = createSignal<PhotoRecord | null>(null);
  const [confirming, setConfirming] = createSignal(false);

  // The server's list, with an optimistic layer on top. A write through
  // `setPhotos` shows at once but belongs to the action that made it, and is
  // dropped when that action ends — by then `refresh` has re-read the list, so
  // what remains is what the server holds. Nothing here keeps a second copy.
  const [photos, setPhotos] = createOptimisticStore<PhotoRecord[]>(
    () => photosForDay(props.day),
    [],
  );

  let picker!: HTMLInputElement;
  let viewer!: HTMLDialogElement;

  // Uploads run one at a time. Not for ordering — each photo is independent,
  // unlike a day save that carries the whole day — but because three parallel
  // uploads on mobile data is how you get three timeouts.
  async function add(files: readonly File[]) {
    if (busy()) return;
    setBusy(true);
    setError("");
    let uploaded = 0;
    try {
      for (const file of files) {
        if (photos.length >= MAX_PHOTOS_PER_DAY) {
          // Says what happened to the rest of the batch. The cap itself is
          // already stated below the grid, so repeating it here read as two
          // separate complaints about one thing.
          setError("Resten ble ikke lastet opp — dagen er full");
          break;
        }
        if (!isAcceptableImage(file)) {
          setError("Bare bilder kan lastes opp");
          continue;
        }
        await send(props.day, await prepare(file, MAX_UPLOAD_BYTES));
        // Not optimistic: a thumbnail has no URL until the server has stored
        // it. Awaited, so the cap check above counts this photo next time.
        await refresh(photos);
        uploaded++;
        props.onChange();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      // Once per batch, not per photo: focusing raises the keyboard, and doing
      // that three times while photos are still uploading is hostile.
      if (uploaded > 0) props.onUploaded();
    }
  }

  // The photo leaves the grid on the tap rather than after the round trip. If
  // the delete fails the layer is dropped with the action and it comes back.
  const discard = action(function* (day: string, id: string) {
    setPhotos((list) => list.filter((p) => p.id !== id));
    const response: Response = yield fetch(photoUrl(day, id, "full"), { method: "DELETE" });
    if (!response.ok) throw new Error("Kunne ikke slette bildet");
    yield refresh(photos);
  });

  // The error is written out here, not inside the action: a write made there
  // is held with the action and would only show once it had already ended.
  async function remove(photo: PhotoRecord) {
    setError("");
    // Committed before the action starts. A write made in the same tick as an
    // action is adopted by it, and an old error would stay up until it ended.
    flush();
    viewer.close();
    try {
      await discard(props.day, photo.id);
      props.onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function open(photo: PhotoRecord) {
    setShown(photo);
    setConfirming(false);
    viewer.showModal();
  }

  // Read through memos rather than a <Show> callback: that callback does not
  // re-run while the condition stays truthy, so opening a second photo would
  // otherwise keep showing the first.
  const viewing = createMemo(() => shown());
  const fullSrc = createMemo(() => {
    const photo = viewing();
    return photo ? photoUrl(props.day, photo.id, "full") : "";
  });

  const full = createMemo(() => photos.length >= MAX_PHOTOS_PER_DAY);

  return (
    <section class="photos" aria-labelledby="photos-heading">
      <h2 id="photos-heading">Bilder</h2>

      <Loading fallback={<p class="muted">laster…</p>}>
        <Show when={photos.length > 0}>
          <ul class="photo-grid">
            <For each={photos}>
              {(photo, index) => (
                <li>
                  <button type="button" class="thumb" onClick={() => open(photo)}>
                    <img
                      src={photoUrl(props.day, photo.id, "thumb")}
                      alt={`Bilde ${index() + 1} fra ${formatLong(props.day)}`}
                      width={photo.width}
                      height={photo.height}
                      loading="lazy"
                    />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Loading>

      <div class="photo-actions">
        <Show
          when={!full()}
          fallback={
            <p class="muted">{MAX_PHOTOS_PER_DAY} bilder — det er maks for én dag.</p>
          }
        >
          <button
            type="button"
            class="add-photo"
            disabled={busy()}
            onClick={() => picker.click()}
          >
            {busy() ? "Laster opp…" : "Legg til bilde"}
          </button>
        </Show>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const chosen = [...(e.currentTarget.files ?? [])];
            // Cleared so picking the same file twice still fires a change.
            e.currentTarget.value = "";
            void add(chosen);
          }}
        />
      </div>

      <Show when={error()}>
        <p class="login-error" role="alert">
          {error()}
        </p>
      </Show>

      <dialog
        class="viewer"
        ref={viewer}
        onClose={() => {
          setShown(null);
          setConfirming(false);
        }}
      >
        <Show when={viewing()}>
          <img class="viewer-image" src={fullSrc()} alt="" />
          {/* A normal row under the image rather than controls floating over
              it: on a phone the photo is the whole screen, and a button on top
              of it is both hard to hit and hiding the thing you came to see. */}
          <div class="viewer-actions">
            <button type="button" class="close" onClick={() => viewer.close()}>
              Lukk
            </button>
            <button
              type="button"
              class="delete"
              onClick={() => {
                const photo = viewing();
                if (!photo) return;
                if (!confirming()) {
                  setConfirming(true);
                  return;
                }
                void remove(photo);
              }}
            >
              {confirming() ? "Sikker? Slett" : "Slett bilde"}
            </button>
          </div>
        </Show>
      </dialog>
    </section>
  );
}
