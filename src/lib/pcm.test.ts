import { describe, expect, it } from "vitest";
import { CHUNK_BYTES, createChunker, toPcm16 } from "./pcm";

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
    const view = new DataView(toPcm16(Float32Array.of(1.5, -2, Number.NaN)).buffer);
    expect(view.getInt16(0, true)).toBe(32767);
    expect(view.getInt16(2, true)).toBe(-32768);
    expect(view.getInt16(4, true)).toBe(0);
  });
});

describe("createChunker", () => {
  it("emits 100 ms chunks and keeps the remainder", () => {
    const chunker = createChunker();
    expect(chunker.push(new Uint8Array(CHUNK_BYTES - 1))).toEqual([]);
    const out = chunker.push(new Uint8Array(CHUNK_BYTES + 3));
    expect(out.map((c) => c.length)).toEqual([CHUNK_BYTES, CHUNK_BYTES]);
    expect(chunker.flush()?.length).toBe(2);
    expect(chunker.flush()).toBeNull();
  });

  it("keeps the bytes in order across chunks", () => {
    const chunker = createChunker(4);
    const out = [
      ...chunker.push(Uint8Array.of(1, 2, 3)),
      ...chunker.push(Uint8Array.of(4, 5, 6, 7, 8, 9)),
    ];
    expect(out.map((c) => Array.from(c))).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
    expect(Array.from(chunker.flush() ?? [])).toEqual([9]);
  });
});
