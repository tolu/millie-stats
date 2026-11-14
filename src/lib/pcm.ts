// From microphone samples to what the live transcription model accepts:
// 16-bit little-endian PCM, 16 kHz, mono, in roughly 100 ms chunks.
//
// The browser is asked for a 16 kHz AudioContext, but iOS in particular may
// hand back 48 or 44.1 kHz regardless, so the actual rate is resampled here
// rather than trusted.

export const TARGET_RATE = 16_000;
/** 100 ms at 16 kHz, two bytes a sample. Google recommends ~100 ms chunks. */
export const CHUNK_BYTES = (TARGET_RATE / 10) * 2;

/**
 * A stateful downsampler: each output sample is the mean of the input window
 * it covers, which also takes the edge off aliasing.
 *
 * Windows are computed from absolute sample positions, not per call, because
 * the audio thread's blocks never line up with them (48 kHz is 3:1, 44.1 kHz
 * is 2.75625:1). Restarting per block would drift and click at every seam.
 */
export function createResampler(fromRate: number, toRate = TARGET_RATE) {
  if (!(fromRate >= toRate)) {
    throw new RangeError(`Cannot resample ${fromRate} Hz up to ${toRate} Hz`);
  }
  const ratio = fromRate / toRate;
  /** Input not yet consumed, and the absolute index of its first sample. */
  let pending = new Float32Array(0);
  let offset = 0;
  let produced = 0;

  return function push(input: Float32Array): Float32Array {
    const all = new Float32Array(pending.length + input.length);
    all.set(pending);
    all.set(input, pending.length);
    const end = offset + all.length;

    const out: number[] = [];
    for (;;) {
      const from = Math.floor(produced * ratio);
      const to = Math.floor((produced + 1) * ratio);
      if (to > end) break;
      let sum = 0;
      for (let i = from; i < to; i++) sum += all[i - offset]!;
      out.push(sum / (to - from));
      produced++;
    }

    const keep = Math.floor(produced * ratio);
    pending = all.slice(keep - offset);
    offset = keep;
    return Float32Array.from(out);
  };
}

/** Float samples in [-1, 1] to signed 16-bit little-endian bytes, clamped. */
export function toPcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return bytes;
}

/** Collects bytes into fixed-size chunks; `flush` hands over the remainder. */
export function createChunker(size = CHUNK_BYTES) {
  let buffer = new Uint8Array(0);
  return {
    push(bytes: Uint8Array): Uint8Array[] {
      const all = new Uint8Array(buffer.length + bytes.length);
      all.set(buffer);
      all.set(bytes, buffer.length);
      const chunks: Uint8Array[] = [];
      let at = 0;
      for (; at + size <= all.length; at += size) chunks.push(all.slice(at, at + size));
      buffer = all.slice(at);
      return chunks;
    },
    flush(): Uint8Array | null {
      if (buffer.length === 0) return null;
      const rest = buffer;
      buffer = new Uint8Array(0);
      return rest;
    },
  };
}

/** btoa over bytes, in slices so a large chunk cannot overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}
