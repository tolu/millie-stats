# Millie – Pinnedyr og Border Collie

A private symptom journal for Millie: four checkboxes and a note per day,
30/90-day trend charts, and vet-ready summaries written by Claude.

Live at **https://millie-stats.tolu.workers.dev**

## Stack

- **Solid 2.0 RC** in *client start mode* — `solid({ start: true })`.
  SolidStart is retired; start mode replaces it. Note that `@solidjs/start` on
  npm is the **old** metaframework built on Solid 1.x, and is not this.
- **Cloudflare Workers** + Static Assets. Pages is in maintenance mode.
- **D1** with JSON payload columns, so adding a checkbox never needs a migration.
- TypeScript 7, `erasableSyntaxOnly` — everything is Node-24-strippable, no enums.

Chrome and Safari only, deliberately: `field-sizing`, `:has()`, `popover`,
`color-mix()`, CSS nesting and view transitions are used directly.

## Setup

```bash
npm install
npm run dev
```

Local dev skips the login via `.dev.vars`:

```
DEV_BYPASS_AUTH = "1"
```

That variable exists **only** in `.dev.vars`, never in `wrangler.jsonc` — a
deployment with no secrets fails closed rather than open.

## Secrets

Three, all set with `wrangler secret put`:

| Secret | Purpose |
|---|---|
| `APP_PASSPHRASE` | The shared password. Until it is set, the app is locked and `/_login` returns 503. |
| `COOKIE_SECRET` | Signs the session cookie. Any long random string. |
| `ANTHROPIC_API_KEY` | Needed only for summaries. From console.anthropic.com — a Claude subscription is not a key. |

## Deploy

```bash
npm run build && npx wrangler deploy --config dist/server/wrangler.json
```

Migrations are applied by hand:

```bash
npx wrangler d1 execute millie --remote --file migrations/0001_init.sql
```

## Testing against the built worker

```bash
npm run build && npm run dev:worker
```

`dev:worker` pins `--persist-to .wrangler/state`. Without it the built config
keeps its local D1 under `dist/`, and any `rm -rf dist` silently destroys the
test database.

## Fake data for looking at the charts

```bash
node scripts/seed-dev.mjs 2026-08-26 > /tmp/seed.sql
npx wrangler d1 execute millie --local --file /tmp/seed.sql
```

120 deterministic days with unlogged gaps and a rising "napping" trend in the
last three weeks — enough to check that gaps render differently from
logged-clear days and that the summary notices the trend. Local only.

## Things worth knowing before changing this

- **An unlogged day is `null`, never `0`.** A missing row means nobody filled
  the day in, which is different from a day logged with nothing wrong. The
  charts, the rolling averages and the AI prompt all depend on telling those
  apart — averaging over gaps as zeros would flatter every trend.
- **Adding a symptom is one line** in `src/symptoms.ts`. The `id` is written
  into stored JSON and can never change once data exists.
- **Solid 2 batches signal writes.** Never derive a save from reading a memo
  back in the same tick — use the setter callback. Two edits in one tick
  otherwise both build on the same stale value and the second drops the first.
- **Saves are queued, not parallel** (`src/lib/writeQueue.ts`). Every write
  carries the whole day, so last-write-wins is only safe when "last" means
  last-issued.
- **The client build must run before the server build** (`vite.config.ts`).
  The server bundle bakes the client manifest into the prerendered shell.
- **Expected server-function failures are returned, not thrown.** Solid does
  not propagate error messages to the client, so a throw arrives as "Internal
  Server Error".
