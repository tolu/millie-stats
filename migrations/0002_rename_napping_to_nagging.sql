-- "Napping" was a mistaken label; the symptom is "Nagging".
--
-- The id is written into every stored day, so renaming it in src/symptoms.ts
-- alone would leave existing ticks unreadable — the flag would still be in the
-- JSON under the old key and simply never render again. This moves them.
--
-- Apply together with the deploy, not before it: between this running and the
-- new code going live, the old build cannot see the renamed flag.

-- json_set with the extracted value writes 1, not true, because SQLite has no
-- boolean type. parseEntry only accepts a literal true, so that would have
-- dropped the tick just as surely as not migrating at all. json('true') forces
-- a real JSON boolean. Only true flags are ever stored, so the value is known.
UPDATE days
SET data = json_set(
      json_remove(data, '$.flags.napping'),
      '$.flags.nagging',
      json('true')
    )
WHERE json_extract(data, '$.flags.napping') = 1;
