import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { testRuntime } from './helpers.js';

const INSTALLED = ['Calculator', 'Google Chrome', 'Microsoft Word', 'Music', 'Safari', 'Spotify', 'Visual Studio Code'];

/** A macOS runtime whose osascript/pbpaste calls are answered by `respond`. */
async function mac(respond: (argv: string[]) => string | Error | undefined = () => '') {
  const ctx = await testRuntime({ apps: { 'vs code': ['open', '-a', 'Visual Studio Code'] } }, { platform: 'darwin', respond });
  ctx.rt.system.installedApps = async () => INSTALLED;
  await ctx.rt.apps.refresh();
  return ctx;
}

const script = (argv: string[]) => argv.filter((_, i) => argv[i - 1] === '-e').join('\n');
const isRunningQuery = (argv: string[]) => script(argv).includes('is running');

describe('macOS media and volume', () => {
  it('sets an exact volume', async () => {
    const { rt, launcher } = await mac();
    expect((await rt.assistant.handle('set the volume to 40 percent')).speech).toBe('Volume 40.');
    expect(launcher.runs.map(script)).toEqual(['set volume output volume 40', 'set volume output muted false']);
  });

  it('steps the volume relative to the current level', async () => {
    const { rt } = await mac((argv) => (script(argv).startsWith('output volume') ? '35' : ''));
    expect((await rt.assistant.handle('turn it up')).speech).toBe('Volume 45.');
    expect((await rt.assistant.handle('quieter')).speech).toBe('Volume 25.');
    expect((await rt.assistant.handle("what's the volume")).speech).toBe('Volume is at 35.');
  });

  it('mutes and unmutes', async () => {
    const { rt, launcher } = await mac();
    await rt.assistant.handle('mute');
    await rt.assistant.handle('unmute the sound');
    expect(launcher.runs.map(script)).toEqual(['set volume output muted true', 'set volume output muted false']);
  });

  it('controls Spotify when it is running, passing the app name as argv', async () => {
    const { rt, launcher } = await mac((argv) => (isRunningQuery(argv) ? 'true' : ''));
    expect((await rt.assistant.handle('pause the music')).speech).toBe('Paused.');
    const control = launcher.runs.at(-1)!;
    expect(script(control)).toContain('tell application (item 1 of argv) to pause');
    expect(control.slice(-2)).toEqual(['--', 'Spotify']);
  });

  it('falls back to Apple Music and skips tracks', async () => {
    const { rt, launcher } = await mac((argv) => (isRunningQuery(argv) ? 'false' : ''));
    expect((await rt.assistant.handle('next song')).speech).toBe('Skipping.');
    expect(launcher.runs.at(-1)!.slice(-2)).toEqual(['--', 'Music']);
  });

  it("reports what's playing", async () => {
    const { rt } = await mac((argv) => {
      if (isRunningQuery(argv)) return argv.at(-1) === 'Spotify' ? 'true' : 'false';
      if (script(argv).includes('current track')) return 'Get Lucky\nDaft Punk';
      return '';
    });
    expect((await rt.assistant.handle("what's playing")).speech).toBe('Get Lucky, by Daft Punk.');
  });
});

describe('macOS apps', () => {
  it('opens any installed app by name, including partial names', async () => {
    const { rt, launcher } = await mac();
    expect((await rt.assistant.handle('open Spotify')).speech).toBe('Opening Spotify.');
    expect((await rt.assistant.handle('launch chrome')).speech).toBe('Opening Google Chrome.');
    expect((await rt.assistant.handle('open vs code')).speech).toBe('Opening Visual Studio Code.');
    expect(launcher.runs).toEqual([
      ['open', '-a', 'Spotify'],
      ['open', '-a', 'Google Chrome'],
      ['open', '-a', 'Visual Studio Code'],
    ]);
  });

  it('leaves unknown names to the web hook', async () => {
    const { rt } = await mac();
    expect((await rt.assistant.handle('open YouTube')).intent).toBe('web.open');
  });

  it('quits running apps and declines when the app is not running', async () => {
    const { rt, launcher } = await mac((argv) => (isRunningQuery(argv) ? (argv.at(-1) === 'Safari' ? 'true' : 'false') : ''));
    expect((await rt.assistant.handle('quit Safari')).speech).toBe('Safari closed.');
    expect(script(launcher.runs.at(-1)!)).toContain('to quit');
    const word = await rt.assistant.handle('close word');
    expect(word).toMatchObject({ ok: false, speech: "Microsoft Word isn't running." });
  });

  it('switches to apps and lists open ones', async () => {
    const { rt } = await mac((argv) => (script(argv).includes('background only') ? 'Finder, Safari, Spotify' : ''));
    expect((await rt.assistant.handle('switch to safari')).intent).toBe('app.focus');
    expect((await rt.assistant.handle('what apps are open')).speech).toBe('3 open: Finder, Safari, Spotify.');
  });
});

describe('macOS power, appearance, clipboard', () => {
  it('locks with ⌃⌘Q and falls back to display sleep without Accessibility access', async () => {
    const { rt, launcher } = await mac((argv) => (script(argv).includes('keystroke') ? new Error('not allowed assistive access') : ''));
    expect((await rt.assistant.handle('lock my screen')).speech).toBe('Locking.');
    expect(launcher.runs.at(-1)).toEqual(['pmset', 'displaysleepnow']);
  });

  it('toggles and sets dark mode', async () => {
    const { rt, launcher } = await mac((argv) => (script(argv).includes('not dark mode') ? 'true' : 'false'));
    expect((await rt.assistant.handle('toggle dark mode')).speech).toBe('Dark mode on.');
    expect((await rt.assistant.handle('turn on light mode')).speech).toBe('Light mode on.');
    expect(script(launcher.runs.at(-1)!)).toContain('set dark mode to false');
  });

  it('reads and writes the clipboard', async () => {
    const { rt, launcher } = await mac((argv) => (argv[0] === 'pbpaste' ? 'Meeting at 4pm' : ''));
    expect((await rt.assistant.handle('read my clipboard')).speech).toBe('Meeting at 4pm');
    await rt.assistant.handle('copy hello world to the clipboard');
    expect(launcher.calls.at(-1)).toEqual({ kind: 'run', target: ['pbcopy'], input: 'hello world' });
  });

  it('saves screenshots to the Desktop', async () => {
    const { rt, launcher, fsRoot } = await mac();
    await fs.mkdir(path.join(fsRoot, 'Desktop'));
    expect((await rt.assistant.handle('take a screenshot')).speech).toBe('Screenshot saved.');
    const [cmd, flag, file] = launcher.runs.at(-1)!;
    expect([cmd, flag]).toEqual(['screencapture', '-x']);
    expect(path.dirname(file!)).toBe(path.join(fsRoot, 'Desktop'));
    expect(path.basename(file!)).toMatch(/^ARES Screenshot \d{4}-\d\d-\d\d at \d\d\.\d\d\.\d\d\.png$/);
  });
});

describe('other platforms', () => {
  it('uses pactl and playerctl on Linux', async () => {
    const { rt, launcher } = await testRuntime({}, { platform: 'linux', respond: (a) => (a[1] === 'get-sink-volume' ? 'Volume: front-left: 32768 /  50% / -18.06 dB' : '') });
    expect((await rt.assistant.handle('volume up')).speech).toBe('Volume 60.');
    await rt.assistant.handle('pause');
    expect(launcher.runs).toEqual([
      ['pactl', 'get-sink-volume', '@DEFAULT_SINK@'],
      ['pactl', 'set-sink-volume', '@DEFAULT_SINK@', '60%'],
      ['playerctl', 'pause'],
    ]);
  });

  it('uses media keys on Windows and explains what is unsupported', async () => {
    const { rt, launcher } = await testRuntime({}, { platform: 'win32' });
    expect((await rt.assistant.handle('turn it down')).speech).toBe('Quieter.');
    expect(launcher.runs[0]!.at(-1)).toContain('[char]174');
    const res = await rt.assistant.handle('take a screenshot');
    expect(res).toMatchObject({ ok: false });
    expect(res.speech).toMatch(/isn't supported on Windows yet/);
  });
});
