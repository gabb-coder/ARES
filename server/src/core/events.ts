import { EventEmitter } from 'node:events';
import type { HookCard } from './types.js';

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
  /** Present when state is "needs-auth": open it to sign in. */
  authUrl?: string;
}

/** Everything the server pushes to the dashboard over /api/events. */
export type AresEvent =
  | { type: 'alert'; id: string; kind: ScheduledItem['kind']; speech: string; card?: HookCard }
  | { type: 'schedule'; items: ScheduledItem[] }
  | { type: 'integrations'; servers: IntegrationStatus[] };

export class EventBus {
  readonly #emitter = new EventEmitter().setMaxListeners(50);

  emit(event: AresEvent): void {
    this.#emitter.emit('event', event);
  }

  subscribe(listener: (event: AresEvent) => void): () => void {
    this.#emitter.on('event', listener);
    return () => this.#emitter.off('event', listener);
  }
}
