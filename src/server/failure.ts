import { APIError } from "@anthropic-ai/sdk";

/**
 * What the person sees when the Claude call fails.
 *
 * An API error's `message` is "<status> <the whole response body as JSON>",
 * which put raw JSON on the phone. `apiMessage` (SDK 1.5) is just the body's
 * human-readable part — "invalid x-api-key", not a JSON blob around it.
 * Anything else (a network failure, a failed parse) keeps its own message.
 *
 * Its own module because summarise.ts is "use server": every export there
 * becomes a callable endpoint.
 */
export function failureMessage(cause: unknown): string {
  if (cause instanceof APIError && cause.apiMessage) return cause.apiMessage;
  return cause instanceof Error ? cause.message : String(cause);
}
