-- Photos for a day. The bytes live in R2; this table is the index.
--
-- They are deliberately NOT part of `days.data`. Every save carries the whole
-- day, so a photo inside that payload would race the note debounce and be
-- clobbered by it — the bug src/lib/writeQueue.ts exists to prevent, in a new
-- shape. Keeping them in their own table also means uploading a photo does not
-- accidentally decide whether the day counts as logged; see ensureDay in
-- src/server/photos.ts, which makes that an explicit act.

CREATE TABLE IF NOT EXISTS photos (
  id         TEXT PRIMARY KEY,   -- uuid; half of the R2 key, see lib/photo.ts
  day        TEXT NOT NULL,      -- 'YYYY-MM-DD', Europe/Oslo calendar date
  width      INTEGER NOT NULL,   -- of the display copy, after client resize
  height     INTEGER NOT NULL,
  bytes      INTEGER NOT NULL,   -- display copy only; the thumbnail is noise
  created_at TEXT NOT NULL       -- ISO 8601 UTC
);

-- No content-type column on purpose. Which format the browser could encode is
-- not the database's business, and R2 already carries it in httpMetadata.

CREATE INDEX IF NOT EXISTS photos_day ON photos (day, created_at);
