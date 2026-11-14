import { describe, expect, it } from "vitest";
import {
  buildTokenRequest,
  buildVocabulary,
  MAX_VOCABULARY,
  mintToken,
  TRANSCRIBE_MODEL,
} from "./voice";

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);

describe("buildVocabulary", () => {
  it("starts with the dog's name and keeps the given terms", () => {
    expect(buildVocabulary(["Gnikking", "Kontakt"])).toEqual(["Millie", "Gnikking", "Kontakt"]);
  });

  it("drops blanks and case-insensitive duplicates, keeping the first spelling", () => {
    expect(buildVocabulary(["  Gnikking ", "gnikking", "", "  ", "millie"])).toEqual([
      "Millie",
      "Gnikking",
    ]);
  });

  it("caps the list where the model stops getting better from it", () => {
    const many = Array.from({ length: 300 }, (_, i) => `term${i}`);
    const vocabulary = buildVocabulary(many);
    expect(vocabulary).toHaveLength(MAX_VOCABULARY);
    expect(vocabulary[0]).toBe("Millie");
  });
});

describe("buildTokenRequest", () => {
  const request = buildTokenRequest(NOW, ["Millie"]);

  it("is single-use and short-lived", () => {
    expect(request.uses).toBe(1);
    expect(request.newSessionExpireTime).toBe("2026-11-14T12:01:00.000Z");
    // A live session lasts at most 10 minutes; the token need not outlive it.
    expect(request.expireTime).toBe("2026-11-14T12:11:00.000Z");
  });

  it("locks the token to the transcription model in SMART mode", () => {
    // The lock is the point: a leaked token must not be usable for anything
    // else, so model and config live here, not in the browser.
    expect(request.bidiGenerateContentSetup).toEqual({
      model: `models/${TRANSCRIBE_MODEL}`,
      generationConfig: { responseModalities: ["TEXT"] },
      inputAudioTranscription: { mode: "SMART", customVocabulary: ["Millie"] },
    });
  });

  it("leaves the language to detection, so Swedish and Norwegian both work", () => {
    expect(request.bidiGenerateContentSetup.inputAudioTranscription).not.toHaveProperty(
      "languageCodes",
    );
  });
});

describe("mintToken", () => {
  const request = buildTokenRequest(NOW, ["Millie"]);

  function respond(status: number, body: unknown): typeof fetch {
    return async () => new Response(JSON.stringify(body), { status });
  }

  it("sends the key as a header, never in the URL", async () => {
    let seen: Request | undefined;
    const fetchFn: typeof fetch = async (input, init) => {
      seen = new Request(input, init);
      return new Response(JSON.stringify({ name: "auth_tokens/abc" }));
    };
    await mintToken("secret-key", request, fetchFn);
    expect(seen?.method).toBe("POST");
    expect(seen?.url).not.toContain("secret-key");
    expect(seen?.headers.get("x-goog-api-key")).toBe("secret-key");
  });

  it("returns the token name", async () => {
    expect(await mintToken("k", request, respond(200, { name: "auth_tokens/abc" }))).toEqual({
      ok: true,
      token: "auth_tokens/abc",
    });
  });

  it("passes Google's error message through", async () => {
    const reply = await mintToken(
      "k",
      request,
      respond(400, { error: { message: "API key not valid" } }),
    );
    expect(reply).toEqual({ ok: false, message: "Gemini: API key not valid" });
  });

  it("reports a reply without a token instead of returning undefined", async () => {
    expect(await mintToken("k", request, respond(200, {}))).toEqual({
      ok: false,
      message: "Gemini: fikk ingen token",
    });
  });

  it("reports a network failure", async () => {
    const fetchFn: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await mintToken("k", request, fetchFn)).toEqual({
      ok: false,
      message: "Gemini: fetch failed",
    });
  });
});
