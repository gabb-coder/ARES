import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../config.js';
import type { HookInfo, Logger } from '../core/types.js';
import { systemPrompt, toSpeech } from '../persona.js';

/**
 * Optional conversational fallback for utterances no hook matched.
 * ARES_BRAIN=none (default) keeps ARES fully offline and rule-based.
 */
export interface Brain {
  readonly provider: string;
  readonly model: string;
  ask(text: string): Promise<string>;
}

interface Turn {
  user: string;
  assistant: string;
}

/** Keeps the last N exchanges so follow-ups ("and tomorrow?") have context. */
class History {
  #turns: Turn[] = [];
  constructor(private readonly limit: number) {}

  get turns(): readonly Turn[] {
    return this.#turns;
  }

  push(turn: Turn): void {
    this.#turns.push(turn);
    if (this.#turns.length > this.limit) this.#turns.splice(0, this.#turns.length - this.limit);
  }
}

export function createBrain(config: AppConfig, hooks: HookInfo[], log: Logger): Brain | null {
  const { brain } = config;
  const system = systemPrompt(hooks);
  switch (brain.provider) {
    case 'ollama':
      return new OllamaBrain(brain.ollama.url, brain.ollama.model, system, brain.historyTurns);
    case 'anthropic':
      return new AnthropicBrain(brain.anthropic.model, system, brain.historyTurns, log);
    default:
      return null;
  }
}

/** Local and free: any model served by Ollama (https://ollama.com). */
class OllamaBrain implements Brain {
  readonly provider = 'ollama';
  readonly #history: History;

  constructor(
    private readonly url: string,
    readonly model: string,
    private readonly system: string,
    historyTurns: number,
  ) {
    this.#history = new History(historyTurns);
  }

  async ask(text: string): Promise<string> {
    const messages = [
      { role: 'system', content: this.system },
      ...this.#history.turns.flatMap((t) => [
        { role: 'user', content: t.user },
        { role: 'assistant', content: t.assistant },
      ]),
      { role: 'user', content: text },
    ];

    let res: Response;
    try {
      res = await fetch(`${this.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, messages, stream: false }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new Error(`Ollama isn't reachable at ${this.url}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Ollama returned ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`);
    }

    const data = (await res.json()) as { message?: { content?: string } };
    const reply = toSpeech(stripThinkTags(data.message?.content ?? ''));
    if (!reply) throw new Error('Ollama returned an empty reply');
    this.#history.push({ user: text, assistant: reply });
    return reply;
  }
}

/** Some local reasoning models wrap their scratchpad in <think> tags. */
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Optional cloud brain via the Anthropic API. Reads ANTHROPIC_API_KEY (or any
 * credential the SDK resolves) from the environment.
 */
class AnthropicBrain implements Brain {
  readonly provider = 'anthropic';
  readonly #client = new Anthropic();
  readonly #history: History;

  constructor(
    readonly model: string,
    private readonly system: string,
    historyTurns: number,
    private readonly log: Logger,
  ) {
    this.#history = new History(historyTurns);
  }

  async ask(text: string): Promise<string> {
    // History stores reply text only. Voice turns are short, and replaying no
    // thinking blocks lets the window slide without breaking thinking-block
    // validation on later requests.
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...this.#history.turns.flatMap((t): Anthropic.Beta.BetaMessageParam[] => [
        { role: 'user', content: t.user },
        { role: 'assistant', content: t.assistant },
      ]),
      { role: 'user', content: text },
    ];

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.#client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: this.system,
        messages,
        // Spoken answers need speed more than depth.
        output_config: { effort: 'low' },
        // Retry on Anthropic's recommended model if a safety classifier declines.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (err) {
      throw new Error(describeAnthropicError(err));
    }

    if (response.stop_reason === 'refusal') {
      this.log.warn(`anthropic refusal (${response.stop_details?.category ?? 'uncategorized'})`);
      return "I can't help with that one.";
    }

    const reply = toSpeech(
      response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(' '),
    );
    if (!reply) throw new Error('The model returned an empty reply');
    this.#history.push({ user: text, assistant: reply });
    return reply;
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
