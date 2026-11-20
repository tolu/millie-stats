// One dictation: microphone → AudioWorklet → 16 kHz PCM → Gemini Live, and
// the text back. Browser-only.
//
// Two things start at once on the tap: the microphone, and fetching a token
// and opening the socket. The second takes half a second or more, and
// waiting for it before listening would cut off the first words, so audio is
// queued until the session is ready and then sent in order.
//
// `stop()` never rejects. It returns whatever was understood, because a
// dropped connection halfway through should still keep the first half. A
// failure is reported through `onError` as it happens.

import { voiceToken } from "../server/voice";
import { rms, TARGET_RATE, toPcm16 } from "./pcm";
import {
  EMPTY_TRANSCRIPT,
  parseServerMessage,
  reduceTranscript,
  type ServerEvent,
  type Transcript,
  transcriptText,
} from "./transcript";
import { TRANSCRIBE_MODEL } from "./voice";

const LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const WORKLET_URL = new URL("./pcm-worklet.js", import.meta.url);

/** How long the worklet gets to hand over its last batch. */
const DRAIN_MS = 500;
/** After the end of the audio: if no turn is open by then, nothing more is coming. */
const QUIET_MS = 1_000;
/** After the end of the audio: the most we wait for the last final. */
const FINAL_MS = 4_000;
/** After release, if the session never came up. */
const CONNECT_MS = 8_000;

/** Chrome's defaults already cancel echo, suppress noise and control gain. */
async function microphone(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (cause) {
    throw new Error(
      cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Mikrofonen er blokkert. Tillat den for denne siden."
        : "Fikk ikke tak i mikrofonen.",
    );
  }
}

export type DictationOptions = {
  /** The text so far: finished turns, cleaned, and the turn being spoken. */
  readonly onText: (transcript: Transcript) => void;
  /** Loudness of the microphone, ten times a second, as root mean square. */
  readonly onLevel: (rms: number) => void;
  readonly onError: (message: string) => void;
};

/** Call from inside the tap: Chrome only lets audio start in a user gesture. */
export function startDictation(options: DictationOptions) {
  // At the model's rate: Chrome resamples the microphone into it.
  const context = new AudioContext({ sampleRate: TARGET_RATE });

  let transcript = EMPTY_TRANSCRIPT;
  let socket: WebSocket | null = null;
  let ready = false;
  const outbox: string[] = [];
  let ending = false;
  let endSent = false;
  let finished = false;
  let stream: MediaStream | null = null;
  let worklet: AudioWorkletNode | null = null;
  let drained: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));

  function wait(ms: number, then: () => void) {
    clearTimeout(timer);
    timer = setTimeout(then, ms);
  }

  function releaseAudio() {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    worklet?.port.close();
    worklet = null;
    if (context.state !== "closed") void context.close().catch(() => {});
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    releaseAudio();
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000);
    resolveDone();
  }

  function fail(message: string) {
    if (!finished) options.onError(message);
    finish();
  }

  function sendAudio(data: string) {
    if (finished) return;
    if (ready && socket) {
      socket.send(
        JSON.stringify({ realtimeInput: { audio: { data, mimeType: "audio/pcm;rate=16000" } } }),
      );
    } else {
      outbox.push(data);
    }
  }

  function sendEnd() {
    if (endSent || !ready || !socket) return;
    endSent = true;
    socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    // A grace period for words in the last chunks, then: nothing mid-turn means
    // nothing more is coming — silence gets no reply, and a turn a pause
    // already closed has had its final.
    wait(QUIET_MS, () => {
      if (!transcript.open) finish();
      else wait(FINAL_MS - QUIET_MS, finish);
    });
  }

  function handle(event: ServerEvent) {
    if (event.kind === "setup") {
      ready = true;
      for (const data of outbox.splice(0)) sendAudio(data);
      if (ending) sendEnd();
      return;
    }
    transcript = reduceTranscript(transcript, event);
    if (event.kind === "interim" || event.kind === "final") options.onText(transcript);
    // Only after our own end, and only once nothing is left mid-turn: a
    // `complete` can also close an earlier turn while the next is spoken.
    if (event.kind === "complete" && endSent && !transcript.open) finish();
  }

  async function startAudio() {
    await context.audioWorklet.addModule(WORKLET_URL);
    const opened = await microphone();
    if (finished || ending) {
      for (const track of opened.getTracks()) track.stop();
      return;
    }
    stream = opened;
    const node = new AudioWorkletNode(context, "pcm-capture");
    // The worklet already batches to 100 ms, the chunk size Google recommends.
    node.port.onmessage = (event: MessageEvent<{ samples: Float32Array; done: boolean }>) => {
      const { samples, done } = event.data;
      if (samples.length) {
        sendAudio(toPcm16(samples).toBase64());
        options.onLevel(rms(samples));
      }
      if (done) drained?.();
    };
    // Through a muted gain to the output, so the graph pulls the worklet
    // without playing the microphone back through the speaker.
    const mute = new GainNode(context, { gain: 0 });
    context.createMediaStreamSource(opened).connect(node);
    node.connect(mute);
    mute.connect(context.destination);
    worklet = node;
  }

  async function connect() {
    const reply = await voiceToken();
    if (!reply.ok) throw new Error(reply.message);
    if (finished) return;
    const ws = new WebSocket(`${LIVE_URL}?access_token=${encodeURIComponent(reply.token)}`);
    ws.binaryType = "arraybuffer";
    socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ setup: { model: `models/${TRANSCRIBE_MODEL}` } }));
    ws.onmessage = (message: MessageEvent<string | ArrayBuffer>) => {
      const text =
        typeof message.data === "string" ? message.data : new TextDecoder().decode(message.data);
      for (const event of parseServerMessage(text)) handle(event);
    };
    ws.onclose = (event) => {
      if (finished) return;
      if (endSent) finish();
      else
        fail(
          `Forbindelsen til Gemini ble brutt (${event.code}${event.reason ? `: ${event.reason}` : ""}).`,
        );
    };
  }

  startAudio().catch((cause: unknown) =>
    fail(cause instanceof Error ? cause.message : "Fikk ikke startet opptaket."),
  );
  connect().catch((cause: unknown) =>
    fail(cause instanceof Error ? cause.message : "Fikk ikke kontakt med Gemini."),
  );

  return {
    /** Ends the recording and resolves with the text, once the last of it is back. */
    async stop(): Promise<string> {
      if (!ending && !finished) {
        ending = true;
        if (worklet) {
          const node = worklet;
          await new Promise<void>((resolve) => {
            drained = resolve;
            node.port.postMessage("flush");
            setTimeout(resolve, DRAIN_MS);
          });
        }
        releaseAudio();
        if (ready) sendEnd();
        else wait(CONNECT_MS, () => fail("Fikk ikke kontakt med Gemini."));
      }
      await done;
      return transcriptText(transcript);
    },
    /** Abandons the recording without an error. For when the page goes away. */
    cancel() {
      finish();
    },
  };
}

export type Dictation = ReturnType<typeof startDictation>;
