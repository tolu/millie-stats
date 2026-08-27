# Millie – Pinnedyr og Border Collie

A private symptom journal for Millie, a border collie born 28 January 2018.
Four checkboxes and a note per day, 30/90-day trend charts, and vet-ready
summaries written by Claude.

Live at **https://millie-stats.tolu.workers.dev**

## Why it exists

Millie is watched for four recurring symptoms, one of them possibly nerve pain
near the tail base — relevant because in April 2025 she was diagnosed with
**spondylose**, where the vertebrae fuse with cartilage, and she limped.
Nothing was written down, so there was no way to tell a vet whether things were
getting better or worse.

The four, in the owners' own words:

| | |
|---|---|
| **Gnikking** | Rullet og gned seg på ryggen om kvelden |
| **Nagging** | Nappet og pirket i pelsen ved haleroten — the one watched most closely |
| **Lydsensitiv** | Bjeffet på helt vanlige kveldslyder |
| **Slow walk** | Brøt sammen på tur: hodet lavt, ørene stive |

## Stack

- **Solid 2.0 RC**, *client start mode* — `solid({ start: true })`. SolidStart is
  retired; start mode replaces it. `@solidjs/start` on npm is the **old**
  metaframework on Solid 1.x and is not this.
- **Cloudflare Workers** + Static Assets. Pages is in maintenance mode.
- **D1**, JSON payload columns — adding a checkbox never needs a migration.
- **claude-sonnet-5** for summaries, adaptive thinking, medium effort, structured
  output via zod. Input is ~900–3,500 tokens; output dominates the cost, so a
  summary runs about 2–3 cents.
- TypeScript 7, `erasableSyntaxOnly` — Node-24-strippable, no enums.

Chrome and Safari only, deliberately: `field-sizing`, `:has()`, `color-mix()`,
CSS nesting, view transitions, native `popover` and CSS anchor positioning are
used directly.

The four checkboxes sit two-up with the name only; each carries an ⓘ that opens
its description in a popover anchored to the button. Below 352px the widest
label reaches the button, so it falls back to a single column.

## Layout

```
src/symptoms.ts        the four symptoms — the only place one is defined
src/lib/date.ts        Oslo calendar days
src/lib/entry.ts       the JSON boundary for a day
src/lib/trends.ts      windowing and rolling averages
src/lib/writeQueue.ts  serialised saves
src/lib/token.ts       signed session cookie
src/server/db.ts       D1 access
src/server/prompt.ts   the summary prompt (snapshot-tested)
src/server/summarise.ts the Claude call
src/worker.ts          auth gate, server-function dispatch, document shell
```

Agent-facing notes — the Solid 2 RC API deltas, the invariants and the
gotchas — live in [CLAUDE.md](CLAUDE.md).

## Running it

```bash
npm install && npm run dev
```

A fresh clone typechecks after `npm install` alone: `@cloudflare/workers-types`
is a devDependency, so there is no generated `worker-configuration.d.ts` to
create first.

Local dev skips the login through `.dev.vars` (`DEV_BYPASS_AUTH = "1"`). That
variable exists **only** there, never in `wrangler.jsonc` — a deployment with no
secrets fails closed rather than open.

Against the built worker:

```bash
npm run build && npm run dev:worker
```

Fake data to look at the charts — 120 deterministic days with gaps and a rising
napping trend:

```bash
node scripts/seed-dev.mjs 2026-08-26 > /tmp/seed.sql && npx wrangler d1 execute millie --local --file /tmp/seed.sql
```

## Secrets

| Secret | Purpose |
|---|---|
| `APP_PASSPHRASE` | Shared password. Until set, the app is locked and `/_login` returns 503. |
| `COOKIE_SECRET` | Signs the session cookie. Any long random string. |
| `ANTHROPIC_API_KEY` | Summaries only. From console.anthropic.com — a Claude subscription is not a key. |

## Deploy

```bash
npm run build && npx wrangler deploy --config dist/server/wrangler.json
```

### Migrations

D1 tracks applied migrations itself, in a `d1_migrations` table. Use the
tracker rather than running files by hand — it applies only what is new, in
filename order:

```bash
npx wrangler d1 migrations list millie --remote
npx wrangler d1 migrations apply millie --remote
```

Files must be named `NNNN_name.sql` and live in `migrations/`. Locally, swap
`--remote` for `--local`.

**Write every migration so re-running it is harmless.** The tracker is per
database, so local and remote are tracked separately, and a file applied by
hand is invisible to it — `0001` uses `IF NOT EXISTS` and `0002` filters on the
old key precisely so a second run is a no-op.

**Deploy before migrating** when a migration renames something the old code
reads. Between the two there is a window where one side cannot see the data; if
the deploy fails you would otherwise be left with old code and new data.

**Dry-run data migrations locally first.** The first draft of `0002` wrote `1`
instead of `true`, which `parseEntry` ignores — it would have dropped the tick
just as surely as not migrating at all.

### When you actually need one

Rarely, by design. Adding or removing a symptom needs **no** migration — that
is the whole point of the JSON payload column. You need one only when:

- the table shape itself changes (a new table, column or index), or
- the **shape of the JSON** changes for rows that already exist — a renamed
  key, a restructured field, a new required property with a backfill.

`0002` is the second kind, and it is the kind that is easy to forget.

## Rules that hold the thing together

- **An unlogged day is `null`, never `0`.** A missing row means nobody filled the
  day in — different from a day logged with nothing wrong. Charts, rolling
  averages and the AI prompt all depend on telling those apart. Averaging gaps as
  zeros would flatter every trend, which is the wrong direction for a symptom
  tracker. The prompt writes gaps out as `IKKE FØRT` rather than omitting them.
- **Adding a symptom is one line** in `src/symptoms.ts`. The `id` goes into
  stored JSON and can never change once data exists.
- **Auth is enforced at the worker**, not per server function. One gate fails
  closed by construction; a check repeated everywhere fails open the first time
  someone forgets one.
- **Expected server-function failures are returned, not thrown.** Solid does not
  propagate error messages to the client, so a throw arrives as "Internal Server
  Error" — right for internals, useless for "no API key".

## Known limitations

**There is no logout, and no way to invalidate a single session.** The signed
cookie is valid for a year, and nothing server-side tracks it — that is what
makes the design stateless, and it is a deliberate trade for a two-person app.

The consequence is worth knowing before you need it: **if a phone is lost or
lent out, the only remedy is rotating `COOKIE_SECRET`**, which signs out every
device including yours.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put COOKIE_SECRET
```

That is the intended "sign everything out" lever, not a workaround. Changing
`APP_PASSPHRASE` alone does **not** sign anyone out — existing cookies stay
valid until they expire, because the passphrase is only checked at login.

Adding a logout button is about ten lines; see
[issue #1](https://github.com/tolu/millie-stats/issues/1) along with the other
hardening worth considering.

## Mistakes made building this, and what they cost

Kept because each one is cheap to repeat.

- **Saves overwrote each other.** Ticking a box then typing a note wiped the
  flags — `{"flags":{}}` reached D1. Two causes: Solid 2 batches signal writes, so
  reading a memo straight back gives a stale base; and every write carries the
  whole day, so parallel writes made last-*to-return* win instead of
  last-*issued*. Fix: functional updates plus `writeQueue`. Never derive a save
  from reading a memo back in the same tick.
- **`detach()` nearly lost data too.** The first version cancelled queued writes
  on day change, which would have dropped a note typed just before navigating
  away. Silencing a status and cancelling a write are not the same thing.
- **Production served a blank page.** The prerendered `index.html` pointed at the
  previous build's asset hash: the Cloudflare plugin builds its server
  environment first, so the shell baked a stale manifest. The missing script fell
  through to the SPA fallback and the browser rejected `text/html` as a module.
  Nothing was wrong in dev. Fix: the `buildClientFirst` hook in `vite.config.ts`.
  Solid orders client-first itself only when `ssr: true`.
- **Login would always have failed.** The passphrase was tracked in a signal;
  password managers fill inputs without firing `input` events. Read the form at
  submit time.
- **Nested `<Show>` kept the login on screen** after a successful sign-in — the
  outer condition stayed truthy and its callback never re-evaluated. Explicit
  `<Switch>` instead.
- **`?d=2026-02-31` would have become a row key.** `Date.UTC` silently rolls
  invalid dates forward. `toEpochDay` now round-trip-validates.
- **`@property` with `inherits: false`** meant the checkbox `::after` never saw
  the checked state, so the tick was invisible. The custom property bought
  nothing but the bug; `scale` animates on its own.
- **One failed read white-screened the whole app.** There was no error boundary.
- **A day lost to a self-inflicted wound:** `rm -rf dist` destroyed the built
  config's local D1, and the reseed failed silently into `/dev/null`. Hence
  `dev:worker` pinning `--persist-to`.

### A claim that turned out to be wrong

The plan asserted DST would misfile entries in the date arithmetic. Mutation
testing disproved it — a naive local-time `addDays` passed under UTC, Oslo,
Santiago, Lord Howe, Chatham and Havana. The DST hazard is real but lives only in
`osloDay`, which converts an instant to a calendar day. Arithmetic on day strings
never touches a timezone. The exercise found the `?d=` validation gap instead.

## Testing

`npm test` — 69 tests over dates, serialisation, trend maths, the write queue,
session tokens and the prompt. Logic only; no component tests.

Every test here was verified to fail without its implementation. Seven deliberate
mutations, all caught. That is how the `?d=` bug surfaced and how the DST claim
was disproved — a test that never fails catches nothing.
