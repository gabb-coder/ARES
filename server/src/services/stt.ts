import type { AppConfig } from '../config.js';

/** Sample format the dashboard streams over /ws/stt: 16 kHz, mono, signed 16-bit LE. */
export const STT_SAMPLE_RATE = 16_000;

export interface SttService {
  readonly available: boolean;
  transcribe(pcm: Buffer): Promise<string>;
}

/**
 * Local speech-to-text via a whisper server on this machine, e.g.
 *   whisper.cpp:  ./whisper-server -m models/ggml-base.en.bin --port 8080
 *   or any OpenAI-compatible server (faster-whisper-server, speaches, LocalAI).
 * Audio never leaves the machine unless LOCAL_STT_URL points elsewhere.
 */
export function createStt(config: AppConfig['stt']): SttService {
  return {
    available: Boolean(config.url),
    async transcribe(pcm) {
      if (!config.url) throw new Error('LOCAL_STT_URL is not set');
      const wav = new Blob([new Uint8Array(encodeWav(pcm, STT_SAMPLE_RATE))], { type: 'audio/wav' });
      const form = new FormData();
      form.append('file', wav, 'speech.wav');

      let endpoint: string;
      if (config.api === 'openai') {
        endpoint = `${config.url}/v1/audio/transcriptions`;
        form.append('model', config.model);
        form.append('language', config.language);
        form.append('response_format', 'json');
      } else {
        endpoint = `${config.url}/inference`;
        form.append('response_format', 'json');
        form.append('language', config.language);
        form.append('temperature', '0.0');
      }

      let res: Response;
      try {
        res = await fetch(endpoint, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
      } catch {
        throw new Error(`The speech server at ${config.url} isn't reachable`);
      }
      if (!res.ok) throw new Error(`The speech server returned ${res.status}`);
      const data = (await res.json()) as { text?: string };
      return cleanTranscript(data.text ?? '');
    },
  };
}

/** Whisper emits markers like "[BLANK_AUDIO]" or "(wind blowing)" for non-speech. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Wraps raw PCM16 mono samples in a minimal RIFF/WAVE header. */
export function encodeWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
