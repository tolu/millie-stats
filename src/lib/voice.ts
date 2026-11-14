// Dictation into the day's note, through Gemini's live transcription model.
//
// The browser talks to Gemini directly over a WebSocket; the worker only mints
// a short-lived, single-use token for it. The API key never leaves the worker,
// and the token is locked to this model and this config, so a token that leaks
// cannot be spent on anything else.
//
// SMART mode is the editor: it drops filler words and false starts, resolves
// self-corrections ("three, no four km") and punctuates. It does not rewrite
// what was said, which is the point in a record a vet reads.
//
// Measured with synthetic speech on 2026-11-14: within one recording the model
// settles on the first language it hears and renders the rest in it, so a
// Swedish sentence after a Norwegian one comes out Norwegian.
//
// Nothing here may import from `cloudflare:` — the client imports the model id.

/** A preview model. When Google retires it, this is the one line to change. */
export const TRANSCRIBE_MODEL = "gemini-3.5-transcribe-live";

/** Google: up to 1000 terms accepted, best results up to about 100. */
export const MAX_VOCABULARY = 100;

const AUTH_TOKENS_URL = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";

/** Time to open the session after the token is handed out. */
const NEW_SESSION_MS = 60_000;
/** A live session lasts at most ten minutes; the token need not outlive it. */
const TOKEN_LIFETIME_MS = 11 * 60_000;

/**
 * Words the model should spell our way: her name first, then whatever the
 * journal itself calls things.
 */
export function buildVocabulary(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const vocabulary: string[] = [];
  for (const raw of ["Millie", ...terms]) {
    const term = raw.trim();
    const key = term.toLocaleLowerCase("nb");
    if (!term || seen.has(key)) continue;
    seen.add(key);
    vocabulary.push(term);
    if (vocabulary.length === MAX_VOCABULARY) break;
  }
  return vocabulary;
}

/** REST body for `auth_tokens`. The SDK calls the setup `liveConnectConstraints`; REST does not. */
export function buildTokenRequest(now: number, vocabulary: readonly string[]) {
  return {
    uses: 1,
    newSessionExpireTime: new Date(now + NEW_SESSION_MS).toISOString(),
    expireTime: new Date(now + TOKEN_LIFETIME_MS).toISOString(),
    bidiGenerateContentSetup: {
      model: `models/${TRANSCRIBE_MODEL}`,
      generationConfig: { responseModalities: ["TEXT"] },
      inputAudioTranscription: { mode: "SMART", customVocabulary: [...vocabulary] },
    },
  };
}

export type TokenReply =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly message: string };

export async function mintToken(
  apiKey: string,
  request: ReturnType<typeof buildTokenRequest>,
  fetchFn: typeof fetch = fetch,
): Promise<TokenReply> {
  let response: Response;
  let body: { name?: unknown; error?: { message?: unknown } } | undefined;
  try {
    response = await fetchFn(AUTH_TOKENS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(request),
    });
    body = (await response.json().catch(() => undefined)) as typeof body;
  } catch (cause) {
    return { ok: false, message: `Gemini: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (!response.ok) {
    const detail = typeof body?.error?.message === "string" ? body.error.message : `HTTP ${response.status}`;
    return { ok: false, message: `Gemini: ${detail}` };
  }
  if (typeof body?.name !== "string" || !body.name) {
    return { ok: false, message: "Gemini: fikk ingen token" };
  }
  return { ok: true, token: body.name };
}
