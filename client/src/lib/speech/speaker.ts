import { aresConfig, type TtsEngine } from '../../config';
import { api } from '../api';

export interface SpeakOptions {
  engine: TtsEngine;
  /** Whether the server has a cloud voice configured. */
  serverAvailable: boolean;
  voiceURI: string | null;
  rate: number;
  pitch: number;
}

export const isSynthesisSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/**
 * Text-to-speech. The browser's speechSynthesis is the default and always the
 * fallback; the server engine plays audio from ElevenLabs / Fish Audio.
 */
export class Speaker {
  /** Live output analyser while server audio plays (drives the visualizer). */
  analyser: AnalyserNode | null = null;
  /** Chrome can garbage-collect a playing utterance (and never fire "end"); hold it. */
  readonly #live = new Set<SpeechSynthesisUtterance>();
  #audio: HTMLAudioElement | null = null;
  #abort: AbortController | null = null;
  #context: AudioContext | null = null;
  #finish: (() => void) | null = null;

  voices(): SpeechSynthesisVoice[] {
    return isSynthesisSupported() ? window.speechSynthesis.getVoices() : [];
  }

  /** Calls back whenever the installed voice list changes (it loads async). */
  onVoicesChanged(callback: () => void): () => void {
    if (!isSynthesisSupported()) return () => {};
    window.speechSynthesis.addEventListener('voiceschanged', callback);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', callback);
  }

  pickVoice(voiceURI: string | null): SpeechSynthesisVoice | null {
    const voices = this.voices();
    if (voices.length === 0) return null;
    const byUri = voiceURI ? voices.find((v) => v.voiceURI === voiceURI) : undefined;
    if (byUri) return byUri;
    for (const name of aresConfig.tts.preferredVoices) {
      const match = voices.find((v) => v.name === name) ?? voices.find((v) => v.name.startsWith(name));
      if (match) return match;
    }
    return (
      voices.find((v) => v.lang === 'en-GB') ??
      voices.find((v) => v.lang.startsWith('en') && v.default) ??
      voices.find((v) => v.lang.startsWith('en')) ??
      voices[0]!
    );
  }

  /** Speaks `text` and resolves when playback ends (or is stopped). */
  async speak(text: string, options: SpeakOptions): Promise<void> {
    this.stop();
    if (!text.trim()) return;

    if (options.engine === 'server' && options.serverAvailable) {
      try {
        await this.#speakServer(text);
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.warn('[ARES] server TTS failed, falling back to browser voice:', err);
      }
    }
    await this.#speakBrowser(text, options);
  }

  stop(): void {
    this.#abort?.abort();
    this.#abort = null;
    if (this.#audio) {
      this.#audio.pause();
      this.#audio = null;
    }
    if (isSynthesisSupported()) window.speechSynthesis.cancel();
    this.#live.clear();
    this.analyser = null;
    this.#finish?.();
    this.#finish = null;
  }

  #speakBrowser(text: string, { voiceURI, rate, pitch }: SpeakOptions): Promise<void> {
    if (!isSynthesisSupported()) return Promise.resolve();
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = this.pickVoice(voiceURI);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = aresConfig.tts.volume;

      // Some engines never fire "end"; don't let ARES hang in "speaking".
      const watchdog = setTimeout(() => done(), 4000 + text.length * 120);
      const done = () => {
        clearTimeout(watchdog);
        this.#live.delete(utterance);
        resolve();
      };
      this.#finish = done;
      utterance.onend = done;
      utterance.onerror = done;
      this.#live.add(utterance);
      synth.speak(utterance);
    });
  }

  async #speakServer(text: string): Promise<void> {
    const abort = new AbortController();
    this.#abort = abort;
    const blob = await api.tts(text, abort.signal);
    if (abort.signal.aborted) return;

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.#audio = audio;
    this.#attachAnalyser(audio);

    await new Promise<void>((resolve, reject) => {
      const done = () => {
        URL.revokeObjectURL(url);
        this.analyser = null;
        resolve();
      };
      this.#finish = done;
      audio.onended = done;
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Audio playback failed'));
      };
      audio.play().catch(reject);
    });
  }

  #attachAnalyser(audio: HTMLAudioElement) {
    try {
      this.#context ??= new AudioContext();
      const source = this.#context.createMediaElementSource(audio);
      const analyser = this.#context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyser.connect(this.#context.destination);
      this.analyser = analyser;
      void this.#context.resume();
    } catch {
      this.analyser = null; // visualizer falls back to a synthetic waveform
    }
  }
}
