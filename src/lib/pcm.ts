// From microphone samples to what the live transcription model accepts:
// 16-bit little-endian PCM, 16 kHz, mono, in roughly 100 ms chunks.
//
// Chrome on Android is the only browser this app supports. Its AudioContext
// is created at 16 kHz and Chrome resamples the microphone itself, so no
// resampling happens here.

export const TARGET_RATE = 16_000;
/** 100 ms at 16 kHz, two bytes a sample. Google recommends ~100 ms chunks. */
export const CHUNK_BYTES = (TARGET_RATE / 10) * 2;

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
