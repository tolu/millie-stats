import { describe, expect, it } from "vitest";
import { errorMessage, isStaleBuild, STALE_BUILD_MESSAGE } from "./staleBuild";

// The shape the server-function client rejects with on a 409 from another
// build, or a 404 for an id this build does not have.
function staleError(): Error {
  return Object.assign(
    new Error(
      "Server function is not part of the deployment that answered (version skew or removed function)",
    ),
    { status: 409, unknownFunction: true },
  );
}

describe("isStaleBuild", () => {
  it("recognises a call refused by a worker from another build", () => {
    expect(isStaleBuild(staleError())).toBe(true);
  });

  it("does not take an ordinary failure for one", () => {
    expect(isStaleBuild(Object.assign(new Error("Server function call failed with status 500"), { status: 500 }))).toBe(false);
    expect(isStaleBuild(new Error("Failed to fetch"))).toBe(false);
    expect(isStaleBuild({ unknownFunction: true })).toBe(false);
    expect(isStaleBuild(undefined)).toBe(false);
  });
});

describe("errorMessage", () => {
  it("tells the person to reload instead of quoting the plugin", () => {
    expect(errorMessage(staleError())).toBe(STALE_BUILD_MESSAGE);
  });

  it("passes every other failure through", () => {
    expect(errorMessage(new Error("D1_ERROR: busy"))).toBe("D1_ERROR: busy");
    expect(errorMessage("boom")).toBe("boom");
  });
});
