// The summary prompt and the serialiser that feeds it.
//
// Kept in one place, and unit-tested against a fixture, so that a change to
// what the model is told shows up as a reviewable diff rather than as a
// quietly different summary next month.

import { SYMPTOMS } from "../symptoms";
import { formatWeekday, rangeDays } from "../lib/date";
import type { DayEntry } from "../lib/entry";
import { isFlagged } from "../lib/entry";
import { coverage } from "../lib/trends";

export const MILLIE_BACKGROUND = [
  "Millie er en border collie, født 28. januar 2018, kastrert.",
  "I april 2025 fikk eierne vite at hun har en ryggplage der ryggvirvlene vokser",
  "sammen med brusk, og hun haltet. De tok et år med redusert aktivitet og økte",
  "intensiteten i treningen gradvis. Ingen halting er sett siden, men hun ligger",
  "nå på et lavere treningsnivå enn før.",
].join(" ");

function symptomGlossary(): string {
  return SYMPTOMS.map((s) => `- **${s.label}** — ${s.help}.`).join("\n");
}

export const SYSTEM_PROMPT = `Du hjelper en hundeeier i Norge med å følge med på symptomer hos Millie og forberede notater til veterinæren. Svar alltid på norsk.

**Om Millie:** ${MILLIE_BACKGROUND}

Fire ting krysses av som ja/nei hver dag, i tillegg til et valgfritt fritekstnotat:

${symptomGlossary()}

Napping er det eierne følger tettest med på; de er bekymret for nervesmerter ved haleroten.

**En dag som mangler betyr at den ikke ble ført — ikke at ingenting skjedde.** Tolk aldri hull som symptomfrie dager, og si tydelig fra når dekningen er for tynn til at en konklusjon holder.

Datoer er kalenderdager i Europa/Oslo. Ukedag betyr noe — turrutinene er annerledes i helgene.

Du stiller ikke diagnose. Rapporter mønstre, hyppighet og endring; ikke navngi tilstander, ikke foreslå behandling, og ikke spekuler i årsaker utover det notatene faktisk sier. Ryggplagen over er bakgrunn for å forstå notatene — ikke en forklaring du skal lene deg på. Hvis noe i notatene er verdt å nevne for veterinæren, løft det fram som en observasjon.

Lever to ting:

1. **brief** — en klinisk oppsummering eieren kan lime rett inn i en e-post til veterinæren. Hyppighet per symptom i perioden, retning på endringen målt mot den forrige like lange perioden, eventuell klynging eller samvariasjon, og alt nytt som dukker opp i notatene. Tett, faktisk, datert.
2. **recap** — et kort, varmt avsnitt på hverdagsnorsk til eieren. Hvordan perioden gikk, stort sett. Ingen fagspråk, ingen tall med mindre ett virkelig betyr noe.`;

export type EntriesByDay = ReadonlyMap<string, DayEntry>;

/**
 * One period as a compact table. Unlogged days are written out explicitly as
 * "ikke ført" rather than omitted — a missing row in a list of dates reads as
 * an absence of symptoms, which is the single most important thing for the
 * model not to conclude.
 */
function periodTable(from: string, to: string, entries: EntriesByDay): string {
  const days = rangeDays(from, to);
  const header = ["dato", "ukedag", ...SYMPTOMS.map((s) => s.label), "notat"].join(" | ");
  const rows = days.map((day) => {
    const entry = entries.get(day);
    if (!entry) {
      return [day, formatWeekday(day), ...SYMPTOMS.map(() => "?"), "IKKE FØRT"].join(" | ");
    }
    const flags = SYMPTOMS.map((s) => (isFlagged(entry, s.id) ? "JA" : "nei"));
    return [day, formatWeekday(day), ...flags, entry.note.trim() || "-"].join(" | ");
  });
  const cover = coverage(days, entries);
  return [
    `${from} til ${to} (${days.length} dager, ${cover.logged} ført, ${
      days.length - cover.logged
    } ikke ført)`,
    header,
    ...rows,
  ].join("\n");
}

export type SummaryRequest = {
  readonly from: string;
  readonly to: string;
  /** The equal-length period immediately before, for comparison. */
  readonly previousFrom: string;
  readonly previousTo: string;
  readonly entries: EntriesByDay;
};

export function buildUserMessage(request: SummaryRequest): string {
  return [
    "## Perioden det skal oppsummeres",
    "",
    periodTable(request.from, request.to, request.entries),
    "",
    "## Forrige like lange periode, kun til sammenligning",
    "",
    periodTable(request.previousFrom, request.previousTo, request.entries),
    "",
    "Oppsummer den første perioden. Bruk den andre bare til å beskrive endring.",
  ].join("\n");
}
