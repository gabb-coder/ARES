import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { EventBus, IntegrationStatus } from '../core/events.js';
import type { Logger } from '../core/types.js';
import { interpolate, loadIntegrations, type ServerConfig } from './config.js';
import { FileOAuthProvider } from './oauth.js';
import type { AgentTool, ToolOutput } from './types.js';

const CONNECT_TIMEOUT_MS = 60_000; // first `npx -y` run downloads the server
const CALL_TIMEOUT_MS = 60_000;
const MAX_RESULT_CHARS = 12_000;

/** Unannotated tools named like these are treated as read-only (no confirmation). */
const READ_ONLY_NAME = /^(?:get|list|search|read|fetch|find|query|describe|view|lookup|retrieve|show|count|check)[_-]/i;

export interface IntegrationOptions {
  file: string;
  dataDir: string;
  /** Where OAuth providers send the browser back: ARES's own callback route. */
  callbackUrl: string;
  bus: EventBus;
  log: Logger;
}

/**
 * Connects ARES to MCP servers (Gmail, Calendar, GitHub, Notion, Slack, …)
 * listed in integrations.json and exposes their tools to the agent.
 */
export class IntegrationManager {
  #connections = new Map<string, Connection>();
  #loadError: string | null = null;

  constructor(private readonly options: IntegrationOptions) {}

  /** Reads the config and starts connecting in the background. */
  async start(): Promise<void> {
    let servers: Record<string, ServerConfig>;
    try {
      servers = (await loadIntegrations(this.options.file)).mcpServers;
    } catch (err) {
      this.#loadError = `integrations.json: ${(err as Error).message}`;
      this.options.log.error(this.#loadError);
      return;
    }
    for (const [name, config] of Object.entries(servers)) {
      const connection = new Connection(name, config, this.options, () => this.#changed());
      this.#connections.set(name, connection);
      if (!config.disabled) void connection.connect();
    }
    this.#changed();
  }

  get configured(): number {
    return this.#connections.size;
  }

  get loadError(): string | null {
    return this.#loadError;
  }

  status(): IntegrationStatus[] {
    return [...this.#connections.values()].map((c) => c.status());
  }

  /**
   * Tools to offer for this utterance: servers whose keywords (or name) were
   * spoken come first, then servers without keywords, up to `limit`.
   */
  tools(input: string, limit: number): AgentTool[] {
    const spoken = input.toLowerCase();
    // Whole words, allowing plurals: "ticket" matches "tickets".
    const mentioned = (words: string[]) =>
      words.some((w) => new RegExp(`\\b${escapeRegex(w.toLowerCase())}(?:s|es)?\\b`).test(spoken));
    const ready = [...this.#connections.values()].filter((c) => c.state === 'connected');

    const preferred = ready.filter((c) => mentioned([c.name, ...(c.config.keywords ?? [])]));
    const general = ready.filter((c) => !preferred.includes(c) && !c.config.keywords?.length);
    return [...preferred, ...general].flatMap((c) => c.agentTools()).slice(0, Math.max(0, limit));
  }

  /** Completes a browser sign-in; returns the integration's name. */
  async completeOAuth(state: string, code: string): Promise<string> {
    const name = state.split('.')[0] ?? '';
    const connection = this.#connections.get(name);
    if (!connection) throw new Error('Unknown sign-in');
    await connection.finishAuth(state, code);
    return name;
  }

  async reconnect(name: string): Promise<void> {
    const connection = this.#connections.get(name);
    if (!connection) throw new Error(`No integration named ${name}`);
    await connection.close();
    await connection.connect();
  }

  async close(): Promise<void> {
    await Promise.all([...this.#connections.values()].map((c) => c.close()));
  }

  #changed() {
    this.options.bus.emit({ type: 'integrations', servers: this.status() });
  }
}

class Connection {
  state: IntegrationStatus['state'] = 'disabled';
  #client: Client | null = null;
  #transport: StdioClientTransport | StreamableHTTPClientTransport | null = null;
  #oauth: FileOAuthProvider | null = null;
  #tools: Tool[] = [];
  #error: string | undefined;
  #authUrl: string | undefined;
  #stderr: string[] = [];

  constructor(
    readonly name: string,
    readonly config: ServerConfig,
    private readonly options: IntegrationOptions,
    private readonly onChange: () => void,
  ) {}

  status(): IntegrationStatus {
    return {
      name: this.name,
      state: this.state,
      tools: this.#tools.length,
      ...(this.#error ? { error: this.#error } : {}),
      ...(this.state === 'needs-auth' && this.#authUrl ? { authUrl: this.#authUrl } : {}),
    };
  }

  async connect(): Promise<void> {
    this.#set('connecting');
    const missing = new Set<string>();
    const config = interpolate(this.config, process.env, missing);
    if (missing.size) {
      this.#set('error', `Set ${[...missing].join(', ')} in server/.env`);
      return;
    }

    const client = new Client({ name: 'ares', version: '1.0.0' });
    this.#client = client;
    this.#transport = this.#createTransport(config);
    try {
      await withTimeout(client.connect(this.#transport), CONNECT_TIMEOUT_MS, 'Timed out connecting');
      this.#tools = await this.#listTools(client);
      this.#set('connected');
      this.options.log.info(`integration ${this.name}: ${this.#tools.length} tools`);
      client.onclose = () => {
        if (this.state === 'connected') this.#set('error', 'Disconnected');
      };
    } catch (err) {
      if (err instanceof UnauthorizedError || this.#authUrl) {
        this.#set('needs-auth', this.#authUrl ? undefined : 'Sign-in required');
        return;
      }
      const detail = this.#stderr.at(-1) ?? (err as Error).message;
      this.options.log.warn(`integration ${this.name} failed: ${detail}`);
      this.#set('error', detail.slice(0, 200));
    }
  }

  async finishAuth(state: string, code: string): Promise<void> {
    if (!this.#oauth || !(this.#transport instanceof StreamableHTTPClientTransport)) throw new Error('No sign-in in progress');
    if ((await this.#oauth.expectedState()) !== state) throw new Error('Sign-in state mismatch');
    await this.#transport.finishAuth(code);
    this.#authUrl = undefined;
    await this.close();
    await this.connect();
  }

  agentTools(): AgentTool[] {
    const used = new Set<string>();
    return this.#tools.map((tool) => {
      let name = apiName(`${this.name}_${tool.name}`);
      for (let i = 2; used.has(name); i++) name = apiName(`${this.name}_${tool.name}`).slice(0, 60) + `_${i}`;
      used.add(name);
      return {
        name,
        title: `${this.name} · ${tool.name}`,
        description: (tool.description ?? tool.title ?? tool.name).slice(0, 1024),
        inputSchema: { type: 'object', properties: {}, ...(tool.inputSchema as Record<string, unknown>) },
        requiresConfirmation: needsConfirmation(tool, this.config.autoApprove),
        source: this.name,
        call: (args) => this.#call(tool.name, args),
      };
    });
  }

  async close(): Promise<void> {
    const client = this.#client;
    this.#client = null;
    if (client) {
      client.onclose = undefined;
      await client.close().catch(() => {});
    }
    if (this.state === 'connected') this.#set('disabled');
  }

  #createTransport(config: ServerConfig) {
    if (config.command) {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: { ...getDefaultEnvironment(), ...(config.env ?? {}) },
        cwd: config.cwd,
        stderr: 'pipe',
      });
      // Keep the server's last stderr lines: they explain most startup failures.
      transport.stderr?.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').map((l) => l.trim()).filter(Boolean);
        this.#stderr = [...this.#stderr, ...lines].slice(-5);
      });
      return transport;
    }

    const headers = config.headers ?? {};
    const hasAuthHeader = Object.keys(headers).some((h) => h.toLowerCase() === 'authorization');
    const useOAuth = config.auth === 'oauth' || (config.auth !== 'none' && !hasAuthHeader);
    if (useOAuth) {
      this.#oauth ??= new FileOAuthProvider(this.name, this.options.dataDir, this.options.callbackUrl, (url) => {
        this.#authUrl = url.toString();
      });
    }
    return new StreamableHTTPClientTransport(new URL(config.url!), {
      authProvider: useOAuth ? this.#oauth! : undefined,
      requestInit: { headers },
    });
  }

  async #listTools(client: Client): Promise<Tool[]> {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor && tools.length < 1000);

    const { includeTools, excludeTools } = this.config;
    return tools.filter((t) => (!includeTools || includeTools.includes(t.name)) && !excludeTools?.includes(t.name));
  }

  async #call(tool: string, args: Record<string, unknown>): Promise<ToolOutput> {
    if (!this.#client || this.state !== 'connected') return { text: `${this.name} is not connected`, isError: true };
    try {
      const result = await this.#client.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
      return { text: resultText(result), isError: Boolean(result.isError) };
    } catch (err) {
      return { text: `Tool failed: ${(err as Error).message}`, isError: true };
    }
  }

  #set(state: IntegrationStatus['state'], error?: string) {
    this.state = state;
    this.#error = error;
    this.onChange();
  }
}

export function needsConfirmation(tool: Tool, autoApprove: ServerConfig['autoApprove']): boolean {
  if (autoApprove === true || (Array.isArray(autoApprove) && autoApprove.includes(tool.name))) return false;
  const hints = tool.annotations;
  if (hints?.destructiveHint === true) return true;
  if (hints?.readOnlyHint !== undefined) return !hints.readOnlyHint;
  return !READ_ONLY_NAME.test(tool.name);
}

/** Flattens MCP content blocks into text for the model, capped in size. */
function resultText(result: Record<string, unknown>): string {
  // Servers on the 2024-10 protocol return { toolResult } instead of content blocks.
  if (!('content' in result) && 'toolResult' in result) return JSON.stringify(result.toolResult).slice(0, MAX_RESULT_CHARS);
  const blocks = Array.isArray(result.content) ? (result.content as Array<Record<string, unknown>>) : [];
  const parts = blocks.map((b) => {
    if (b.type === 'text') return String(b.text ?? '');
    if (b.type === 'resource') {
      const resource = b.resource as { text?: string; uri?: string } | undefined;
      return resource?.text ?? `[resource ${resource?.uri ?? ''}]`;
    }
    if (b.type === 'resource_link') return `[link ${String(b.uri ?? '')}]`;
    return `[${String(b.type)} omitted]`;
  });
  let text = parts.join('\n').trim();
  if (!text && result.structuredContent) text = JSON.stringify(result.structuredContent);
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n…[truncated]` : text || '(no output)';
}

function apiName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
