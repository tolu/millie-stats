import { describe, expect, it } from "vitest";
import {
  bytesToBase64,
  CHUNK_BYTES,
  createChunker,
  createResampler,
  toPcm16,
} from "./pcm";

function ramp(length: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => Math.sin(i / 7));
}

function concat(parts: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe("createResampler", () => {
  it("passes 16 kHz through untouched", () => {
    const input = ramp(100);
    expect(createResampler(16_000)(input)).toEqual(input);
  });

  it("averages each window, so 48 kHz becomes a third as many samples", () => {
    const push = createResampler(48_000);
    expect(Array.from(push(Float32Array.of(0, 0.3, 0.6, 1, 1, 1)))).toEqual([
      expect.closeTo(0.3, 6),
      1,
    ]);
  });

  it("produces the expected length for 44.1 kHz, which does not divide evenly", () => {
    const out = createResampler(44_100)(ramp(44_100));
    expect(out.length).toBe(16_000);
  });

  // The audio thread hands over blocks that do not line up with the output
  // windows. A resampler that restarts per block drifts and clicks at every
  // boundary, so chunked input must give exactly what one piece gives.
  it.each([48_000, 44_100])("is independent of how %i Hz input is chunked", (rate) => {
    const input = ramp(rate);
    const whole = createResampler(rate)(input);

    const push = createResampler(rate);
    const pieces: Float32Array[] = [];
    for (let at = 0, size = 1; at < input.length; at += size, size = (size * 7) % 997 + 1) {
      pieces.push(push(input.subarray(at, at + size)));
    }
    expect(concat(pieces)).toEqual(whole);
  });

  it("refuses to upsample rather than invent samples", () => {
    expect(() => createResampler(8_000)).toThrow(RangeError);
  });
});

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

describe("bytesToBase64", () => {
  it("matches Node's encoder, including for chunks larger than one apply() call", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 31) % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });
});
