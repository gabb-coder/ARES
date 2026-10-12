import type { SystemControl } from './system.js';

export type AppTarget =
  /** An installed app, opened/quit/focused by name (macOS). */
  | { kind: 'app'; name: string }
  /** An ARES_APPS alias with an explicit command line. */
  | { kind: 'command'; name: string; argv: string[] };

const REFRESH_MS = 10 * 60_000;

/**
 * Knows which apps can be addressed by voice: ARES_APPS aliases everywhere,
 * plus every installed app on macOS. Matching must be synchronous (hooks'
 * match()), so the installed list is cached and refreshed in the background.
 */
export class AppDirectory {
  #installed: string[] = [];
  #timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly system: SystemControl,
    private readonly aliases: Record<string, string[]>,
  ) {}

  async refresh(): Promise<void> {
    this.#installed = await this.system.installedApps().catch(() => []);
  }

  startAutoRefresh(): void {
    this.#timer ??= setInterval(() => void this.refresh(), REFRESH_MS);
    this.#timer.unref();
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  get installed(): readonly string[] {
    return this.#installed;
  }

  resolve(spoken: string): AppTarget | null {
    const wanted = spoken
      .trim()
      .toLowerCase()
      .replace(/^(?:the|my)\s+/, '')
      .replace(/\s+(?:app|application|program)$/, '');
    if (!wanted) return null;

    const argv = this.aliases[wanted];
    if (argv) {
      // A macOS alias like ["open", "-a", "Visual Studio Code"] names a real app.
      if (this.system.platform === 'darwin' && argv[0] === 'open' && argv[1] === '-a' && argv[2]) {
        return { kind: 'app', name: argv[2] };
      }
      return { kind: 'command', name: wanted, argv };
    }

    const exact = this.#installed.find((n) => n.toLowerCase() === wanted);
    if (exact) return { kind: 'app', name: exact };
    if (wanted.length < 3) return null;

    // "chrome" → "Google Chrome", "word" → "Microsoft Word": whole-word match, shortest wins.
    const words = wanted.split(/\s+/);
    const partial = this.#installed
      .filter((name) => containsWords(name.toLowerCase().split(/[\s.-]+/), words))
      .sort((a, b) => a.length - b.length)[0];
    return partial ? { kind: 'app', name: partial } : null;
  }
}

function containsWords(haystack: string[], needle: string[]): boolean {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, j) => haystack[i + j] === w)) return true;
  }
  return false;
}
