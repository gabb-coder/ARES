import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { phrases } from '../persona.js';
import type { IntegrationManager } from '../integrations/manager.js';
import type { AgentTool } from '../integrations/types.js';
import type { Agent, PendingAction } from '../services/agent.js';
import type { FsSandbox } from '../services/fsSandbox.js';
import type { AppDirectory } from '../services/appDirectory.js';
import type { Launcher } from '../services/launcher.js';
import type { Scheduler } from '../services/scheduler.js';
import type { SystemControl } from '../services/system.js';
import { normalizeUtterance } from './intent.js';
import type { HookRegistry } from './registry.js';
import type { HookCard, HookContext, Logger } from './types.js';

export const MAX_UTTERANCE_CHARS = 500;

const CONFIRM_RE = /^(?:yes|yeah|yep|yup|confirm(?:ed)?|do it|go ahead|send it|proceed|approve(?:d)?|ok(?:ay)?|sure|affirmative)(?: please| thanks)?$/i;
const CANCEL_RE = /^(?:no|nope|cancel|stop|don't|do not|never ?mind|abort|forget it|negative)(?: (?:it|that))?$/i;
const HOOK_TIMEOUT_MS = 15_000;

export interface CommandResponse {
  id: string;
  utterance: string;
  /** Hook that handled the command, "agent" for the LLM agent, or null. */
  intent: string | null;
  speech: string;
  card?: HookCard;
  ok: boolean;
  durationMs: number;
  /** An agent action waiting for the user's confirmation. */
  pending?: PendingAction;
}

export interface AssistantDeps {
  registry: HookRegistry;
  agent: Agent | null;
  integrations: IntegrationManager | null;
  /** ARES's built-in agent tools (files, URLs, reminders). */
  localTools: AgentTool[];
  config: AppConfig;
  log: Logger;
  fs: FsSandbox;
  launcher: Launcher;
  system: SystemControl;
  apps: AppDirectory;
  scheduler: Scheduler;
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

    // A spoken yes/no answers an action the agent is holding for confirmation.
    const pending = this.deps.agent?.pending();
    if (pending && (CONFIRM_RE.test(input) || CANCEL_RE.test(input))) {
      const reply = await this.deps.agent!.resolve(pending.id, CONFIRM_RE.test(input));
      return respond({ intent: 'agent.confirm', speech: reply.speech, card: reply.card, ok: reply.ok, pending: reply.pending });
    }

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

    const { agent } = this.deps;
    if (agent) {
      try {
        const reply = await agent.ask(input, this.#toolsFor(input));
        return respond({ intent: 'agent', speech: reply.speech, card: reply.card, ok: reply.ok, pending: reply.pending });
      } catch (err) {
        this.deps.log.warn(`agent failed: ${(err as Error).message}`);
        return respond({ intent: 'agent', speech: phrases.failure(friendlyError(err)), ok: false });
      }
    }

    return respond({ intent: null, speech: phrases.unknown(), ok: false });
  }

  /** Answers a pending confirmation from the dashboard's buttons. */
  async resolvePending(id: string, approve: boolean): Promise<CommandResponse> {
    const started = performance.now();
    const reply = this.deps.agent
      ? await this.deps.agent.resolve(id, approve).catch((err: Error) => ({ ok: false, speech: phrases.failure(friendlyError(err)) }))
      : { ok: false, speech: 'Nothing is waiting for confirmation.' };
    return {
      id: randomUUID(),
      utterance: approve ? 'Confirm' : 'Cancel',
      intent: 'agent.confirm',
      durationMs: Math.round(performance.now() - started),
      ...reply,
    };
  }

  #toolsFor(input: string): AgentTool[] {
    const { localTools, integrations, config } = this.deps;
    const remaining = config.brain.maxTools - localTools.length;
    return [...localTools, ...(integrations?.tools(input, remaining) ?? [])];
  }

  #context(utterance: string, input: string): HookContext {
    const { registry, config, log, fs, launcher, system, apps, scheduler } = this.deps;
    return { utterance, input, config, log, fs, launcher, system, apps, scheduler, hooks: () => registry.list() };
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
