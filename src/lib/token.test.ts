import { describe, expect, it } from "vitest";
import { createToken, readCookie, verifyToken } from "./token";

const SECRET = "a-long-random-cookie-secret";
const YEAR = 365 * 24 * 60 * 60 * 1000;

describe("tokens", () => {
  it("accepts a token it just issued", async () => {
    const token = await createToken(SECRET, YEAR);
    expect(await verifyToken(token, SECRET)).toBe(true);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createToken(SECRET, YEAR);
    expect(await verifyToken(token, "some-other-secret")).toBe(false);
  });

  it("rejects a tampered expiry", async () => {
    // The whole point: extending your own session must not be possible.
    const token = await createToken(SECRET, 1000, 0);
    const signature = token.slice(token.indexOf(".") + 1);
    const forged = `${9_999_999_999_999}.${signature}`;
    expect(await verifyToken(forged, SECRET)).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const token = await createToken(SECRET, YEAR);
    const [expiry, signature] = token.split(".");
    const flipped = (signature ?? "").replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect(await verifyToken(`${expiry}.${flipped}`, SECRET)).toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await createToken(SECRET, 1000, 0);
    expect(await verifyToken(token, SECRET, 500)).toBe(true);
    expect(await verifyToken(token, SECRET, 2000)).toBe(false);
  });

  it("rejects malformed input without throwing", async () => {
    for (const bad of ["", ".", "abc", "abc.def", "12345", "..", "x.!!!not-base64"]) {
      expect(await verifyToken(bad, SECRET)).toBe(false);
    }
  });
});

describe("readCookie", () => {
  it("finds the named cookie among others", () => {
    expect(readCookie("a=1; millie=abc.def; b=2", "millie")).toBe("abc.def");
  });

  it("does not match a cookie whose name merely ends with the target", () => {
    expect(readCookie("notmillie=nope", "millie")).toBe(null);
  });

  it("copes with a missing header", () => {
    expect(readCookie(null, "millie")).toBe(null);
    expect(readCookie("", "millie")).toBe(null);
  });
});
