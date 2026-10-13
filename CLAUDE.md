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

## Two pages, one route

`src/App.tsx` holds only auth; `SignedIn` owns the route and switches between
`src/Day.tsx` (the day being logged) and `src/Journal.tsx` (every day that has
a note). Both sit inside the same `<Errored>` boundary. `src/Masthead.tsx` is
shared, and takes page-specific controls through `children` so day state never
enters it.

- **The route is `?view=` plus `?d=`, and they are orthogonal.** The journal
  keeps the day so leaving it returns to the day you came from. Anything other
  than the exact string `journal` resolves to the day view — an unrecognised
  `?view=` must land on a working page, not a blank one.
- **A change of page pushes; a change of day replaces.** That is what makes
  Back leave the journal without walking through every day browsed with the
  chevrons.
- **`Day` reads `props.day`; it must never copy it into a signal.** `<Match>`
  keeps the component mounted while the day changes, so a copy taken at mount
  goes stale.
- **`Day` flushes its pending note on disposal, not just on navigation.**
  Typing and immediately leaving otherwise discards the write with no request,
  no error and no trace.
- **The page swap is not wrapped in `startViewTransition`.** It would capture
  the incoming page's empty state and crossfade into "laster…". Keep the
  transition where it is, around day-to-day changes.

## Invariants — breaking these corrupts the record silently

### The record

- **An unlogged day is `null`, never `0`.** A missing row means nobody filled
  the day in; a row with all-false flags means a logged day where nothing
  happened. Charts, rolling averages and the AI prompt all depend on the
  difference. Averaging gaps as zeros flatters every trend.
- **"Logged" means exactly one thing everywhere: a row in `days`.** A weight
  marks its day logged because it lives in `days.data` and cannot do otherwise.
  A photo marks it through `ensureDay` — `ON CONFLICT DO NOTHING`, never
  `saveDay`, whose `DO UPDATE SET data = ?2` would wipe a day that already has
  ticks and a note. `DO NOTHING` also makes the ordering against a concurrent
  queued save irrelevant in both directions.
- **Symptom `id`s are written into stored JSON and can never change** without a
  data migration (see `migrations/0002` for the pattern). Adding or removing a
  symptom is one line in `src/symptoms.ts` and needs no migration.
- **`with*` helpers in `entry.ts` must spread the entry**, never rebuild it from
  named fields. `withFlag` used to `return { flags, note: entry.note }`, so the
  moment `weight` joined `DayEntry`, ticking a checkbox silently erased that
  day's weight. Any new optional field would hit the same trap.
- **Saves are queued, never parallel.** Each write carries the whole day, so
  last-write-wins is only safe when "last" means last-issued.
- **Photos never go in `days.data`.** A photo in that payload would race the
  note debounce — the same class of bug `writeQueue` exists to prevent. They
  live in their own table, keyed by day.
- **Weight interpolates; symptoms never do.** An unlogged symptom day is
  genuinely unknown, so `trends.ts` breaks the line across a gap. A day nobody
  weighed her still had a weight, so `weight.ts` interpolates between
  measurements. Beyond the first and last it extends flat: continuing the slope
  would invent weight loss that was never observed.
- **`BASELINE_KG` is a reference line, never a data point.** With no
  measurements the chart says so rather than drawing a flat 16 kg line that
  looks like data.
- **Workout ticks live in `days.data` as a true-only map keyed by workout id;
  the definitions live in the `workouts` table.** A tick follows the `weight`
  pattern in `entry.ts` (spread, key absent when empty) and saves through the
  same queue as a checkbox. Definitions are rows because the user edits them;
  never delete one — its id is in the days that ticked it — set `end_day`
  instead.
- **A workout has two states, not three.** An unlogged day is a missed session,
  not unknown: the weekly target is a count. A week entirely outside the
  workout's start and end is `null` and drawn blank.

### Rendering and reactivity

- **A suspending memo blanks everything inside its `<Loading>`.** The whole of
  `Day`'s `<main>` sits in one, so nothing read there may be a memo keyed on
  `dataVersion`. `Workouts.tsx` and `Photos.tsx` key their fetches on the day
  and apply edits through an overlay signal; only `Trends`, which has its own
  `<Loading>`, refetches on `version`.
- **The journal's list is fetched imperatively**, for the same reason: a memo
  reading the cursor returns a new promise per page and blanks the accumulated
  list on each "load more". Its paging guards are plain variables, not signals,
  because they are read back in the tick they are written — the same rule as
  `edit`'s setter callback.
- **Infinite scroll measures the sentinel, it does not trust the observer's
  flag.** `IntersectionObserver` reports asynchronously, so straight after a
  page is appended the flag still says "visible" though the new rows have
  pushed the sentinel off screen. Trusting it loaded three pages before the
  list had been scrolled once.
- **Each symptom's hue is an SVG presentation attribute** (`--sym-*` in
  styles.css, reached through `src/symptoms.ts`), so no CSS rule may set
  `stroke` or `fill` for those marks — a rule outranks the attribute and
  silently repaints every chart one colour.
- **The journal's marks have two states, not three.** Every journal row has a
  note, so it is a logged day by construction. Listing days without notes would
  bring the third state back.

### Boundaries

- **Auth is enforced once, in `src/worker.ts`**, not per server function — one
  gate fails closed, scattered checks fail open. It covers the whole `/_photo`
  prefix, image URLs included: an `<img src>` is a request like any other, and
  a public bucket would quietly undo the login.
- **Image bytes never go through a server function.** Arguments are serialised,
  so it would mean base64 and a 33% penalty on the slowest leg. `/_photo` is a
  plain worker route; only the photo *list* is a server function.
- **Photo storage functions take their bindings as parameters** rather than
  reaching for `import("cloudflare:workers")`. `src/worker.ts` is imported in
  *Node* to prerender the shell, so nothing on that path may touch the
  `cloudflare:` scheme.
- **Expected server-function failures are returned, not thrown.** Solid does
  not propagate error messages to the client, so a throw reaches the UI as
  "Internal Server Error". Return `{ ok: false, message }` for anything the
  user can act on; let genuine faults throw.

## Types

`@cloudflare/workers-types` is a devDependency and supplies `D1Database` and
`cloudflare:workers`. There is no generated `worker-configuration.d.ts` to
maintain, and a fresh clone typechecks after `npm install` alone.

`erasableSyntaxOnly` is on: no enums, no namespaces with runtime output, no
parameter properties. Node 24 strips types natively and nothing may depend on a
real compile step.

## Testing

Logic only — dates, serialisation, trends, weekly workouts, the write queue,
tokens, the prompt.
No component tests.

**Every bug fix gets a test, and the test must be verified to fail without the
fix.** That discipline is what found the `?d=2026-02-31` hole. A test that
never fails catches nothing.

The prompt is snapshot-tested on purpose: changing what the model is told
should show up as a reviewable diff.

## Data and deploys

- Local D1 is empty by default. `node scripts/seed-dev.mjs 2026-08-26 > /tmp/s.sql`
  then `npx wrangler d1 execute millie --local --file /tmp/s.sql` for 120 days
  of fake data with gaps and a trend.
- **The client environment must build before the server bundle**
  (`buildClientFirst` in `vite.config.ts`). The server bakes the client
  manifest into the prerendered shell; wrong order ships an `index.html`
  pointing at a stale hash, and production is a blank page with no error.
- **Build after committing, never before.** The footer's build stamp is read at
  build time, so a build from a dirty tree deploys a sha that does not describe
  what is running. The `-dirty` marker is the only hint, and only if you look.
- **Deploy before migrating** when a migration renames something the old code
  reads, and dry-run data migrations locally first. A purely additive
  migration is the opposite case — the new code needs the table, so migrate
  first, then deploy. That covers `0003_photos` and `0004_workouts`, and any
  migration that only adds. The R2 bucket must exist before either.
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
  subagents. `.claude/settings.json` covers background sessions; the rest is on
  you.
- **Never commit or push without explicit consent for that specific change.**
  Staging is fine. One approval does not carry to the next commit.
- Never amend, force-push, rebase or reset. Merge to integrate.
- Commit in logical chunks with messages explaining *why*, especially the
  non-obvious constraints — that is where this project's knowledge lives.
