import type { AnyHook } from '../core/registry.js';
import { appHooks } from './apps.js';
import { aresHooks } from './ares.js';
import { desktopHooks } from './desktop.js';
import { filesystemHooks } from './filesystem.js';
import { mathHooks } from './math.js';
import { mediaHooks } from './media.js';
import { networkHooks } from './network.js';
import { systemHooks } from './system.js';
import { timerHooks } from './timers.js';
import { weatherHooks } from './weather.js';
import { webHooks } from './web.js';

/**
 * Built-in hooks. Order matters only between hooks of equal priority: the
 * first registered wins. Drop-in plugins in server/plugins/ load after these.
 */
export const builtinHooks: AnyHook[] = [
  ...aresHooks,
  ...systemHooks,
  ...timerHooks,
  ...weatherHooks,
  ...mathHooks,
  ...filesystemHooks,
  ...networkHooks,
  ...mediaHooks,
  ...appHooks,
  ...desktopHooks,
  ...webHooks,
];
