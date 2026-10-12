import type { AppConfig } from '../config.js';
import type { FsSandbox } from '../services/fsSandbox.js';
import type { Launcher } from '../services/launcher.js';

/** Optional structured output rendered on the dashboard next to the spoken reply. */
export interface HookCard {
  title: string;
  /** A short list, e.g. directory entries or search hits. */
  items?: string[];
  /** Label/value pairs, e.g. network diagnostics. */
  fields?: Array<{ label: string; value: string }>;
  /** Free text, e.g. file contents. */
  body?: string;
  /** A URL the dashboard can link to. */
  link?: string;
}

export interface HookResult {
  /** What ARES says out loud. Keep it to one or two crisp sentences. */
  speech: string;
  card?: HookCard;
  /** Defaults to true. Set false when the action did not succeed. */
  ok?: boolean;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface HookContext {
  /** The raw transcript as received. */
  utterance: string;
  /** The transcript with wake word, politeness and punctuation stripped. */
  input: string;
  config: AppConfig;
  log: Logger;
  /** Sandboxed path resolution for filesystem work. */
  fs: FsSandbox;
  /** The only sanctioned way to open URLs, files and apps. */
  launcher: Launcher;
  /** Metadata for every registered hook (used by the help hook). */
  hooks: () => HookInfo[];
}

/** Parameters extracted from an utterance. Named regex groups land here. */
export type HookParams = Record<string, string | undefined>;

export interface Hook<P = HookParams> {
  /** Unique, dotted id, e.g. "fs.list". */
  name: string;
  /** Grouping shown on the dashboard, e.g. "Filesystem". */
  category: string;
  description: string;
  /** Example phrases. Shown on the dashboard and offered to the LLM fallback. */
  examples: string[];
  /** Higher priority hooks are tried first. Default 0. */
  priority?: number;
  /**
   * Parse the (normalized) utterance. Return parameters when this hook should
   * handle it, or null to let the next hook try.
   */
  match(input: string, ctx: HookContext): P | null;
  run(params: P, ctx: HookContext): Promise<HookResult> | HookResult;
}

export type HookInfo = Pick<Hook, 'name' | 'category' | 'description' | 'examples'>;

/** Identity helper that gives plugin authors type inference for params. */
export function defineHook<P = HookParams>(hook: Hook<P>): Hook<P> {
  return hook;
}
