import { defineHook } from '../core/types.js';

const LAUNCH_RE = /^(?:open|launch|start|run|fire up|bring up)(?: up)?(?: the| my)? (?<app>.+?)(?: app| application| program)?$/i;

/**
 * Launches desktop apps from an explicit allowlist (ARES_APPS). Anything not on
 * the list falls through to the next hook, so "open YouTube" still reaches the
 * browser hook.
 */
export const launchAppHook = defineHook<{ name: string; argv: string[] }>({
  name: 'app.launch',
  category: 'Apps',
  description: 'Launch an allowlisted desktop app',
  examples: ['Open calculator', 'Launch terminal'],
  priority: 10,
  match: (input, ctx) => {
    const name = LAUNCH_RE.exec(input)?.groups?.app?.toLowerCase();
    const argv = name ? ctx.config.apps[name] : undefined;
    return name && argv ? { name, argv } : null;
  },
  run: async ({ name, argv }, ctx) => {
    await ctx.launcher.spawnDetached(argv);
    return { speech: `Launching ${name}.`, card: { title: 'Launched', items: [argv.join(' ')] } };
  },
});

export const appHooks = [launchAppHook];
