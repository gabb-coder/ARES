import { execFile, spawn } from 'node:child_process';
import open from 'open';

/**
 * The only place ARES starts OS processes. Everything goes through argv arrays
 * (never a shell string), and ARES_DRY_RUN=1 turns every call into a log line.
 */
export interface Launcher {
  /** Opens an http(s) URL in the default browser. */
  openUrl(url: string): Promise<void>;
  /** Opens a file or folder with its default application. */
  openPath(path: string): Promise<void>;
  /** Starts a detached process. Resolves once it has spawned. */
  spawnDetached(argv: string[]): Promise<void>;
  /**
   * Runs a command to completion and returns trimmed stdout. Pass
   * `readOnly: true` for queries (they still run in dry-run mode).
   */
  run(argv: string[], options?: RunOptions): Promise<string>;
}

export interface RunOptions {
  /** Queries with no side effects run even in dry-run mode. */
  readOnly?: boolean;
  /** Written to the process's stdin. */
  input?: string;
  timeoutMs?: number;
}

export class CommandError extends Error {}

export function createLauncher(options: { dryRun: boolean; log: (msg: string) => void }): Launcher {
  if (options.dryRun) {
    return {
      openUrl: async (url) => options.log(`[dry-run] open url ${url}`),
      openPath: async (p) => options.log(`[dry-run] open path ${p}`),
      spawnDetached: async (argv) => options.log(`[dry-run] spawn ${JSON.stringify(argv)}`),
      run: async (argv, runOptions = {}) => {
        if (runOptions.readOnly) return runCommand(argv, runOptions);
        options.log(`[dry-run] run ${JSON.stringify(argv)}`);
        return '';
      },
    };
  }

  return {
    async openUrl(url) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Refusing to open ${parsed.protocol} URLs`);
      }
      await open(parsed.toString());
    },
    async openPath(p) {
      await open(p);
    },
    spawnDetached(argv) {
      const [command, ...args] = argv;
      if (!command) return Promise.reject(new Error('Empty command'));
      return new Promise((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false });
        child.once('error', (err: NodeJS.ErrnoException) => {
          reject(err.code === 'ENOENT' ? new Error(`${command} is not installed`) : err);
        });
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
      });
    },
    run: runCommand,
  };
}

function runCommand(argv: string[], { input, timeoutMs = 10_000 }: RunOptions = {}): Promise<string> {
  const [command, ...args] = argv;
  if (!command) return Promise.reject(new CommandError('Empty command'));
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: false },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout.trim());
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return reject(new CommandError(`${command} is not installed`));
        if (err.killed) return reject(new CommandError(`${command} timed out`));
        const detail = String(stderr).trim().split('\n')[0] || err.message;
        reject(new CommandError(detail));
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}
