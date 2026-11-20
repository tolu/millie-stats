"use server";

// Hands the browser a token for one dictation session.
//
// A server function rather than a route of its own on purpose: it sits behind
// the `/_server` gate in worker.ts, so only a signed-in person can spend the
// Gemini key, and there is no second gate to forget.

import { buildTokenRequest, buildVocabulary, mintToken, type TokenReply } from "../lib/voice";
import { SYMPTOMS } from "../symptoms";
import { listWorkouts } from "./db";

async function bindings() {
  const { env } = await import("cloudflare:workers");
  return env as unknown as { GEMINI_API_KEY?: string };
}

export async function voiceToken(): Promise<TokenReply> {
  const { GEMINI_API_KEY } = await bindings();
  if (!GEMINI_API_KEY) {
    return { ok: false, message: "Mangler API-nøkkel. Kjør: wrangler secret put GEMINI_API_KEY" };
  }
  // Retired workouts too: a note can still mention one by name.
  const workouts = await listWorkouts();
  const vocabulary = buildVocabulary([
    ...SYMPTOMS.map((s) => s.label),
    ...workouts.map((w) => w.name),
  ]);
  return mintToken(GEMINI_API_KEY, buildTokenRequest(Date.now(), vocabulary));
}
