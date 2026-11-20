import { APIError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { failureMessage } from "./failure";

describe("failureMessage", () => {
  it("shows the API's own words, not the response body as JSON", () => {
    const cause = APIError.generate(
      401,
      { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
      undefined,
      new Headers(),
    );
    expect(failureMessage(cause)).toBe("invalid x-api-key");
  });

  it("falls back to the message when the body has none", () => {
    const cause = APIError.generate(502, undefined, "Bad Gateway", new Headers());
    expect(failureMessage(cause)).toBe("502 Bad Gateway");
  });

  it("passes other errors through", () => {
    expect(failureMessage(new Error("Failed to parse structured output"))).toBe(
      "Failed to parse structured output",
    );
    expect(failureMessage("boom")).toBe("boom");
  });
});
