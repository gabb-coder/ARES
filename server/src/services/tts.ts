import type { AppConfig, TtsProvider } from '../config.js';

/**
 * Cloud TTS fallbacks. The browser's speechSynthesis is the default and needs
 * nothing from the server; these adapters exist so API keys stay server-side.
 */
export interface SpeechAudio {
  audio: Buffer;
  contentType: string;
}

export interface TtsService {
  /** The provider the server is configured for ("browser" means no server TTS). */
  readonly provider: TtsProvider;
  /** True when a cloud provider is configured with credentials. */
  readonly available: boolean;
  synthesize(text: string): Promise<SpeechAudio>;
}

export function createTts(config: AppConfig['tts']): TtsService {
  switch (config.provider) {
    case 'elevenlabs':
      return {
        provider: 'elevenlabs',
        available: Boolean(config.elevenlabs.apiKey),
        synthesize: (text) => elevenlabs(text, config.elevenlabs),
      };
    case 'fishaudio':
      return {
        provider: 'fishaudio',
        available: Boolean(config.fishaudio.apiKey),
        synthesize: (text) => fishaudio(text, config.fishaudio),
      };
    default:
      return {
        provider: 'browser',
        available: false,
        synthesize: () => Promise.reject(new Error('Server TTS is disabled (TTS_PROVIDER=browser)')),
      };
  }
}

async function elevenlabs(text: string, cfg: AppConfig['tts']['elevenlabs']): Promise<SpeechAudio> {
  if (!cfg.apiKey) throw new Error('ELEVENLABS_API_KEY is not set');
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.voiceId)}`);
  url.searchParams.set('output_format', cfg.outputFormat);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: cfg.modelId,
      voice_settings: { stability: 0.55, similarity_boost: 0.75 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  return readAudio(res, 'ElevenLabs', mimeFor(cfg.outputFormat));
}

async function fishaudio(text: string, cfg: AppConfig['tts']['fishaudio']): Promise<SpeechAudio> {
  if (!cfg.apiKey) throw new Error('FISH_AUDIO_API_KEY is not set');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (cfg.model) headers.model = cfg.model;

  const res = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      text,
      format: 'mp3',
      latency: 'balanced',
      ...(cfg.referenceId ? { reference_id: cfg.referenceId } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  return readAudio(res, 'Fish Audio', 'audio/mpeg');
}

async function readAudio(res: Response, vendor: string, fallbackType: string): Promise<SpeechAudio> {
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${vendor} returned ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
  }
  return {
    audio: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type')?.split(';')[0] || fallbackType,
  };
}

function mimeFor(outputFormat: string): string {
  if (outputFormat.startsWith('mp3')) return 'audio/mpeg';
  if (outputFormat.startsWith('opus')) return 'audio/ogg';
  if (outputFormat.startsWith('wav')) return 'audio/wav';
  return 'application/octet-stream';
}
