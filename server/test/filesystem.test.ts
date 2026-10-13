import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Runtime } from '../src/runtime.js';
import { FsSandbox, SandboxError } from '../src/services/fsSandbox.js';
import { tempDir, testRuntime, type RecordingLauncher } from './helpers.js';

let rt: Runtime;
let root: string;
let launcher: RecordingLauncher;

beforeEach(async () => {
  root = await tempDir();
  await fs.mkdir(path.join(root, 'Documents'));
  await fs.mkdir(path.join(root, 'Downloads', 'archive'), { recursive: true });
  await fs.writeFile(path.join(root, 'Documents', 'notes.txt'), 'Ship ARES v1.\n');
  await fs.writeFile(path.join(root, 'Downloads', 'invoice-2026.pdf'), '%PDF');
  await fs.writeFile(path.join(root, 'Downloads', 'archive', 'old-invoice.pdf'), '%PDF');
  await fs.writeFile(path.join(root, 'Downloads', 'image.bin'), Buffer.from([0, 1, 2, 0, 255]));
  ({ rt, launcher } = await testRuntime({ fsRoot: root }));
});

const ask = (text: string) => rt.assistant.handle(text);

describe('filesystem hooks', () => {
  it('lists a named folder', async () => {
    const res = await ask('list files in my downloads folder');
    expect(res.intent).toBe('fs.list');
    expect(res.speech).toBe('1 folder and 2 files in Downloads.');
    expect(res.card?.items).toEqual(['archive/', 'image.bin', 'invoice-2026.pdf']);
  });

  it('matches folder names case-insensitively', async () => {
    const res = await ask("what's in documents");
    expect(res.ok).toBe(true);
    expect(res.card?.title).toBe(`~${path.sep}Documents`);
  });

  it('reads short text files aloud', async () => {
    const res = await ask('read file notes dot txt in documents');
    expect(res.speech).toBe('Ship ARES v1.');
    expect(res.card?.body).toContain('Ship ARES v1.');
  });

  it('refuses binary files', async () => {
    const res = await ask('read file image.bin in downloads');
    expect(res.ok).toBe(false);
    expect(res.speech).toMatch(/binary/);
  });

  it('creates folders and files without overwriting', async () => {
    expect((await ask('create a folder called projects in documents')).speech).toBe('Folder projects created.');
    await expect(fs.stat(path.join(root, 'Documents', 'projects'))).resolves.toBeTruthy();

    const created = await ask('create a file called todo in documents with buy milk');
    expect(created.speech).toBe('Created todo.txt.');
    expect(await fs.readFile(path.join(root, 'Documents', 'todo.txt'), 'utf8')).toBe('buy milk\n');

    const again = await ask('create a file called todo.txt in documents with something else');
    expect(again.ok).toBe(false);
    expect(await fs.readFile(path.join(root, 'Documents', 'todo.txt'), 'utf8')).toBe('buy milk\n');
  });

  it('appends notes', async () => {
    await ask('take a note: call the bank');
    await ask('remember that the demo is Friday');
    const notes = await fs.readFile(path.join(root, 'ARES-notes.md'), 'utf8');
    expect(notes.trim().split('\n')).toHaveLength(2);
    expect(notes).toContain('the demo is Friday');
  });

  it('searches recursively', async () => {
    const res = await ask('find files named invoice');
    expect(res.speech).toMatch(/^Found 2 matches/);
    expect(res.card?.items).toHaveLength(2);
  });

  it('opens folders through the launcher', async () => {
    const res = await ask('open my downloads folder');
    expect(res.ok).toBe(true);
    expect(launcher.calls).toEqual([{ kind: 'path', target: path.join(root, 'Downloads') }]);
  });

  it('refuses paths outside the sandbox', async () => {
    const res = await ask('read file ../../../etc/passwd');
    expect(res.ok).toBe(false);
    expect(res.speech).toMatch(/outside my permitted directory/);
  });
});

describe('FsSandbox', () => {
  it('rejects traversal and absolute paths outside the root', async () => {
    const sandbox = new FsSandbox(root);
    await expect(sandbox.resolve('../outside')).rejects.toBeInstanceOf(SandboxError);
    await expect(sandbox.resolve('/etc/passwd')).rejects.toBeInstanceOf(SandboxError);
    await expect(sandbox.resolve('Documents/../Downloads')).resolves.toBe(path.join(root, 'Downloads'));
  });

  it('rejects symlinks that escape the root', async () => {
    const outside = await tempDir('ares-outside-');
    await fs.writeFile(path.join(outside, 'secret.txt'), 'nope');
    await fs.symlink(outside, path.join(root, 'escape'));
    const sandbox = new FsSandbox(root);
    await expect(sandbox.resolve('escape/secret.txt')).rejects.toBeInstanceOf(SandboxError);
  });

  it('maps spoken locations', async () => {
    const sandbox = new FsSandbox(root);
    expect(await sandbox.location('my downloads folder')).toBe(path.join(root, 'Downloads'));
    expect(await sandbox.location('the home directory')).toBe(root);
    expect(await sandbox.location()).toBe(root);
  });
});
