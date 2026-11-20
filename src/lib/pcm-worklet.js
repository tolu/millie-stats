// Runs on the audio thread: batches the microphone's first channel into
// 100 ms, the chunk size the model wants. Encoding happens on the main thread
// in pcm.ts, where it can be tested. Plain JavaScript, since a worklet module
// is loaded by URL and gets no build step.
//
// A "flush" message posts what is left, so the last words before stop are
// not dropped.

const BATCH = 1600;

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
    const channel = inputs[0]?.[0];
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
