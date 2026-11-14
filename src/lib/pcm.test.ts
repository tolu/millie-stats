import { describe, expect, it } from "vitest";
import { toPcm16 } from "./pcm";

describe("toPcm16", () => {
  it("writes signed 16-bit little-endian", () => {
    const bytes = toPcm16(Float32Array.of(0, 1, -1, 0.5));
    const view = new DataView(bytes.buffer);
    expect(bytes.length).toBe(8);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(32767);
    expect(view.getInt16(4, true)).toBe(-32768);
    expect(view.getInt16(6, true)).toBe(16384);
    // Little-endian, explicitly: low byte first.
    expect(bytes[2]).toBe(0xff);
    expect(bytes[3]).toBe(0x7f);
  });

  it("clamps overdriven input instead of wrapping around", () => {
    const view = new DataView(toPcm16(Float32Array.of(1.5, -2)).buffer);
    expect(view.getInt16(0, true)).toBe(32767);
    expect(view.getInt16(2, true)).toBe(-32768);
  });
});
