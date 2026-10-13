import path from 'node:path';
import type { AppConfig } from './config.js';
import { Assistant } from './core/assistant.js';
import { EventBus } from './core/events.js';
import { loadPlugins } from './core/loader.js';
import { HookRegistry } from './core/registry.js';
import type { Logger } from './core/types.js';
import { builtinHooks } from './hooks/index.js';
import { AppDirectory } from './services/appDirectory.js';
import { IntegrationManager } from './integrations/manager.js';
import { localTools } from './integrations/localTools.js';
import { createAgent, type Agent } from './services/agent.js';
import { FsSandbox } from './services/fsSandbox.js';
import { createLauncher, type Launcher } from './services/launcher.js';
import { Scheduler } from './services/scheduler.js';
import { createStt, type SttService } from './services/stt.js';
import { createSystemControl, type SystemControl } from './services/system.js';
import { createTts, type TtsService } from './services/tts.js';

export interface Runtime {
  config: AppConfig;
  log: Logger;
  registry: HookRegistry;
  assistant: Assistant;
  agent: Agent | null;
  integrations: IntegrationManager;
  tts: TtsService;
  stt: SttService;
  fs: FsSandbox;
  launcher: Launcher;
  system: SystemControl;
  apps: AppDirectory;
  bus: EventBus;
  scheduler: Scheduler;
  /** Stops background timers so the process (or a test) can exit cleanly. */
  close(): Promise<void>;
}

export interface RuntimeOptions {
  /** Load drop-in plugins from config.pluginDir. Default true. */
  plugins?: boolean;
  /** Replace the launcher, e.g. with a recorder in tests. */
  launcher?: Launcher;
  /** Pretend to run on another OS (tests). */
  platform?: NodeJS.Platform;
  /** Connect MCP integrations from config.integrationsFile. Default true. */
  integrations?: boolean;
}

/** Wires every service together. Shared by the server entry point and tests. */
export async function createRuntime(config: AppConfig, log: Logger, options: RuntimeOptions = {}): Promise<Runtime> {
  const registry = new HookRegistry().register(...builtinHooks);
  if (options.plugins ?? true) await loadPlugins(config.pluginDir, registry, log);

  const fs = new FsSandbox(config.fsRoot);
  const launcher = options.launcher ?? createLauncher({ dryRun: config.dryRun, log: log.info });
  const system = createSystemControl(options.platform ?? process.platform, launcher);
  const apps = new AppDirectory(system, config.apps);
  await apps.refresh();
  apps.startAutoRefresh();

  const bus = new EventBus();
  const scheduler = new Scheduler({
    file: path.join(config.dataDir, 'reminders.json'),
    bus,
    log,
    onFire: (_item, speech) => void system.notify('ARES', speech).catch(() => {}),
  });
  await scheduler.load();

  const integrations = new IntegrationManager({
    file: config.integrationsFile,
    dataDir: config.dataDir,
    callbackUrl: `http://localhost:${config.port}/api/integrations/oauth/callback`,
    bus,
    log,
  });
  if (options.integrations ?? true) await integrations.start();

  // Built after plugins load so the agent's command list includes them.
  const agent = createAgent(config, registry.list(), log);
  if (!agent && integrations.configured) log.warn('Integrations need an LLM: set ARES_BRAIN=ollama (free) or anthropic');
  const assistant = new Assistant({
    registry,
    agent,
    integrations,
    localTools: localTools({ fs, launcher, scheduler }),
    config,
    log,
    fs,
    launcher,
    system,
    apps,
    scheduler,
  });

  return {
    config,
    log,
    registry,
    assistant,
    agent,
    integrations,
    tts: createTts(config.tts),
    stt: createStt(config.stt),
    fs,
    launcher,
    system,
    apps,
    bus,
    scheduler,
    async close() {
      apps.stop();
      scheduler.close();
      await Promise.all([scheduler.flush(), integrations.close()]);
    },
  };
}
