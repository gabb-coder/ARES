export interface HookCard {
  title: string;
  items?: string[];
  fields?: Array<{ label: string; value: string }>;
  body?: string;
  link?: string;
}

export interface CommandResponse {
  id: string;
  utterance: string;
  intent: string | null;
  speech: string;
  card?: HookCard;
  ok: boolean;
  durationMs: number;
}

export interface HookInfo {
  name: string;
  category: string;
  description: string;
  examples: string[];
}

export interface ServerConfig {
  persona: { name: string; tagline: string };
  tts: { provider: 'browser' | 'elevenlabs' | 'fishaudio'; available: boolean };
  stt: { local: boolean };
  brain: { provider: string; model?: string };
  dryRun: boolean;
  hooks: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError('ARES server is unreachable', 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  config: () => request<ServerConfig>('/api/config'),
  hooks: () => request<HookInfo[]>('/api/hooks'),
  command: (text: string) => request<CommandResponse>('/api/command', json({ text })),
  async tts(text: string, signal?: AbortSignal): Promise<Blob> {
    const res = await fetch('/api/tts', { ...json({ text }), signal });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(body?.error ?? `TTS failed (${res.status})`, res.status);
    }
    return res.blob();
  },
};
