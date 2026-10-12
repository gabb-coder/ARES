import type { AppConfig } from './config.js';
import { Assistant } from './core/assistant.js';
import { loadPlugins } from './core/loader.js';
import { HookRegistry } from './core/registry.js';
import type { Logger } from './core/types.js';
import { builtinHooks } from './hooks/index.js';
import { createBrain, type Brain } from './services/brain.js';
import { FsSandbox } from './services/fsSandbox.js';
import { createLauncher, type Launcher } from './services/launcher.js';
import { createStt, type SttService } from './services/stt.js';
import { createTts, type TtsService } from './services/tts.js';

export interface Runtime {
  config: AppConfig;
  log: Logger;
  registry: HookRegistry;
  assistant: Assistant;
  brain: Brain | null;
  tts: TtsService;
  stt: SttService;
  fs: FsSandbox;
  launcher: Launcher;
}

export interface RuntimeOptions {
  /** Load drop-in plugins from config.pluginDir. Default true. */
  plugins?: boolean;
  /** Replace the launcher, e.g. with a recorder in tests. */
  launcher?: Launcher;
}

/** Wires every service together. Shared by the server entry point and tests. */
export async function createRuntime(config: AppConfig, log: Logger, options: RuntimeOptions = {}): Promise<Runtime> {
  const registry = new HookRegistry().register(...builtinHooks);
  if (options.plugins ?? true) await loadPlugins(config.pluginDir, registry, log);

  const fs = new FsSandbox(config.fsRoot);
  const launcher = options.launcher ?? createLauncher({ dryRun: config.dryRun, log: log.info });
  // Built after plugins load so the LLM's command list includes them.
  const brain = createBrain(config, registry.list(), log);
  const assistant = new Assistant({ registry, brain, config, log, fs, launcher });

  return {
    config,
    log,
    registry,
    assistant,
    brain,
    tts: createTts(config.tts),
    stt: createStt(config.stt),
    fs,
    launcher,
  };
}
