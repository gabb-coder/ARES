import type { ListenOptions, ListenSession, SpeechInput } from './types';
import { SpeechInputError } from './types';

// Minimal typings: the Web Speech API is still prefixed in Chromium and not
// part of every TypeScript DOM lib.
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const isWebSpeechSupported = () => recognitionCtor() !== null;

const ERRORS: Record<string, [message: string, fatal: boolean]> = {
  'not-allowed': ['Microphone access was blocked. Allow it from the address bar.', true],
  'service-not-allowed': ['Speech recognition is disabled in this browser.', true],
  'audio-capture': ['No microphone was found.', true],
  network: ["The browser's speech service is unreachable. Switch to local STT for offline use.", true],
  'language-not-supported': ['That recognition language is not supported.', true],
};

/** Speech-to-text through the browser's Web Speech API. */
export class WebSpeechInput implements SpeechInput {
  readonly engine = 'webspeech' as const;

  constructor(private readonly language: string) {}

  listen({ onInterim, timeoutMs }: ListenOptions = {}): ListenSession {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      const error = new SpeechInputError('This browser has no Web Speech API. Use Chrome, Edge or Safari, or switch to local STT.', true);
      return { result: Promise.reject(error), stop() {}, abort() {} };
    }

    const rec = new Ctor();
    rec.lang = this.language;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let finalText = '';
    let heardSpeech = false;
    let aborted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const result = new Promise<string>((resolve, reject) => {
      let failure: SpeechInputError | null = null;

      rec.onspeechstart = () => {
        heardSpeech = true;
      };
      rec.onresult = (e) => {
        heardSpeech = true;
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]!;
          if (r.isFinal) finalText += r[0]?.transcript ?? '';
          else interim += r[0]?.transcript ?? '';
        }
        onInterim?.(`${finalText}${interim}`.trim());
      };
      rec.onerror = (e) => {
        // "no-speech" and "aborted" are normal endings, not failures.
        const known = ERRORS[e.error];
        if (known) failure = new SpeechInputError(known[0], known[1]);
        else if (e.error !== 'no-speech' && e.error !== 'aborted') {
          failure = new SpeechInputError(`Speech recognition error: ${e.error}`, false);
        }
      };
      rec.onend = () => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else resolve(aborted ? '' : finalText.trim());
      };
    });

    try {
      rec.start();
    } catch (err) {
      return { result: Promise.reject(new SpeechInputError((err as Error).message, false)), stop() {}, abort() {} };
    }

    if (timeoutMs) {
      timer = setTimeout(() => {
        if (!heardSpeech) rec.abort();
      }, timeoutMs);
    }

    return {
      result,
      stop: () => rec.stop(),
      abort: () => {
        aborted = true;
        rec.abort();
      },
    };
  }

  dispose(): void {}
}
