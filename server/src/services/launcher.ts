import { spawn } from 'node:child_process';
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
}

export function createLauncher(options: { dryRun: boolean; log: (msg: string) => void }): Launcher {
  if (options.dryRun) {
    return {
      openUrl: async (url) => options.log(`[dry-run] open url ${url}`),
      openPath: async (p) => options.log(`[dry-run] open path ${p}`),
      spawnDetached: async (argv) => options.log(`[dry-run] spawn ${JSON.stringify(argv)}`),
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
  };
}
