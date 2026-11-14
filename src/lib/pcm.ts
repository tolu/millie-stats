// From microphone samples to what the live transcription model accepts:
// 16-bit little-endian PCM, 16 kHz, mono.
//
// Chrome on Android is the only browser this app supports. Its AudioContext
// is created at 16 kHz and Chrome resamples the microphone itself, so no
// resampling happens here; pcm-worklet.js already batches to 100 ms.

export const TARGET_RATE = 16_000;

/** Float samples in [-1, 1] to signed 16-bit little-endian bytes, clamped. */
export function toPcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return bytes;
}
