import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AnyHook, HookRegistry } from './registry.js';
import type { Logger } from './types.js';

const PLUGIN_EXT = /\.(?:ts|mts|js|mjs)$/;

/**
 * Loads every plugin module in `dir`. A plugin's default export (or named
 * `hooks` export) may be a hook or an array of hooks. A broken plugin is
 * logged and skipped; it never takes the server down.
 */
export async function loadPlugins(dir: string, registry: HookRegistry, log: Logger): Promise<string[]> {
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const loaded: string[] = [];

  for (const file of files.sort()) {
    if (!PLUGIN_EXT.test(file) || file.endsWith('.d.ts') || file.startsWith('_')) continue;
    try {
      const mod = (await import(pathToFileURL(path.join(dir, file)).href)) as {
        default?: AnyHook | AnyHook[];
        hooks?: AnyHook[];
      };
      const exported = mod.default ?? mod.hooks;
      const hooks = Array.isArray(exported) ? exported : exported ? [exported] : [];
      if (hooks.length === 0) {
        log.warn(`plugin ${file}: no default or "hooks" export, skipped`);
        continue;
      }
      registry.register(...hooks);
      loaded.push(...hooks.map((h) => h.name));
      log.info(`plugin ${file}: ${hooks.map((h) => h.name).join(', ')}`);
    } catch (err) {
      log.error(`plugin ${file} failed to load: ${(err as Error).message}`);
    }
  }
  return loaded;
}
