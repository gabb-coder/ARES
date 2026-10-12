import fs from 'node:fs/promises';
import path from 'node:path';
import { patterns, spokenToFilename } from '../core/intent.js';
import { defineHook, type HookContext } from '../core/types.js';

// Shared tail: "... in my downloads folder", "... on the desktop".
const IN_LOCATION = String.raw`(?:\s+(?:in|on|inside|under|from)(?:\s+(?:my|the))?\s+(?<location>.+?))?`;
const DIR_SUFFIX = String.raw`(?:\s+(?:folder|directory|dir))?`;

const MAX_READ_BYTES = 1024 * 1024;
const SPEAK_CONTENT_CHARS = 240;
const LIST_LIMIT = 50;

export const listHook = defineHook({
  name: 'fs.list',
  category: 'Filesystem',
  description: 'List the contents of a folder',
  examples: ['List files in downloads', "What's on my desktop?"],
  match: patterns(
    new RegExp(
      String.raw`^(?:list|show(?: me)?|display)(?: all)?(?: the| my)? (?:files|contents|folders|items|stuff)` +
        IN_LOCATION +
        DIR_SUFFIX +
        '$',
      'i',
    ),
    new RegExp(String.raw`^what(?:'s| is| are)(?: the files)? (?:in|on|inside)(?: my| the)? (?<location>.+?)` + DIR_SUFFIX + '$', 'i'),
  ),
  run: async ({ location }, ctx) => {
    const dir = await ctx.fs.location(location);
    const entries = await readDir(dir, ctx);
    const visible = entries.filter((e) => !e.name.startsWith('.'));
    const folders = visible.filter((e) => e.isDirectory());
    const files = visible.filter((e) => !e.isDirectory());
    const where = ctx.fs.display(dir);

    if (visible.length === 0) return { speech: `${capitalize(spokenPath(where))} is empty.`, card: { title: where, items: [] } };

    const items = [
      ...folders.map((e) => `${e.name}/`),
      ...files.map((e) => e.name),
    ].slice(0, LIST_LIMIT);
    if (visible.length > LIST_LIMIT) items.push(`… and ${visible.length - LIST_LIMIT} more`);

    return {
      speech: `${count(folders.length, 'folder')} and ${count(files.length, 'file')} in ${spokenPath(where)}.`,
      card: { title: where, items },
    };
  },
});

export const readHook = defineHook({
  name: 'fs.read',
  category: 'Filesystem',
  description: 'Read a text file',
  examples: ['Read file notes.txt in documents'],
  match: patterns(
    new RegExp(String.raw`^(?:read|show(?: me)?|open and read|display|print)(?: the)?(?: contents of)?(?: the)? file (?<file>.+?)` + IN_LOCATION + '$', 'i'),
    new RegExp(String.raw`^read (?<file>[^\s]+\.[a-z0-9]{1,8})` + IN_LOCATION + '$', 'i'),
  ),
  run: async ({ file, location }, ctx) => {
    const base = await ctx.fs.location(location);
    const target = await ctx.fs.resolve(spokenToFilename(file ?? ''), base);
    const stat = await statOrNull(target);
    const name = path.basename(target);

    if (!stat) return { ok: false, speech: `I can't find ${name}.` };
    if (stat.isDirectory()) return { ok: false, speech: `${name} is a folder. Ask me to list it instead.` };

    const handle = await fs.open(target, 'r');
    let buffer: Buffer;
    try {
      buffer = Buffer.alloc(Math.min(stat.size, MAX_READ_BYTES));
      await handle.read(buffer, 0, buffer.length, 0);
    } finally {
      await handle.close();
    }
    if (buffer.subarray(0, 8000).includes(0)) {
      return { ok: false, speech: `${name} is a binary file. I only read text.` };
    }

    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/).length;
    const preview = text.trim().replace(/\s+/g, ' ');
    const card = { title: ctx.fs.display(target), body: text.slice(0, 8000) };

    if (!preview) return { speech: `${name} is empty.`, card };
    if (preview.length <= SPEAK_CONTENT_CHARS) return { speech: preview, card };
    return { speech: `${name} has ${count(lines, 'line')}. It's on screen.`, card };
  },
});

export const createFolderHook = defineHook({
  name: 'fs.mkdir',
  category: 'Filesystem',
  description: 'Create a folder',
  examples: ['Create a folder called projects on my desktop'],
  match: patterns(
    new RegExp(String.raw`^(?:create|make|add)(?: a)?(?: new)? (?:folder|directory)(?: (?:called|named))? (?<name>.+?)` + IN_LOCATION + '$', 'i'),
  ),
  run: async ({ name, location }, ctx) => {
    const base = await ctx.fs.location(location);
    const target = await ctx.fs.resolve(spokenToFilename(name ?? ''), base);
    if (await statOrNull(target)) return { ok: false, speech: `${path.basename(target)} already exists.` };

    await fs.mkdir(target, { recursive: true });
    return {
      speech: `Folder ${path.basename(target)} created.`,
      card: { title: 'Folder created', items: [ctx.fs.display(target)] },
    };
  },
});

export const createFileHook = defineHook({
  name: 'fs.touch',
  category: 'Filesystem',
  description: 'Create a text file, optionally with content',
  examples: ['Create a file called todo.txt on my desktop with buy milk'],
  match: patterns(
    new RegExp(
      String.raw`^(?:create|make|add|write)(?: a)?(?: new)? (?:text file|file|document)(?: (?:called|named))? (?<name>.+?)` +
        IN_LOCATION +
        String.raw`(?:\s+(?:with|containing|that says|saying)(?: the text)?:?\s+(?<content>.+))?$`,
      'i',
    ),
  ),
  run: async ({ name, location, content }, ctx) => {
    let filename = spokenToFilename(name ?? '');
    if (!path.extname(filename)) filename += '.txt';

    const base = await ctx.fs.location(location);
    const target = await ctx.fs.resolve(filename, base);
    try {
      // "wx" fails if the file exists: ARES never silently overwrites.
      await fs.writeFile(target, content ? `${content.trim()}\n` : '', { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        return { ok: false, speech: `${path.basename(target)} already exists. I won't overwrite it.` };
      }
      throw err;
    }
    return {
      speech: `Created ${path.basename(target)}.`,
      card: { title: 'File created', items: [ctx.fs.display(target)], body: content },
    };
  },
});

export const noteHook = defineHook({
  name: 'fs.note',
  category: 'Filesystem',
  description: 'Append a timestamped note to ARES-notes.md',
  examples: ['Take a note: call the bank tomorrow'],
  match: patterns(/^(?:take a note|make a note|note|jot down|remember)(?: that)?[:,]?\s+(?<text>.+)$/i),
  run: async ({ text }, ctx) => {
    const target = await ctx.fs.resolve('ARES-notes.md');
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    await fs.appendFile(target, `- ${stamp} — ${text}\n`);
    return { speech: 'Noted.', card: { title: ctx.fs.display(target), items: [text ?? ''] } };
  },
});

export const searchHook = defineHook({
  name: 'fs.search',
  category: 'Filesystem',
  description: 'Find files by name',
  examples: ['Find files named invoice in documents'],
  match: patterns(
    new RegExp(
      String.raw`^(?:find|search for|search|locate|look for)(?: a| the| my| all| any)? (?:files?|documents?|folders?)(?: (?:called|named|matching|containing|like))? (?<query>.+?)` +
        IN_LOCATION +
        '$',
      'i',
    ),
    /^where(?:'s| is)(?: my| the)?(?: file)? (?<query>[\w\- ]+\.[a-z0-9]{1,8})$/i,
  ),
  run: async ({ query, location }, ctx) => {
    const needle = spokenToFilename(query ?? '').toLowerCase();
    const start = await ctx.fs.location(location);
    const hits = await findByName(start, needle);
    const where = ctx.fs.display(start);

    if (hits.length === 0) return { speech: `No matches for ${needle} in ${spokenPath(where)}.` };
    const top = path.basename(hits[0]!);
    return {
      speech: hits.length === 1 ? `Found ${top}.` : `Found ${hits.length >= SEARCH_LIMIT ? 'at least ' : ''}${hits.length} matches. Top hit: ${top}.`,
      card: { title: `Matches for “${needle}”`, items: hits.map((h) => ctx.fs.display(h)) },
    };
  },
});

export const openPathHook = defineHook({
  name: 'fs.open',
  category: 'Filesystem',
  description: 'Open a folder or file with its default app',
  examples: ['Open my downloads folder', 'Open file report.pdf in documents'],
  // Above the web/app "open ..." hooks so "open my documents folder" lands here.
  priority: 20,
  match: patterns(
    new RegExp(String.raw`^(?:open|reveal)(?: up)?(?: my| the)? (?<location>.+?) (?:folder|directory)(?: in (?:the )?(?:file manager|finder|explorer))?$`, 'i'),
    /^open(?: my| the)? (?<location>desktop|documents|downloads|home folder|pictures|music|videos)$/i,
    new RegExp(String.raw`^open (?:the )?file (?<file>.+?)` + IN_LOCATION + '$', 'i'),
  ),
  run: async ({ location, file }, ctx) => {
    const base = await ctx.fs.location(location);
    const target = file ? await ctx.fs.resolve(spokenToFilename(file), base) : base;
    if (!(await statOrNull(target))) return { ok: false, speech: `I can't find ${path.basename(target)}.` };

    await ctx.launcher.openPath(target);
    return { speech: `Opening ${path.basename(target) || 'home'}.`, card: { title: 'Opened', items: [ctx.fs.display(target)] } };
  },
});

// --- helpers ---------------------------------------------------------------

const SEARCH_LIMIT = 20;
const SEARCH_MAX_DEPTH = 6;
const SEARCH_MAX_VISITS = 20_000;
const SEARCH_SKIP = new Set(['node_modules', 'Library', 'AppData', '$Recycle.Bin', 'proc', '__pycache__']);

/** Breadth-first name search with depth, visit and result caps so it stays fast. */
async function findByName(start: string, needle: string): Promise<string[]> {
  const hits: string[] = [];
  let queue: Array<{ dir: string; depth: number }> = [{ dir: start, depth: 0 }];
  let visits = 0;

  while (queue.length && hits.length < SEARCH_LIMIT && visits < SEARCH_MAX_VISITS) {
    const next: typeof queue = [];
    for (const { dir, depth } of queue) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        visits++;
        if (entry.name.startsWith('.') || SEARCH_SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.name.toLowerCase().includes(needle)) {
          hits.push(full);
          if (hits.length >= SEARCH_LIMIT) return hits;
        }
        if (entry.isDirectory() && depth < SEARCH_MAX_DEPTH) next.push({ dir: full, depth: depth + 1 });
      }
    }
    queue = next;
  }
  return hits;
}

async function readDir(dir: string, ctx: HookContext) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error(`${ctx.fs.display(dir)} doesn't exist`);
    if (code === 'ENOTDIR') throw new Error(`${ctx.fs.display(dir)} is a file, not a folder`);
    throw err;
  }
}

async function statOrNull(p: string) {
  return fs.stat(p).catch(() => null);
}

function count(n: number, noun: string): string {
  return `${n === 0 ? 'No' : n} ${noun}${n === 1 ? '' : 's'}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "~/Documents/work" reads better aloud as "Documents, work". */
function spokenPath(display: string): string {
  if (display === '~') return 'your home folder';
  return display.replace(/^~[\\/]/, '').split(/[\\/]/).join(', ');
}

export const filesystemHooks = [listHook, readHook, createFolderHook, createFileHook, noteHook, searchHook, openPathHook];
