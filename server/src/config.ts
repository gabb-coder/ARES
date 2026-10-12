import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');

// Load server/.env regardless of the working directory the process starts in.
dotenv.config({ path: path.join(SERVER_ROOT, '.env'), quiet: true });

export type TtsProvider = 'browser' | 'elevenlabs' | 'fishaudio';
export type BrainProvider = 'none' | 'ollama' | 'anthropic';
export type LocalSttApi = 'whisper.cpp' | 'openai';

export interface AppConfig {
  host: string;
  port: number;
  /** Extra origins allowed to call the API (the Vite dev server is always allowed). */
  allowedOrigins: string[];
  /** Directory that filesystem hooks are confined to. */
  fsRoot: string;
  pluginDir: string;
  clientDist: string;
  /** Where ARES keeps its own state: reminders, integration tokens. */
  dataDir: string;
  /** MCP integrations file (Claude Desktop-style "mcpServers"). */
  integrationsFile: string;
  /** Log system actions (open URL, launch app) instead of performing them. */
  dryRun: boolean;
  tts: {
    provider: TtsProvider;
    elevenlabs: { apiKey: string; voiceId: string; modelId: string; outputFormat: string };
    fishaudio: { apiKey: string; referenceId: string; model: string };
  };
  stt: {
    /** Base URL of a local speech-to-text server. Empty disables server-side transcription. */
    url: string;
    api: LocalSttApi;
    model: string;
    language: string;
  };
  brain: {
    provider: BrainProvider;
    ollama: { url: string; model: string; think: boolean | null };
    anthropic: { model: string };
    historyTurns: number;
    /** Upper bound on tools offered to the model per request. */
    maxTools: number;
    /** Ollama context window; tool definitions need room. */
    ollamaContext: number;
  };
  apps: Record<string, string[]>;
  weather: {
    /** Default place for "what's the weather": a city name or "lat,lon". */
    location: string;
    units: 'celsius' | 'fahrenheit';
  };
}

function env(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = env(name, fallback).toLowerCase() as T;
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')} (got "${value}")`);
  }
  return value;
}

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

/**
 * Allowlisted desktop apps for the `app.launch` hook. Values are argv arrays,
 * spawned without a shell. Override with ARES_APPS='{"spotify":["spotify"]}'.
 */
function defaultApps(): Record<string, string[]> {
  switch (process.platform) {
    case 'darwin':
      return {
        calculator: ['open', '-a', 'Calculator'],
        terminal: ['open', '-a', 'Terminal'],
        finder: ['open', '-a', 'Finder'],
        notes: ['open', '-a', 'Notes'],
        'vs code': ['open', '-a', 'Visual Studio Code'],
      };
    case 'win32':
      return {
        calculator: ['calc.exe'],
        notepad: ['notepad.exe'],
        terminal: ['wt.exe'],
        explorer: ['explorer.exe'],
        'vs code': ['code'],
      };
    default:
      return {
        calculator: ['gnome-calculator'],
        terminal: ['x-terminal-emulator'],
        files: ['xdg-open', os.homedir()],
        'text editor': ['gedit'],
        'vs code': ['code'],
      };
  }
}

function parseApps(): Record<string, string[]> {
  const raw = env('ARES_APPS');
  if (!raw) return defaultApps();
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('ARES_APPS must be a JSON object of { "name": ["command", "arg"] }');
  }
  const apps: Record<string, string[]> = {};
  for (const [name, argv] of Object.entries(parsed)) {
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === 'string')) {
      throw new Error(`ARES_APPS["${name}"] must be a non-empty array of strings`);
    }
    apps[name.toLowerCase()] = argv;
  }
  return apps;
}

/** Fahrenheit where it's customary (US and a few others), Celsius elsewhere. */
function defaultTemperatureUnit(): 'celsius' | 'fahrenheit' {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const region = new Intl.Locale(locale).maximize().region ?? '';
  return ['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH'].includes(region) ? 'fahrenheit' : 'celsius';
}

export function loadConfig(): AppConfig {
  const port = Number(env('ARES_PORT', '3001'));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`ARES_PORT must be a valid port (got "${env('ARES_PORT')}")`);
  }

  return {
    host: env('ARES_HOST', '127.0.0.1'),
    port,
    allowedOrigins: env('ARES_ALLOWED_ORIGINS')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    fsRoot: path.resolve(expandHome(env('ARES_FS_ROOT', os.homedir()))),
    pluginDir: path.resolve(SERVER_ROOT, env('ARES_PLUGIN_DIR', 'plugins')),
    dataDir: path.resolve(expandHome(env('ARES_DATA_DIR', '~/.ares'))),
    integrationsFile: path.resolve(SERVER_ROOT, expandHome(env('ARES_INTEGRATIONS', 'integrations.json'))),
    clientDist: path.resolve(SERVER_ROOT, '..', 'client', 'dist'),
    dryRun: ['1', 'true', 'yes'].includes(env('ARES_DRY_RUN').toLowerCase()),
    tts: {
      provider: oneOf('TTS_PROVIDER', ['browser', 'elevenlabs', 'fishaudio'] as const, 'browser'),
      elevenlabs: {
        apiKey: env('ELEVENLABS_API_KEY'),
        voiceId: env('ELEVENLABS_VOICE_ID', 'JBFqnCBsd6RMkjVDRZzb'),
        modelId: env('ELEVENLABS_MODEL_ID', 'eleven_multilingual_v2'),
        outputFormat: env('ELEVENLABS_OUTPUT_FORMAT', 'mp3_44100_128'),
      },
      fishaudio: {
        apiKey: env('FISH_AUDIO_API_KEY'),
        referenceId: env('FISH_AUDIO_REFERENCE_ID'),
        model: env('FISH_AUDIO_MODEL'),
      },
    },
    stt: {
      url: env('LOCAL_STT_URL').replace(/\/+$/, ''),
      api: oneOf('LOCAL_STT_API', ['whisper.cpp', 'openai'] as const, 'whisper.cpp'),
      model: env('LOCAL_STT_MODEL', 'whisper-1'),
      language: env('LOCAL_STT_LANGUAGE', 'en'),
    },
    brain: {
      provider: oneOf('ARES_BRAIN', ['none', 'ollama', 'anthropic'] as const, 'none'),
      ollama: {
        url: env('OLLAMA_URL', 'http://127.0.0.1:11434').replace(/\/+$/, ''),
        model: env('OLLAMA_MODEL', 'qwen3:8b'),
        // Unset: the model's default. "false" skips reasoning for faster spoken replies.
        think: env('OLLAMA_THINK') ? env('OLLAMA_THINK').toLowerCase() === 'true' : null,
      },
      anthropic: { model: env('ANTHROPIC_MODEL', 'claude-opus-5-5') },
      historyTurns: Number(env('ARES_BRAIN_HISTORY', '6')),
      maxTools: Number(env('ARES_AGENT_MAX_TOOLS', '40')),
      ollamaContext: Number(env('OLLAMA_NUM_CTX', '16384')),
    },
    apps: parseApps(),
    weather: {
      location: env('WEATHER_LOCATION'),
      units: oneOf('WEATHER_UNITS', ['celsius', 'fahrenheit'] as const, defaultTemperatureUnit()),
    },
  };
}
