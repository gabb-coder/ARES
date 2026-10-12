import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../config.js';
import type { HookCard, HookInfo, Logger } from '../core/types.js';
import type { AgentTool, ToolOutput } from '../integrations/types.js';
import { systemPrompt, toSpeech } from '../persona.js';

/**
 * The conversational layer behind the hooks. Handles anything no hook
 * matched: answers questions in the ARES persona and, with tools, works with
 * local files and connected apps (MCP integrations).
 *
 * ARES_BRAIN=none (default) keeps ARES fully offline and rule-based.
 */

const MAX_STEPS = 8;
const PENDING_TTL_MS = 3 * 60_000;

export interface PendingAction {
  id: string;
  /** e.g. "gmail · send_email" */
  title: string;
  summary: string;
  args: Record<string, unknown>;
  expiresAt: number;
}

export interface AgentReply {
  speech: string;
  ok: boolean;
  card?: HookCard;
  pending?: PendingAction;
}

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface Step<M> {
  text: string;
  calls: ToolCall[];
  /** The assistant message to append, exactly as the provider returned it. */
  assistant: M;
  refused: boolean;
}

interface Turn {
  user: string;
  assistant: string;
}

/** Provider-specific message plumbing; the tool loop itself is shared. */
interface Adapter<M> {
  readonly provider: string;
  readonly model: string;
  start(history: readonly Turn[], userText: string): M[];
  step(messages: M[], tools: AgentTool[]): Promise<Step<M>>;
  results(items: Array<{ call: ToolCall; output: ToolOutput }>): M[];
}

interface Task<M> {
  userText: string;
  messages: M[];
  tools: AgentTool[];
  queue: ToolCall[];
  done: Array<{ call: ToolCall; output: ToolOutput }>;
  approved: Set<string>;
  used: string[];
  steps: number;
  lastText: string;
}

export class Agent {
  #history: Turn[] = [];
  #pending: { action: PendingAction; task: Task<unknown> } | null = null;

  constructor(
    private readonly adapter: Adapter<unknown>,
    private readonly historyTurns: number,
    private readonly log: Logger,
  ) {}

  get provider() {
    return this.adapter.provider;
  }

  get model() {
    return this.adapter.model;
  }

  /** The action waiting for the user's yes/no, if it hasn't expired. */
  pending(): PendingAction | null {
    if (this.#pending && this.#pending.action.expiresAt < Date.now()) this.#pending = null;
    return this.#pending?.action ?? null;
  }

  async ask(text: string, tools: AgentTool[]): Promise<AgentReply> {
    this.#pending = null; // a new request supersedes an unanswered confirmation
    const task: Task<unknown> = {
      userText: text,
      messages: this.adapter.start(this.#history, `[${now()}] ${text}`),
      tools,
      queue: [],
      done: [],
      approved: new Set(),
      used: [],
      steps: 0,
      lastText: '',
    };
    return this.#drive(task);
  }

  async resolve(id: string, approve: boolean): Promise<AgentReply> {
    const pending = this.pending();
    if (!pending || pending.id !== id) return { ok: false, speech: 'Nothing is waiting for confirmation.' };
    const { task } = this.#pending!;
    this.#pending = null;
    if (!approve) return { ok: true, speech: 'Cancelled.' };
    task.approved.add(task.queue[0]!.id);
    return this.#drive(task);
  }

  async #drive(task: Task<unknown>): Promise<AgentReply> {
    for (;;) {
      // Run the tool calls from the last model turn, pausing for confirmation.
      while (task.queue.length) {
        const call = task.queue[0]!;
        const tool = task.tools.find((t) => t.name === call.name);
        if (tool?.requiresConfirmation && !task.approved.has(call.id)) return this.#askToConfirm(task, tool, call);
        task.queue.shift();
        const output: ToolOutput = tool
          ? await tool.call(call.args).catch((err: Error) => ({ text: err.message, isError: true }))
          : { text: `Unknown tool ${call.name}`, isError: true };
        if (tool) task.used.push(`${tool.title}${output.isError ? ' ✗' : ''}`);
        this.log.info(`agent tool ${call.name}${output.isError ? ' (error)' : ''}`);
        task.done.push({ call, output });
      }
      if (task.done.length) {
        task.messages.push(...this.adapter.results(task.done));
        task.done = [];
      }

      if (task.steps >= MAX_STEPS) return { ok: false, speech: 'That needs more steps than I allow. Try a narrower request.' };
      task.steps++;
      const step = await this.adapter.step(task.messages, task.tools);
      task.messages.push(step.assistant);

      if (step.refused) return { ok: false, speech: "I can't help with that one." };
      if (step.calls.length === 0) return this.#finish(task, step.text);
      task.lastText = step.text;
      task.queue = [...step.calls];
    }
  }

  #finish(task: Task<unknown>, text: string): AgentReply {
    const speech = toSpeech(text) || 'Done.';
    this.#history.push({ user: task.userText, assistant: speech });
    if (this.#history.length > this.historyTurns) this.#history.splice(0, this.#history.length - this.historyTurns);

    // Speech drops links, lists and anything long; keep the full reply on screen
    // (e.g. a sign-in link an integration asked the user to open).
    const full = text.trim();
    const link = /https?:\/\/[^\s)>\]]+/.exec(full)?.[0];
    const showFull = full && full !== speech;
    if (!task.used.length && !showFull) return { ok: true, speech };
    const card: HookCard = {
      title: task.used.length ? 'Tools used' : 'Full reply',
      ...(task.used.length ? { items: task.used } : {}),
      ...(showFull ? { body: full } : {}),
      ...(link ? { link } : {}),
    };
    return { ok: true, speech, card };
  }

  #askToConfirm(task: Task<unknown>, tool: AgentTool, call: ToolCall): AgentReply {
    const action: PendingAction = {
      id: randomUUID(),
      title: tool.title,
      summary: describeCall(tool, call.args),
      args: call.args,
      expiresAt: Date.now() + PENDING_TTL_MS,
    };
    this.#pending = { action, task };
    const preface = toSpeech(task.lastText, 200);
    return {
      ok: true,
      speech: `${preface || `Ready to ${action.summary}.`} Confirm?`,
      pending: action,
      card: {
        title: `Confirm · ${tool.title}`,
        fields: Object.entries(call.args).map(([label, value]) => ({ label, value: preview(value, 300) })),
      },
    };
  }
}

/** "send email to sam@example.com, subject Lunch" from a tool name and its args. */
function describeCall(tool: AgentTool, args: Record<string, unknown>): string {
  const action = tool.title.split(' · ').pop()!.replace(/[_-]+/g, ' ').trim();
  const details = Object.entries(args)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .slice(0, 2)
    .map(([k, v]) => `${k.replace(/[_-]+/g, ' ')} ${preview(v, 60)}`);
  return details.length ? `${action}: ${details.join(', ')}` : action;
}

function preview(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function now(): string {
  return new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function createAgent(config: AppConfig, hooks: HookInfo[], log: Logger): Agent | null {
  const { brain } = config;
  const system = systemPrompt(hooks);
  if (brain.provider === 'ollama') {
    const { url, model, think } = brain.ollama;
    return new Agent(new OllamaAdapter(url, model, think, brain.ollamaContext, system, log), brain.historyTurns, log);
  }
  if (brain.provider === 'anthropic') return new Agent(new AnthropicAdapter(brain.anthropic.model, system), brain.historyTurns, log);
  return null;
}

// --- Ollama (local, free) ------------------------------------------------------

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> | string } }>;
  tool_name?: string;
}

class OllamaAdapter implements Adapter<OllamaMessage> {
  readonly provider = 'ollama';
  #toolsUnsupported = false;
  #callCount = 0;

  constructor(
    private readonly url: string,
    readonly model: string,
    private readonly think: boolean | null,
    private readonly contextWindow: number,
    private readonly system: string,
    private readonly log: Logger,
  ) {}

  start(history: readonly Turn[], userText: string): OllamaMessage[] {
    return [
      { role: 'system', content: this.system },
      ...history.flatMap((t): OllamaMessage[] => [
        { role: 'user', content: t.user },
        { role: 'assistant', content: t.assistant },
      ]),
      { role: 'user', content: userText },
    ];
  }

  async step(messages: OllamaMessage[], tools: AgentTool[]): Promise<Step<OllamaMessage>> {
    const offerTools = tools.length > 0 && !this.#toolsUnsupported;
    let data: { message?: OllamaMessage };
    try {
      data = await this.#chat(messages, offerTools ? tools : []);
    } catch (err) {
      // Models without tool support reject the request; answer without tools instead.
      if (offerTools && /does not support tools/i.test((err as Error).message)) {
        this.log.warn(`${this.model} has no tool support; integrations are unavailable with it`);
        this.#toolsUnsupported = true;
        data = await this.#chat(messages, []);
      } else throw err;
    }

    const message = data.message ?? { role: 'assistant', content: '' };
    const calls = (message.tool_calls ?? []).map((c, i) => ({
      id: `call_${++this.#callCount}_${i}`,
      name: c.function.name,
      args: typeof c.function.arguments === 'string' ? safeJson(c.function.arguments) : (c.function.arguments ?? {}),
    }));
    return {
      text: stripThinkTags(message.content ?? ''),
      calls,
      assistant: { role: 'assistant', content: message.content ?? '', ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) },
      refused: false,
    };
  }

  results(items: Array<{ call: ToolCall; output: ToolOutput }>): OllamaMessage[] {
    return items.map(({ call, output }) => ({
      role: 'tool',
      tool_name: call.name,
      content: output.isError ? `Error: ${output.text}` : output.text,
    }));
  }

  async #chat(messages: OllamaMessage[], tools: AgentTool[]) {
    let res: Response;
    try {
      res = await fetch(`${this.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          options: { num_ctx: this.contextWindow },
          ...(this.think === null ? {} : { think: this.think }),
          ...(tools.length
            ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }
            : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new Error(`Ollama isn't reachable at ${this.url}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (res.status === 404 && /not found/i.test(detail)) throw new Error(`Model ${this.model} isn't installed. Run: ollama pull ${this.model}`);
      throw new Error(`Ollama returned ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
    }
    return (await res.json()) as { message?: OllamaMessage };
  }
}

/** Some local reasoning models wrap their scratchpad in <think> tags. */
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// --- Anthropic (optional, paid) -----------------------------------------------

type ClaudeMessage = Anthropic.Beta.BetaMessageParam;

class AnthropicAdapter implements Adapter<ClaudeMessage> {
  readonly provider = 'anthropic';
  readonly #client = new Anthropic();

  constructor(
    readonly model: string,
    private readonly system: string,
  ) {}

  start(history: readonly Turn[], userText: string): ClaudeMessage[] {
    // History keeps reply text only, so no thinking blocks are ever replayed
    // across requests and the window can slide freely. Within one request the
    // tool loop appends assistant turns unchanged, as the API requires.
    return [
      ...history.flatMap((t): ClaudeMessage[] => [
        { role: 'user', content: t.user },
        { role: 'assistant', content: t.assistant },
      ]),
      { role: 'user', content: userText },
    ];
  }

  async step(messages: ClaudeMessage[], tools: AgentTool[]): Promise<Step<ClaudeMessage>> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.#client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: this.system,
        messages,
        ...(tools.length
          ? {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema as Anthropic.Beta.BetaTool['input_schema'],
              })),
            }
          : {}),
        // Spoken answers favour speed; tool work gets a little more depth.
        output_config: { effort: tools.length ? 'medium' : 'low' },
        // Retry on Anthropic's recommended model if a safety classifier declines.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (err) {
      throw new Error(describeAnthropicError(err));
    }

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ');
    // A turn cut off by max_tokens may hold a partial tool call; don't run it.
    const calls =
      response.stop_reason === 'tool_use'
        ? response.content
            .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
            .map((b) => ({ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> }))
        : [];
    return {
      text,
      calls,
      assistant: { role: 'assistant', content: response.content },
      refused: response.stop_reason === 'refusal',
    };
  }

  results(items: Array<{ call: ToolCall; output: ToolOutput }>): ClaudeMessage[] {
    return [
      {
        role: 'user',
        content: items.map(({ call, output }) => ({
          type: 'tool_result' as const,
          tool_use_id: call.id,
          content: output.text,
          ...(output.isError ? { is_error: true } : {}),
        })),
      },
    ];
  }
}

function describeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key lacks access to that model';
  if (err instanceof Anthropic.NotFoundError) return 'That Anthropic model was not found';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by Anthropic. Try again shortly';
  if (err instanceof Anthropic.APIConnectionError) return "Can't reach the Anthropic API";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ''}`.trim();
  return (err as Error)?.message ?? 'Unknown error';
}
