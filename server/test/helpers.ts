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
  calls: Array<{ kind: 'url' | 'path' | 'spawn'; target: string | string[] }>;
}

export function recordingLauncher(): RecordingLauncher {
  const calls: RecordingLauncher['calls'] = [];
  return {
    calls,
    openUrl: async (url) => void calls.push({ kind: 'url', target: url }),
    openPath: async (p) => void calls.push({ kind: 'path', target: p }),
    spawnDetached: async (argv) => void calls.push({ kind: 'spawn', target: argv }),
  };
}

export async function tempDir(prefix = 'ares-test-'): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

export async function testRuntime(overrides: Partial<AppConfig> = {}) {
  const launcher = recordingLauncher();
  const fsRoot = overrides.fsRoot ?? (await tempDir());
  const rt: Runtime = await createRuntime(testConfig({ fsRoot, ...overrides }), silentLog, { launcher });
  return { rt, launcher, fsRoot };
}
