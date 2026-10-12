export interface HookCard {
  title: string;
  items?: string[];
  fields?: Array<{ label: string; value: string }>;
  body?: string;
  link?: string;
}

export interface PendingAction {
  id: string;
  /** e.g. "gmail · send_email" */
  title: string;
  summary: string;
  args: Record<string, unknown>;
  expiresAt: number;
}

export interface CommandResponse {
  id: string;
  utterance: string;
  intent: string | null;
  speech: string;
  card?: HookCard;
  ok: boolean;
  durationMs: number;
  /** An action the agent is holding until the user confirms. */
  pending?: PendingAction;
}

export interface ScheduledItem {
  id: string;
  kind: 'timer' | 'reminder';
  label: string;
  dueAt: number;
  createdAt: number;
}

export interface IntegrationStatus {
  name: string;
  state: 'connecting' | 'connected' | 'needs-auth' | 'error' | 'disabled';
  tools: number;
  error?: string;
  authUrl?: string;
}

/** Pushed by the server over /api/events. */
export type AresEvent =
  | { type: 'alert'; id: string; kind: ScheduledItem['kind']; speech: string; card?: HookCard }
  | { type: 'schedule'; items: ScheduledItem[] }
  | { type: 'integrations'; servers: IntegrationStatus[] };

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
  integrations: number;
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
  resolvePending: (id: string, approve: boolean) =>
    request<CommandResponse>(`/api/pending/${encodeURIComponent(id)}`, json({ approve })),
  async cancelScheduled(id: string): Promise<void> {
    await fetch(`/api/schedule/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  reconnectIntegration: (name: string) =>
    request<{ servers: IntegrationStatus[] }>(`/api/integrations/${encodeURIComponent(name)}/reconnect`, { method: 'POST' }),
  /** Subscribes to server events; EventSource reconnects on its own. Returns a close function. */
  events(onEvent: (event: AresEvent) => void): () => void {
    const source = new EventSource('/api/events');
    source.onmessage = (e: MessageEvent<string>) => {
      try {
        onEvent(JSON.parse(e.data) as AresEvent);
      } catch {
        // ignore malformed frames
      }
    };
    return () => source.close();
  },
  async tts(text: string, signal?: AbortSignal): Promise<Blob> {
    const res = await fetch('/api/tts', { ...json({ text }), signal });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(body?.error ?? `TTS failed (${res.status})`, res.status);
    }
    return res.blob();
  },
};
