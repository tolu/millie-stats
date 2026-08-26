-- Millie's journal. Two tables, deliberately schemaless in their payloads:
-- adding a new checkbox later is a change to src/symptoms.ts only, never SQL.

CREATE TABLE IF NOT EXISTS days (
  day        TEXT PRIMARY KEY,   -- 'YYYY-MM-DD', Europe/Oslo calendar date
  data       TEXT NOT NULL,      -- JSON: { flags: { [id]: true }, note: string }
  updated_at TEXT NOT NULL       -- ISO 8601 UTC
);

CREATE TABLE IF NOT EXISTS summaries (
  id         TEXT PRIMARY KEY,
  from_day   TEXT NOT NULL,
  to_day     TEXT NOT NULL,
  data       TEXT NOT NULL,      -- JSON: { brief, recap, model, usage, entryCount }
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS summaries_created ON summaries (created_at DESC);
