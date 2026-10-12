import { aresConfig, type SttEngine, type TtsEngine } from '../config';
import type { ServerConfig } from './api';

export interface Settings {
  sttEngine: SttEngine;
  ttsEngine: TtsEngine | 'auto';
  voiceURI: string | null;
  rate: number;
  pitch: number;
  wakeWord: boolean;
  muted: boolean;
}

const KEY = 'ares.settings.v1';

export const defaultSettings: Settings = {
  sttEngine: aresConfig.stt.engine,
  ttsEngine: aresConfig.tts.engine,
  voiceURI: null,
  rate: aresConfig.tts.rate,
  pitch: aresConfig.tts.pitch,
  wakeWord: aresConfig.wake.enabled,
  muted: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private mode or blocked storage: settings just won't persist.
  }
}

/** The voice engine actually in use once "auto" is resolved against the server. */
export function effectiveTts(settings: Settings, server: ServerConfig | null): TtsEngine {
  const cloud = Boolean(server?.tts.available);
  if (settings.ttsEngine === 'auto') return cloud ? 'server' : 'browser';
  return settings.ttsEngine === 'server' && cloud ? 'server' : 'browser';
}
