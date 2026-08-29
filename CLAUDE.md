# Working on this repo

A private symptom journal for Millie, a border collie. Solid 2 RC on Cloudflare
Workers with D1, plus vet-facing summaries from Claude. See README.md for what
it is and why; this file is what you need to change it safely.

Live: https://millie-stats.tolu.workers.dev · one worker, one D1 named `millie`,
one R2 bucket named `millie-photos`.

## Commands

```bash
npm run dev          # vite + workerd, localhost:5173, login bypassed via .dev.vars
npm test             # vitest, logic only
npx tsc --noEmit     # TypeScript 7, ~0.3s
npm run build        # client + server bundles
npm run dev:worker   # the BUILT worker under wrangler dev
```

**Changing a server module means restarting the dev server.** Vite hot-reloads
the client, but the workerd side keeps the old bundle, so edits to `db.ts`,
`entry.ts` or anything else a server function imports keep running the previous
version. It fails silently and looks exactly like a logic bug — a new field
simply never arrives on the client. This cost real debugging time when `weight`
was added to `parseEntry`.

Never start a dev server with Bash — use the browser-preview tooling
(`.claude/launch.json` defines the `dev` config). Verify UI changes by driving
the page and reading the DOM, not by asking the user to look.

## Solid 2 RC — assume your training is wrong here

Solid 2 is a release candidate and its API differs from every Solid 1 example
you have seen. These all cost real debugging time already:

| Habit | Reality in Solid 2 |
|---|---|
| `createResource` | Gone. A `createMemo` returning a promise suspends downstream. |
| `createEffect(fn)` | Needs **two** args: `createEffect(compute, effect)`. One arg throws and halts the whole reactive system — the page renders once, then nothing responds. |
| `<Suspense>` / `<ErrorBoundary>` | `<Loading>` / `<Errored>` |
| `classList={{ a: cond }}` | Removed. Compute the class string. |
| `aria-expanded={bool}` | Must be a string: `cond ? "true" : "false"` |
| JSX types from `solid-js` | `jsxImportSource: "@solidjs/web"`; `JSX` type comes from `@solidjs/web` |
| Nested `<Show>` narrowing | Its callback does not re-run while the outer condition stays truthy. Use `<Switch>`/`<Match>` for multi-state views. |

**Signal writes are batched.** Never derive a save from reading a memo back in
the same tick — use the setter callback form. Two edits in one tick otherwise
both build on the same stale value and the second silently drops the first.
This caused real data loss; `src/lib/writeQueue.ts` exists because of it.

## Invariants — breaking these corrupts the record silently

- **An unlogged day is `null`, never `0`.** A missing row means nobody filled
  the day in; a row with all-false flags means a logged day where nothing
  happened. Charts, rolling averages and the AI prompt all depend on the
  difference. Averaging gaps as zeros flatters every trend.
- **Symptom `id`s are written into stored JSON and can never change** without a
  data migration (see `migrations/0002` for the pattern). Adding or removing a
  symptom is one line in `src/symptoms.ts` and needs no migration.
- **`with*` helpers in `entry.ts` must spread the entry**, never rebuild it from
  named fields. `withFlag` used to `return { flags, note: entry.note }`, so the
  moment `weight` joined `DayEntry`, ticking a checkbox silently erased that
  day's weight. Any new optional field would have hit the same trap.
- **Weight interpolates; symptoms never do.** An unlogged symptom day is
  genuinely unknown, so `trends.ts` breaks the line across a gap. A day nobody
  weighed her still had a weight, so `weight.ts` interpolates between
  measurements — but the chart marks the measured days with dots, and the line
  itself is dashed throughout because most of it is inferred. Beyond the first
  and last measurement it extends flat: continuing the slope would invent
  weight loss that was never observed.
- **`BASELINE_KG` is a reference line, never a data point.** Seeding the series
  at 16 before the first measurement would draw a fake ramp up to whatever she
  actually weighed. With no measurements at all the chart says so rather than
  drawing a flat 16 kg line that looks like data.
- **A weight marks its day as logged**, like a photo — unavoidably, since it
  lives in `days.data`. That is the accepted cost of one rule: "logged" means a
  row in `days`, everywhere.
- **Saves are queued, never parallel.** Each write carries the whole day, so
  last-write-wins is only safe when "last" means last-issued.
- **The client environment must build before the server bundle**
  (`buildClientFirst` in `vite.config.ts`). The server bakes the client manifest
  into the prerendered shell; wrong order ships an `index.html` pointing at a
  stale hash and production is a blank page with no error.
- **Auth is enforced once, in `src/worker.ts`**, not per server function. Keep
  it that way — one gate fails closed, scattered checks fail open. The gate
  covers the whole `/_photo` prefix, image URLs included: an `<img src>` is a
  request like any other, and a public bucket would quietly undo the login.
- **A photo marks its day as logged via `ensureDay`**, which is
  `ON CONFLICT DO NOTHING` and never `saveDay`. `saveDay`'s `DO UPDATE SET
  data = ?2` would wipe a day that already has ticks and a note. `DO NOTHING`
  also makes the ordering against a concurrent queued save irrelevant in both
  directions. "Logged" still means exactly one thing everywhere: a row in
  `days`.
- **Photos never go in `days.data`.** Every save carries the whole day, so a
  photo in that payload would race the note debounce — the same class of bug
  `writeQueue` exists to prevent. They live in their own table, keyed by day.
- **Image bytes never go through a server function.** Arguments are serialised,
  so it would mean base64 and a 33% penalty on the slowest leg. `/_photo` is a
  plain worker route; only the photo *list* is a server function.
- **Expected server-function failures are returned, not thrown.** Solid does
  not propagate error messages to the client, so a throw reaches the UI as
  "Internal Server Error". Return `{ ok: false, message }` for anything the
  user can act on; let genuine faults throw.

Photo storage functions take their bindings as parameters rather than reaching
for `import("cloudflare:workers")`. `src/worker.ts` is imported in *Node* to
prerender the shell, so nothing on that path may touch the `cloudflare:` scheme.

## Types

`@cloudflare/workers-types` is a devDependency and supplies `D1Database` and
`cloudflare:workers`. There is no generated `worker-configuration.d.ts` to
maintain, and a fresh clone typechecks after `npm install` alone.

`wrangler types` still works if you ever need the generated `Env` interface for
bindings — but the app declares its own `Env` in `src/worker.ts`, so you
probably do not.

`erasableSyntaxOnly` is on: no enums, no namespaces with runtime output, no
parameter properties. Node 24 strips types natively and nothing may depend on a
real compile step.

## Testing

Logic only — dates, serialisation, trends, the write queue, tokens, the prompt.
No component tests.

**Every bug fix gets a test, and the test must be verified to fail without the
fix.** That discipline is what found the `?d=2026-02-31` hole and disproved a
DST claim the plan asserted confidently and wrongly. A test that never fails
catches nothing.

The prompt is snapshot-tested on purpose: changing what the model is told
should show up as a reviewable diff.

## Data and deploys

- Local D1 is empty by default. `node scripts/seed-dev.mjs 2026-08-26 > /tmp/s.sql`
  then `npx wrangler d1 execute millie --local --file /tmp/s.sql` for 120 days
  of fake data with gaps and a trend.
- **Deploy before migrating** when a migration renames something the old code
  reads, and dry-run data migrations locally first. `0003_photos` is the
  opposite case — it only adds a table, and the new code needs it — so migrate
  first, then deploy. The R2 bucket must exist before either.
- Testing summaries locally needs a real `ANTHROPIC_API_KEY` line in
  `.dev.vars`. Never ask the user to paste a key into the conversation.
- The built config keeps its own local D1 under `dist/`, so `rm -rf dist`
  destroys it. `npm run dev:worker` pins `--persist-to` to avoid that.
- Seeded or scratch data is fake health data about a real dog. Clear it when
  done rather than leaving it lying around. That includes uploaded photos —
  clearing `photos` rows without deleting the R2 objects leaves them orphaned.

## Working agreement

- **Do not use git worktrees in this project.** Work in the checkout directly.
  No `--worktree`, no `EnterWorktree`, and no `isolation: "worktree"` on
  subagents. `.claude/settings.json` sets `worktree.bgIsolation: "none"` so
  background sessions are not forced into one either — the setting only covers
  that case, so the rest is on you to respect.
- **Never commit or push without explicit consent for that specific change.**
  Staging is fine. One approval does not carry to the next commit.
- Never amend, force-push, rebase or reset. Merge to integrate.
- Commit in logical chunks with messages explaining *why*, especially the
  non-obvious constraints — that is where this project's knowledge lives.
