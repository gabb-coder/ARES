import { patterns } from '../core/intent.js';
import { defineHook, type HookContext } from '../core/types.js';
import type { AppTarget } from '../services/appDirectory.js';

const LAUNCH_RE = /^(?:open|launch|start|run|fire up|bring up)(?: up)?(?: the| my)? (?<app>.+?)(?: app| application| program)?$/i;
const QUIT_RE = /^(?:quit|close|exit|kill|shut down)(?: the| my)? (?<app>.+?)(?: app| application| program)?$/i;
const FOCUS_RE = /^(?:switch to|go to|go back to|focus(?: on)?|show me|bring)(?: the| my)? (?<app>.+?)(?: app| window)?(?: to the front)?$/i;

/** Matches only when the spoken name is a known app, so "open YouTube" falls through to the web hook. */
function appMatcher(re: RegExp, filter: (t: AppTarget) => boolean = () => true) {
  return (input: string, ctx: HookContext) => {
    const spoken = re.exec(input)?.groups?.app;
    const target = spoken ? ctx.apps.resolve(spoken) : null;
    return target && filter(target) ? { target } : null;
  };
}

export const launchAppHook = defineHook<{ target: AppTarget }>({
  name: 'app.launch',
  category: 'Apps',
  description: 'Open an app by name (any installed app on macOS)',
  examples: ['Open calculator', 'Launch Spotify'],
  priority: 10,
  match: appMatcher(LAUNCH_RE),
  run: async ({ target }, ctx) => {
    if (target.kind === 'app') await ctx.system.openApp(target.name);
    else await ctx.launcher.spawnDetached(target.argv);
    return { speech: `Opening ${target.name}.` };
  },
});

export const quitAppHook = defineHook<{ target: AppTarget }>({
  name: 'app.quit',
  category: 'Apps',
  description: 'Quit an app',
  examples: ['Quit Safari'],
  priority: 10,
  match: appMatcher(QUIT_RE, (t) => t.kind === 'app'),
  run: async ({ target }, ctx) => {
    const quit = await ctx.system.quitApp(target.name);
    return quit ? { speech: `${target.name} closed.` } : { ok: false, speech: `${target.name} isn't running.` };
  },
});

export const focusAppHook = defineHook<{ target: AppTarget }>({
  name: 'app.focus',
  category: 'Apps',
  description: 'Bring an app to the front',
  examples: ['Switch to Slack'],
  priority: 10,
  match: appMatcher(FOCUS_RE, (t) => t.kind === 'app'),
  run: async ({ target }, ctx) => {
    await ctx.system.focusApp(target.name);
    return { speech: `${target.name}.` };
  },
});

export const runningAppsHook = defineHook({
  name: 'app.running',
  category: 'Apps',
  description: 'List open apps',
  examples: ['What apps are open?'],
  match: patterns(
    /^(?:what|which) apps(?: do I have)? (?:are )?(?:open|running)$/i,
    /^(?:list|show)(?: me)?(?: the| my)? (?:open|running) (?:apps|applications)$/i,
  ),
  run: async (_params, ctx) => {
    const apps = await ctx.system.runningApps();
    if (apps.length === 0) return { speech: 'No apps are open.' };
    const spoken = apps.length <= 5 ? apps.join(', ') : `${apps.slice(0, 5).join(', ')} and ${apps.length - 5} more`;
    return { speech: `${apps.length} open: ${spoken}.`, card: { title: 'Open apps', items: apps } };
  },
});

export const appHooks = [launchAppHook, quitAppHook, focusAppHook, runningAppsHook];
