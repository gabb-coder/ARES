import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { phrases } from '../persona.js';
import type { Brain } from '../services/brain.js';
import type { FsSandbox } from '../services/fsSandbox.js';
import type { Launcher } from '../services/launcher.js';
import { normalizeUtterance } from './intent.js';
import type { HookRegistry } from './registry.js';
import type { HookCard, HookContext, Logger } from './types.js';

export const MAX_UTTERANCE_CHARS = 500;
const HOOK_TIMEOUT_MS = 15_000;

export interface CommandResponse {
  id: string;
  utterance: string;
  /** Hook that handled the command, "brain" for the LLM fallback, or null. */
  intent: string | null;
  speech: string;
  card?: HookCard;
  ok: boolean;
  durationMs: number;
}

export interface AssistantDeps {
  registry: HookRegistry;
  brain: Brain | null;
  config: AppConfig;
  log: Logger;
  fs: FsSandbox;
  launcher: Launcher;
}

/** Turns an utterance into a spoken reply: hooks first, then the optional LLM. */
export class Assistant {
  constructor(private readonly deps: AssistantDeps) {}

  async handle(utterance: string): Promise<CommandResponse> {
    const started = performance.now();
    const input = normalizeUtterance(utterance);
    const respond = (r: Omit<CommandResponse, 'id' | 'utterance' | 'durationMs'>): CommandResponse => ({
      id: randomUUID(),
      utterance,
      durationMs: Math.round(performance.now() - started),
      ...r,
    });

    if (!input) return respond({ intent: null, speech: phrases.empty(), ok: true });

    const ctx = this.#context(utterance, input);
    const resolution = this.deps.registry.resolve(input, ctx);

    if (resolution) {
      const { hook, params } = resolution;
      try {
        const result = await withTimeout(Promise.resolve(hook.run(params, ctx)), HOOK_TIMEOUT_MS);
        this.deps.log.info(`${hook.name} ← "${input}"`);
        return respond({ intent: hook.name, speech: result.speech, card: result.card, ok: result.ok ?? true });
      } catch (err) {
        this.deps.log.warn(`${hook.name} failed: ${(err as Error).message}`);
        return respond({ intent: hook.name, speech: phrases.failure(friendlyError(err)), ok: false });
      }
    }

    if (this.deps.brain) {
      try {
        const speech = await this.deps.brain.ask(input);
        return respond({ intent: 'brain', speech, ok: true });
      } catch (err) {
        this.deps.log.warn(`brain failed: ${(err as Error).message}`);
        return respond({ intent: 'brain', speech: phrases.failure(friendlyError(err)), ok: false });
      }
    }

    return respond({ intent: null, speech: phrases.unknown(), ok: false });
  }

  #context(utterance: string, input: string): HookContext {
    const { registry, config, log, fs, launcher } = this.deps;
    return { utterance, input, config, log, fs, launcher, hooks: () => registry.list() };
  }
}

const ERRNO_MESSAGES: Record<string, string> = {
  EACCES: 'Permission denied',
  EPERM: 'Permission denied',
  ENOENT: 'Not found',
  ENOSPC: 'The disk is full',
  EISDIR: "That's a folder",
  ENOTDIR: "That's not a folder",
  ENAMETOOLONG: 'That name is too long',
};

function friendlyError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code && ERRNO_MESSAGES[code]) return ERRNO_MESSAGES[code];
  const message = (err as Error)?.message ?? String(err);
  return message.split('\n')[0]!.slice(0, 160);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('That took too long')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
