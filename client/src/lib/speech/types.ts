import type { SttEngine } from '../../config';

export interface ListenOptions {
  onInterim?: (text: string) => void;
  /** Resolve with '' if no speech starts within this window. */
  timeoutMs?: number;
}

/** One utterance being captured. */
export interface ListenSession {
  /** Final transcript, or '' if nothing was said (or the session was aborted). */
  result: Promise<string>;
  /** Stop listening and transcribe what was heard so far. */
  stop(): void;
  /** Stop listening and discard. */
  abort(): void;
}

export interface SpeechInput {
  readonly engine: SttEngine;
  listen(options?: ListenOptions): ListenSession;
  dispose(): void;
}

export class SpeechInputError extends Error {
  constructor(
    message: string,
    /** True when retrying won't help (permissions, unsupported browser). */
    readonly fatal: boolean,
  ) {
    super(message);
  }
}
