import fs from 'node:fs/promises';

/**
 * One entry under "mcpServers". The format matches Claude Desktop and most MCP
 * docs, so server snippets can be pasted in; the ARES-only keys are optional.
 */
export interface ServerConfig {
  /** stdio servers: the program to run. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** Remote servers: Streamable HTTP endpoint. */
  url?: string;
  headers?: Record<string, string>;
  /** "oauth" (default for remote servers without an Authorization header) or "none". */
  auth?: 'oauth' | 'none';
  disabled?: boolean;
  /** Only offer these tools to the model (names as the server reports them). */
  includeTools?: string[];
  excludeTools?: string[];
  /** Tools that run without asking first; true for all. Read-only tools never ask. */
  autoApprove?: string[] | boolean;
  /** Only offer this server's tools when one of these words is spoken. */
  keywords?: string[];
}

export interface IntegrationsFile {
  mcpServers: Record<string, ServerConfig>;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,30}$/i;

/** Reads the integrations file. A missing file means no integrations. */
export async function loadIntegrations(file: string): Promise<IntegrationsFile> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { mcpServers: {} };
    throw err;
  }
  const parsed = JSON.parse(raw) as Partial<IntegrationsFile>;
  const servers = parsed.mcpServers ?? {};
  if (typeof servers !== 'object' || Array.isArray(servers)) throw new Error('"mcpServers" must be an object');

  for (const [name, server] of Object.entries(servers)) {
    if (!NAME_RE.test(name)) throw new Error(`Integration name "${name}" must be letters, digits, - or _ (max 31)`);
    if (!server.command && !server.url) throw new Error(`Integration "${name}" needs "command" or "url"`);
    if (server.command && server.url) throw new Error(`Integration "${name}" can't have both "command" and "url"`);
  }
  return { mcpServers: servers };
}

/**
 * Replaces ${VAR} with environment values so secrets stay in server/.env.
 * Unknown variables are reported rather than silently left blank.
 */
export function interpolate<T>(value: T, env: NodeJS.ProcessEnv, missing: Set<string>): T {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name: string) => {
      const v = env[name];
      if (v === undefined || v === '') missing.add(name);
      return v ?? '';
    }) as T;
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, env, missing)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, env, missing)])) as T;
  }
  return value;
}
