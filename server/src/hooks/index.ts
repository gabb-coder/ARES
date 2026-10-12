import type { AnyHook } from '../core/registry.js';
import { appHooks } from './apps.js';
import { aresHooks } from './ares.js';
import { filesystemHooks } from './filesystem.js';
import { networkHooks } from './network.js';
import { systemHooks } from './system.js';
import { webHooks } from './web.js';

/**
 * Built-in hooks. Order matters only between hooks of equal priority: the
 * first registered wins. Drop-in plugins in server/plugins/ load after these.
 */
export const builtinHooks: AnyHook[] = [
  ...aresHooks,
  ...systemHooks,
  ...filesystemHooks,
  ...networkHooks,
  ...appHooks,
  ...webHooks,
];
