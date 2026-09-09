-- Workouts: routines with a weekly target, defined in the app.
--
-- The definitions get a table because they are edited by the user; every
-- other definition in the app (symptoms, windows) is a constant in code. The
-- per-day ticks are NOT here: they live in `days.data` as a true-only map
-- keyed by workout id, so "logged" keeps meaning exactly one thing — a row in
-- `days` — and a tick rides the same queued whole-day save as a checkbox.
--
-- Adds a table only, so like 0003: migrate first, then deploy. Never delete a
-- row: its id is written into the days that ticked it. Retiring sets end_day.

CREATE TABLE IF NOT EXISTS workouts (
  id          TEXT PRIMARY KEY,           -- uuid; referenced from days.data, never changes
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',   -- multi-line instructions
  per_week    INTEGER NOT NULL,           -- target days per Mon–Sun week, 1..7
  start_day   TEXT NOT NULL,              -- first day it applies, 'YYYY-MM-DD'
  end_day     TEXT,                       -- last day it applies, inclusive; NULL while active
  created_at  TEXT NOT NULL,              -- ISO 8601 UTC
  updated_at  TEXT NOT NULL
);
