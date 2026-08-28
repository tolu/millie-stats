import { describe, expect, it } from "vitest";
import { fitWithin, isAcceptableImage, MAX_SOURCE_BYTES } from "./image";

describe("fitWithin", () => {
  it("scales the long edge down to the maximum", () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(2000, 2000, 400)).toEqual({ width: 400, height: 400 });
  });

  it("never upscales", () => {
    // Enlarging costs bytes and adds no detail.
    expect(fitWithin(320, 240, 1600)).toEqual({ width: 320, height: 240 });
    expect(fitWithin(1, 1, 1600)).toEqual({ width: 1, height: 1 });
  });

  it("leaves an exact fit alone", () => {
    expect(fitWithin(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
  });

  it("never returns a zero edge", () => {
    // A panorama's short edge rounds to 0 without the floor, and a canvas of
    // height 0 throws on drawImage — an upload that fails on one odd photo.
    expect(fitWithin(4000, 2, 1600)).toEqual({ width: 1600, height: 1 });
    expect(fitWithin(2, 4000, 400)).toEqual({ width: 1, height: 400 });
  });

  it("refuses sizes that cannot come from an image", () => {
    expect(() => fitWithin(0, 100, 1600)).toThrow();
    expect(() => fitWithin(100, -1, 1600)).toThrow();
    expect(() => fitWithin(100, 100, 0)).toThrow();
  });
});

describe("isAcceptableImage", () => {
  it("takes an image", () => {
    expect(isAcceptableImage({ type: "image/jpeg", size: 3_000_000 })).toBe(true);
    expect(isAcceptableImage({ type: "image/heic", size: 4_000_000 })).toBe(true);
  });

  it("refuses a video picked by mistake, before decoding it", () => {
    expect(isAcceptableImage({ type: "video/quicktime", size: 80_000_000 })).toBe(false);
    expect(isAcceptableImage({ type: "application/pdf", size: 1000 })).toBe(false);
    expect(isAcceptableImage({ type: "", size: 1000 })).toBe(false);
  });

  it("refuses an empty or oversized file", () => {
    expect(isAcceptableImage({ type: "image/jpeg", size: 0 })).toBe(false);
    expect(isAcceptableImage({ type: "image/jpeg", size: MAX_SOURCE_BYTES + 1 })).toBe(false);
    expect(isAcceptableImage({ type: "image/jpeg", size: MAX_SOURCE_BYTES })).toBe(true);
  });
});
