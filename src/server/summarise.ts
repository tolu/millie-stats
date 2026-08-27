"use server";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { addDays, diffDays, isDay } from "../lib/date";
import type { DayEntry } from "../lib/entry";
import { parseEntry } from "../lib/entry";
import { coverage } from "../lib/trends";
import { buildUserMessage, SYSTEM_PROMPT } from "./prompt";
import { saveSummary } from "./db";
import type { SummaryRecord } from "./db";

// Sonnet 5 over Opus 5: this is "read a table, notice a trend, write two
// paragraphs", which is squarely its strength. 2.5x cheaper and noticeably
// faster on a button you press and wait for. Haiku was rejected — it supports
// neither adaptive thinking nor effort, and the one thing this prompt must not
// get wrong is reading IKKE FØRT gaps as good days.
const MODEL = "claude-sonnet-5";

/** A period longer than this is not a summary, it is a data dump. */
const MAX_PERIOD_DAYS = 366;

const SummarySchema = z.object({
  brief: z
    .string()
    .describe("Klinisk oppsummering til veterinæren, på norsk. Tett, faktisk, datert."),
  recap: z
    .string()
    .describe("Kort, varmt avsnitt på hverdagsnorsk til eieren. Ingen fagspråk."),
});

async function bindings() {
  const { env } = await import("cloudflare:workers");
  return env as unknown as { DB: D1Database; ANTHROPIC_API_KEY?: string };
}

/**
 * Reads a period plus the equal-length one before it in a single query, so the
 * model can describe change rather than just state.
 */
async function loadEntries(
  from: string,
  to: string,
): Promise<Map<string, DayEntry>> {
  const { DB } = await bindings();
  const { results } = await DB.prepare(
    `SELECT day, data FROM days WHERE day >= ?1 AND day <= ?2 ORDER BY day ASC`,
  )
    .bind(from, to)
    .all<{ day: string; data: string }>();
  return new Map(results.map((row) => [row.day, parseEntry(row.data)]));
}

/**
 * Expected failures are returned, not thrown.
 *
 * Solid does not propagate server error messages to the client — every throw
 * arrives as "Internal Server Error", which is the right default for leaking
 * internals but useless for the cases the person can actually act on
 * ("no API key", "nothing logged in this period"). Genuine faults still throw
 * and stay generic.
 */
export type SummaryResult =
  | { readonly ok: true; readonly summary: SummaryRecord }
  | { readonly ok: false; readonly message: string };

export async function summarise(from: string, to: string): Promise<SummaryResult> {
  if (!isDay(from) || !isDay(to)) return { ok: false, message: "Ugyldig datoperiode" };
  const length = diffDays(from, to) + 1;
  if (length < 1) return { ok: false, message: "Perioden er tom" };
  if (length > MAX_PERIOD_DAYS) return { ok: false, message: "Perioden er for lang" };

  const { ANTHROPIC_API_KEY } = await bindings();
  if (!ANTHROPIC_API_KEY) {
    return {
      ok: false,
      message: "Mangler API-nøkkel. Kjør: wrangler secret put ANTHROPIC_API_KEY",
    };
  }

  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, -(length - 1));
  const entries = await loadEntries(previousFrom, to);

  const cover = coverage(
    Array.from({ length }, (_, i) => addDays(from, i)),
    entries,
  );
  if (cover.logged === 0) {
    return { ok: false, message: "Ingen dager er ført i denne perioden" };
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  let response;
  try {
    response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16_000,
    system: SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: zodOutputFormat(SummarySchema),
    },
    messages: [
      {
        role: "user",
        content: buildUserMessage({ from, to, previousFrom, previousTo, entries }),
      },
      ],
    });
  } catch (cause) {
    // A bad key, a rate limit or an outage are all things the person can act
    // on, so the message is worth passing through.
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }

  const parsed = response.parsed_output;
  if (!parsed) return { ok: false, message: "Fikk ikke et gyldig svar fra modellen" };

  // Persisted immediately: a summary that only lives in the page is lost on
  // refresh, and it cost real money to produce.
  const summary = await saveSummary(from, to, {
    brief: parsed.brief,
    recap: parsed.recap,
    model: MODEL,
    loggedDays: cover.logged,
    totalDays: cover.total,
  });
  return { ok: true, summary };
}
