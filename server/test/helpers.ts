import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, type AppConfig } from '../src/config.js';
import { createLogger } from '../src/core/logger.js';
import { createRuntime, type Runtime } from '../src/runtime.js';
import type { Launcher } from '../src/services/launcher.js';

export const silentLog = createLogger('test', true);

/** Config isolated from the developer's server/.env: offline brain, temp sandbox. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = loadConfig();
  return {
    ...base,
    host: '127.0.0.1',
    port: 3001,
    allowedOrigins: [],
    dryRun: true,
    tts: { ...base.tts, provider: 'browser' },
    stt: { ...base.stt, url: '' },
    brain: { ...base.brain, provider: 'none' },
    ...overrides,
  };
}

export interface RecordingLauncher extends Launcher {
  calls: Array<{ kind: 'url' | 'path' | 'spawn' | 'run'; target: string | string[]; input?: string }>;
  /** argv of every run() call, for asserting OS commands. */
  runs: string[][];
}

/** Records every system action. `respond` stubs run() output per argv. */
export function recordingLauncher(respond: (argv: string[]) => string | Error | undefined = () => ''): RecordingLauncher {
  const calls: RecordingLauncher['calls'] = [];
  const runs: string[][] = [];
  return {
    calls,
    runs,
    openUrl: async (url) => void calls.push({ kind: 'url', target: url }),
    openPath: async (p) => void calls.push({ kind: 'path', target: p }),
    spawnDetached: async (argv) => void calls.push({ kind: 'spawn', target: argv }),
    run: async (argv, options) => {
      calls.push({ kind: 'run', target: argv, input: options?.input });
      runs.push(argv);
      const out = respond(argv);
      if (out instanceof Error) throw out;
      return out ?? '';
    },
  };
}

export async function tempDir(prefix = 'ares-test-'): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

export interface TestRuntimeOptions {
  platform?: NodeJS.Platform;
  respond?: Parameters<typeof recordingLauncher>[0];
}

export async function testRuntime(overrides: Partial<AppConfig> = {}, options: TestRuntimeOptions = {}) {
  const launcher = recordingLauncher(options.respond);
  const fsRoot = overrides.fsRoot ?? (await tempDir());
  const dataDir = overrides.dataDir ?? (await tempDir('ares-data-'));
  const integrationsFile = overrides.integrationsFile ?? path.join(dataDir, 'integrations.json');
  const rt: Runtime = await createRuntime(testConfig({ fsRoot, dataDir, integrationsFile, ...overrides }), silentLog, {
    launcher,
    platform: options.platform ?? 'linux',
  });
  return { rt, launcher, fsRoot, dataDir };
}
