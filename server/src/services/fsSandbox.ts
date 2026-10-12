import fs from 'node:fs/promises';
import path from 'node:path';
import { spokenToFilename } from '../core/intent.js';

/** Spoken names for common folders, resolved relative to the sandbox root. */
const LOCATIONS: Record<string, string> = {
  home: '.',
  'home folder': '.',
  'home directory': '.',
  root: '.',
  desktop: 'Desktop',
  documents: 'Documents',
  docs: 'Documents',
  downloads: 'Downloads',
  pictures: 'Pictures',
  photos: 'Pictures',
  music: 'Music',
  videos: 'Videos',
  movies: 'Movies',
};

export class SandboxError extends Error {}

/**
 * Confines filesystem hooks to a single root directory (ARES_FS_ROOT, default:
 * the user's home). Every path is resolved, symlinks included, and rejected if
 * it lands outside the root.
 */
export class FsSandbox {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Resolves a spoken location ("my downloads", "projects/ares") to a directory. */
  async location(spoken?: string): Promise<string> {
    const name = (spoken ?? '')
      .trim()
      .replace(/^(?:my|the)\s+/i, '')
      .replace(/\s+(?:folder|directory|dir)$/i, '');
    if (!name) return this.root;

    const alias = LOCATIONS[name.toLowerCase()];
    return this.resolve(alias ?? spokenToFilename(name), this.root);
  }

  /**
   * Resolves `target` against `base`, matching each path segment
   * case-insensitively when there is no exact match (speech has no case).
   */
  async resolve(target: string, base: string = this.root): Promise<string> {
    const cleaned = target.replace(/^~[\\/]?/, '');
    const absolute = path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(base, cleaned);
    this.#assertInside(absolute);

    const fixed = await this.#fixCase(absolute);
    await this.#assertRealInside(fixed);
    return fixed;
  }

  /** Path shown to the user: relative to the root, prefixed with "~". */
  display(absolute: string): string {
    const rel = path.relative(this.root, absolute);
    return rel ? `~${path.sep}${rel}` : '~';
  }

  #assertInside(absolute: string): void {
    const rel = path.relative(this.root, absolute);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new SandboxError('That path is outside my permitted directory');
    }
  }

  /** Follows symlinks on the deepest existing ancestor so links can't escape the root. */
  async #assertRealInside(absolute: string): Promise<void> {
    let probe = absolute;
    for (;;) {
      try {
        const real = await fs.realpath(probe);
        const realRoot = await fs.realpath(this.root);
        const rel = path.relative(realRoot, real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          throw new SandboxError('That path is outside my permitted directory');
        }
        return;
      } catch (err) {
        if (err instanceof SandboxError) throw err;
        const parent = path.dirname(probe);
        if (parent === probe) return;
        probe = parent;
      }
    }
  }

  async #fixCase(absolute: string): Promise<string> {
    const rel = path.relative(this.root, absolute);
    if (!rel) return absolute;

    let current = this.root;
    for (const segment of rel.split(path.sep)) {
      const exact = path.join(current, segment);
      if (await exists(exact)) {
        current = exact;
        continue;
      }
      const entries = await fs.readdir(current).catch(() => [] as string[]);
      const match = entries.find((e) => e.toLowerCase() === segment.toLowerCase());
      current = path.join(current, match ?? segment);
    }
    return current;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
