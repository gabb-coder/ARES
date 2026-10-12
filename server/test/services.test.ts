import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPlugins } from '../src/core/loader.js';
import { HookRegistry } from '../src/core/registry.js';
import { defineHook } from '../src/core/types.js';
import { systemPrompt, toSpeech } from '../src/persona.js';
import { cleanTranscript, encodeWav } from '../src/services/stt.js';
import { silentLog, tempDir } from './helpers.js';

describe('toSpeech', () => {
  it('strips markdown, code and links', () => {
    expect(toSpeech('**Paris** is the [capital](https://x.y) of `France`.\n\n```js\nx\n```')).toBe('Paris is the capital of France.');
  });

  it('keeps whole sentences within the limit', () => {
    const text = 'One sentence here. Another sentence here. A third one that is long.';
    expect(toSpeech(text, 45)).toBe('One sentence here. Another sentence here.');
  });
});

describe('systemPrompt', () => {
  it('names ARES and lists commands', () => {
    const prompt = systemPrompt([{ name: 'a.b', category: 'X', description: 'Do a thing', examples: ['do it'] }]);
    expect(prompt).toContain('You are ARES');
    expect(prompt).toContain('Do a thing (e.g. "do it")');
  });
});

describe('HookRegistry', () => {
  const hook = (name: string, priority: number, word: string) =>
    defineHook({ name, category: 'T', description: name, examples: [], priority, match: (i) => (i === word ? {} : null), run: () => ({ speech: name }) });

  it('matches by priority but lists in registration order', () => {
    const registry = new HookRegistry().register(hook('low', 0, 'go'), hook('high', 5, 'go'));
    const ctx = {} as Parameters<HookRegistry['resolve']>[1];
    expect(registry.resolve('go', ctx)?.hook.name).toBe('high');
    expect(registry.list().map((h) => h.name)).toEqual(['low', 'high']);
  });

  it('replaces hooks with the same name and validates shape', () => {
    const registry = new HookRegistry().register(hook('a', 0, 'x'), hook('a', 0, 'y'));
    expect(registry.size).toBe(1);
    expect(() => registry.register({ name: 'bad' } as never)).toThrow(/Invalid hook "bad"/);
  });
});

describe('loadPlugins', () => {
  it('loads valid plugins and skips broken ones', async () => {
    const dir = await tempDir('ares-plugins-');
    await fs.writeFile(
      path.join(dir, 'echo.mjs'),
      `export default { name: 'test.echo', category: 'Test', description: 'Echo', examples: ['echo hi'],
         match: (i) => i.startsWith('echo ') ? { text: i.slice(5) } : null, run: ({ text }) => ({ speech: text }) };`,
    );
    await fs.writeFile(path.join(dir, 'broken.mjs'), 'export default {{{');
    await fs.writeFile(path.join(dir, '_ignored.mjs'), 'throw new Error("should not load")');

    const registry = new HookRegistry();
    expect(await loadPlugins(dir, registry, silentLog)).toEqual(['test.echo']);
  });

  it('tolerates a missing directory', async () => {
    expect(await loadPlugins('/does/not/exist', new HookRegistry(), silentLog)).toEqual([]);
  });
});

describe('stt helpers', () => {
  it('writes a valid 16 kHz mono WAV header', () => {
    const wav = encodeWav(Buffer.alloc(3200), 16_000);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(40)).toBe(3200);
    expect(wav.length).toBe(44 + 3200);
  });

  it('drops whisper non-speech markers', () => {
    expect(cleanTranscript(' [BLANK_AUDIO] Open YouTube (keyboard clicking) ')).toBe('Open YouTube');
  });
});
