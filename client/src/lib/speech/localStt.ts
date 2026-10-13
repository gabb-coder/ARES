import { aresConfig } from '../../config';
import type { Microphone } from '../audio/microphone';
import type { ListenOptions, ListenSession, SpeechInput } from './types';
import { SpeechInputError } from './types';

type ServerMessage =
  | { type: 'ready'; sampleRate: number }
  | { type: 'transcript'; text: string }
  | { type: 'error'; message: string };

/** Without a timeout, restart idle segments so silence never piles up server-side. */
const IDLE_SEGMENT_MS = 20_000;

/**
 * Streams microphone PCM to the ARES server over a WebSocket; the server hands
 * each utterance to a local whisper server. End of speech is detected here
 * with a simple energy-based voice activity detector.
 */
export class LocalSttInput implements SpeechInput {
  readonly engine = 'local' as const;
  #socket: WebSocket | null = null;
  #ready: Promise<WebSocket> | null = null;
  #pending: { resolve: (text: string) => void; reject: (err: Error) => void } | null = null;

  constructor(private readonly getMic: () => Promise<Microphone>) {}

  listen({ timeoutMs }: ListenOptions = {}): ListenSession {
    // Calls that arrive before the mic and socket are ready just cancel.
    let early = false;
    let settle: { stop: () => void; abort: () => void } = {
      stop: () => {
        early = true;
      },
      abort: () => {
        early = true;
      },
    };

    const result = (async () => {
      const [mic, ws] = await Promise.all([this.getMic(), this.#connect()]);
      return new Promise<string>((resolve, reject) => {
        const started = performance.now();
        let lastVoice = 0;
        let speaking = false;
        let done = false;
        let stopStream: (() => void) | null = null;

        const cleanup = () => {
          done = true;
          clearInterval(vad);
          stopStream?.();
        };
        const finish = () => {
          if (done) return;
          cleanup();
          ws.send(JSON.stringify({ type: 'end' }));
          this.#pending = { resolve, reject };
        };
        const cancel = () => {
          if (done) return;
          cleanup();
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'cancel' }));
          resolve('');
        };
        settle = { stop: () => (speaking ? finish() : cancel()), abort: cancel };
        if (early) {
          cancel();
          return;
        }

        const { speechThreshold, endOfSpeechMs } = aresConfig.stt;
        const vad = setInterval(() => {
          const now = performance.now();
          if (mic.level() > speechThreshold) {
            speaking = true;
            lastVoice = now;
          } else if (speaking && now - lastVoice > endOfSpeechMs) {
            finish();
          } else if (!speaking && now - started > (timeoutMs ?? IDLE_SEGMENT_MS)) {
            cancel();
          }
        }, 50);

        ws.send(JSON.stringify({ type: 'start' }));
        void mic
          .streamPcm16k((chunk) => {
            if (!done && ws.readyState === WebSocket.OPEN) ws.send(chunk);
          })
          .then((stop) => {
            if (done) stop();
            else stopStream = stop;
          }, reject);
      });
    })();

    return { result, stop: () => settle.stop(), abort: () => settle.abort() };
  }

  #connect(): Promise<WebSocket> {
    const state = this.#socket?.readyState;
    if (this.#ready && (state === WebSocket.CONNECTING || state === WebSocket.OPEN)) return this.#ready;

    this.#ready = new Promise<WebSocket>((resolve, reject) => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/stt`;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this.#socket = ws;

      ws.onmessage = (e: MessageEvent<string>) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === 'ready') resolve(ws);
        else if (msg.type === 'transcript') {
          this.#pending?.resolve(msg.text);
          this.#pending = null;
        } else if (msg.type === 'error') {
          const error = new SpeechInputError(msg.message, /not configured/i.test(msg.message));
          if (this.#pending) {
            this.#pending.reject(error);
            this.#pending = null;
          } else reject(error);
        }
      };
      ws.onerror = () => reject(new SpeechInputError('Cannot reach the ARES speech socket.', false));
      ws.onclose = () => {
        this.#pending?.reject(new SpeechInputError('Speech socket closed.', false));
        this.#pending = null;
        this.#ready = null;
        this.#socket = null;
      };
    });
    return this.#ready;
  }

  dispose(): void {
    this.#socket?.close();
    this.#socket = null;
    this.#ready = null;
  }
}
