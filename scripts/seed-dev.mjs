// Synthetic journal for visual checks. NOT real data about Millie.
//
// Usage:
//   node scripts/seed-dev.mjs 2026-08-26 > /tmp/seed.sql
//   npx wrangler d1 execute millie --local --file /tmp/seed.sql
// Deterministic (seeded PRNG) so repeated
// runs give the same picture. Deliberately includes:
//  - unlogged gaps, to prove they render differently from logged-clear days
//  - a rising "nagging" trend over the last three weeks, which the charts and
//    later the AI summary must both surface
//  - one workout, three times a week from eight weeks back, ticked on about
//    half the days so the weekly bars show both hit and missed weeks
let seed = 20260826;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const END = process.argv[2] ?? "2026-08-26";
const DAYS = 120;
const toEpoch = (d) => Date.UTC(+d.slice(0,4), +d.slice(5,7)-1, +d.slice(8,10)) / 86400000;
const fromEpoch = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

const WORKOUT_ID = "8a1f6a0e-5b9c-4d3e-9f2a-7c6b5d4e3f21";
const WORKOUT_START = fromEpoch(toEpoch(END) - 56);

const rows = [
  `INSERT OR REPLACE INTO workouts (id, name, description, per_week, start_day, end_day, created_at, updated_at)
   VALUES ('${WORKOUT_ID}', 'Ryggøvelser', 'Sitt–stå ×10\nVektskifte bak, 3 × 20 s\nBalansepute, 2 × 30 s', 3, '${WORKOUT_START}', NULL, '${WORKOUT_START}T08:00:00.000Z', '${WORKOUT_START}T08:00:00.000Z');`,
];
for (let i = DAYS - 1; i >= 0; i--) {
  const day = fromEpoch(toEpoch(END) - i);
  const daysFromEnd = i;
  if (rnd() < 0.12) continue; // ~12% of days never got filled in

  const naggingBase = 0.15;
  const recentBoost = daysFromEnd < 21 ? 0.45 : 0;
  const flags = {};
  if (rnd() < naggingBase + recentBoost) flags["nagging"] = true;
  if (rnd() < 0.22) flags["gnikking"] = true;
  if (rnd() < 0.18) flags["lydsensitiv"] = true;
  if (rnd() < 0.08) flags["slow-walk"] = true;

  const notes = [
    "", "", "", "rolig dag", "lang tur i skogen", "mye vind, litt urolig",
    "sov godt", "nappet en del etter kveldsturen", "stiv da hun reiste seg",
  ];
  const note = notes[Math.floor(rnd() * notes.length)];
  const data = { flags, note };
  if (day >= WORKOUT_START && rnd() < 0.5) data.workouts = { [WORKOUT_ID]: true };
  rows.push(
    `INSERT OR REPLACE INTO days (day, data, updated_at) VALUES ('${day}', '${
      JSON.stringify(data).replace(/'/g, "''")
    }', '${day}T20:00:00.000Z');`,
  );
}
console.log(rows.join("\n"));
