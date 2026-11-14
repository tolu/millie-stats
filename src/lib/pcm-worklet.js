// Runs on the audio thread. Copies the microphone's first channel out in
// batches; resampling and encoding happen on the main thread in pcm.ts, where
// they can be tested.
//
// Plain JavaScript on purpose: a worklet module is loaded by URL and gets no
// build step, and static imports inside worklets are not dependable on iOS.
//
// The audio thread calls process() with 128-frame blocks, ~375 times a second
// at 48 kHz. Posting each one would flood the main thread, so they are batched
// to ~40 ms. A "flush" message posts what is left, so the last words before
// the button is released are not dropped.

const BATCH = 2048;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batch = new Float32Array(BATCH);
    this.filled = 0;
    this.port.onmessage = (event) => {
      if (event.data === "flush") this.post(true);
    };
  }

  post(done) {
    const out = this.batch.slice(0, this.filled);
    this.filled = 0;
    this.port.postMessage({ samples: out, done }, [out.buffer]);
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.batch[this.filled++] = channel[i];
        if (this.filled === BATCH) this.post(false);
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
