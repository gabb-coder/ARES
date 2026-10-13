import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Launcher } from './launcher.js';

/** Thrown when a control has no implementation on this OS. */
export class UnsupportedError extends Error {
  constructor(feature: string, platform: NodeJS.Platform) {
    super(`${feature} isn't supported on ${platformName(platform)} yet`);
  }
}

export type MediaAction = 'playpause' | 'play' | 'pause' | 'next' | 'previous';

export interface NowPlaying {
  title: string;
  artist: string;
  player: string;
}

/**
 * OS-level controls behind one interface. macOS is the primary target
 * (AppleScript, pmset, screencapture); Linux and Windows get what their
 * standard tools allow. Every command runs through the launcher as argv.
 */
export interface SystemControl {
  readonly platform: NodeJS.Platform;
  getVolume(): Promise<number>;
  setVolume(level: number): Promise<void>;
  /** Changes volume by `delta` percentage points; returns the new level when known. */
  changeVolume(delta: number): Promise<number | null>;
  setMuted(muted: boolean): Promise<void>;
  /** Returns the player that handled it (e.g. "Spotify"). */
  media(action: MediaAction): Promise<string>;
  nowPlaying(): Promise<NowPlaying | null>;
  /** App names that can be opened by name (macOS: everything installed). */
  installedApps(): Promise<string[]>;
  runningApps(): Promise<string[]>;
  openApp(name: string): Promise<void>;
  focusApp(name: string): Promise<void>;
  quitApp(name: string): Promise<boolean>;
  lockScreen(): Promise<void>;
  sleepDisplay(): Promise<void>;
  sleep(): Promise<void>;
  /** Sets or toggles dark mode; returns whether dark mode is now on. */
  setDarkMode(mode: boolean | 'toggle'): Promise<boolean>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  screenshot(file: string): Promise<void>;
  /** Shows a desktop notification (best effort). */
  notify(title: string, message: string): Promise<void>;
}

export function platformName(platform: NodeJS.Platform): string {
  return { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[platform as string] ?? platform;
}

export function createSystemControl(platform: NodeJS.Platform, launcher: Launcher): SystemControl {
  if (platform === 'darwin') return macControl(launcher);
  if (platform === 'win32') return windowsControl(launcher);
  return linuxControl(launcher);
}

// --- macOS -----------------------------------------------------------------

/**
 * AppleScript with user-supplied values passed as argv, never interpolated,
 * so a spoken app name can't inject script.
 */
function osascript(launcher: Launcher, lines: string[], args: string[] = [], readOnly = false): Promise<string> {
  const argv = ['osascript', ...lines.flatMap((l) => ['-e', l])];
  if (args.length) argv.push('--', ...args);
  return launcher.run(argv, { readOnly });
}

const MAC_APP_DIRS = ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities'];

function macControl(launcher: Launcher): SystemControl {
  const run = (lines: string[], args: string[] = []) => osascript(launcher, lines, args);
  const query = (lines: string[], args: string[] = []) => osascript(launcher, lines, args, true);

  const isRunning = async (app: string) =>
    (await query(['on run argv', 'return application (item 1 of argv) is running', 'end run'], [app])) === 'true';

  /** Spotify if it's running, else Apple Music. */
  const player = async () => ((await isRunning('Spotify').catch(() => false)) ? 'Spotify' : 'Music');

  const control: SystemControl = {
    platform: 'darwin',
    async getVolume() {
      const out = await query(['output volume of (get volume settings)']);
      const level = Number(out);
      if (!Number.isFinite(level)) throw new Error("This audio output's volume can't be read");
      return level;
    },
    async setVolume(level) {
      await run([`set volume output volume ${clampVolume(level)}`]);
      if (level > 0) await run(['set volume output muted false']);
    },
    async changeVolume(delta) {
      const next = clampVolume((await control.getVolume()) + delta);
      await control.setVolume(next);
      return next;
    },
    async setMuted(muted) {
      await run([`set volume output muted ${muted}`]);
    },
    async media(action) {
      const app = await player();
      const verb = { playpause: 'playpause', play: 'play', pause: 'pause', next: 'next track', previous: 'previous track' }[action];
      await run(['on run argv', `tell application (item 1 of argv) to ${verb}`, 'end run'], [app]);
      return app;
    },
    async nowPlaying() {
      for (const app of ['Spotify', 'Music']) {
        if (!(await isRunning(app).catch(() => false))) continue;
        const out = await query(
          [
            'on run argv',
            'tell application (item 1 of argv)',
            'if player state is stopped then return ""',
            'return (name of current track) & linefeed & (artist of current track)',
            'end tell',
            'end run',
          ],
          [app],
        ).catch(() => '');
        const [title, artist] = out.split('\n');
        if (title) return { title, artist: artist ?? '', player: app };
      }
      return null;
    },
    async installedApps() {
      const dirs = [...MAC_APP_DIRS, path.join(os.homedir(), 'Applications')];
      const names = await Promise.all(
        dirs.map(async (dir) =>
          (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.app')).map((f) => f.slice(0, -4)),
        ),
      );
      return [...new Set(names.flat())].sort();
    },
    async runningApps() {
      const out = await query(['tell application "System Events" to get name of every application process whose background only is false']);
      return out ? out.split(', ').filter(Boolean) : [];
    },
    async openApp(name) {
      await launcher.run(['open', '-a', name]);
    },
    async focusApp(name) {
      await run(['on run argv', 'tell application (item 1 of argv) to activate', 'end run'], [name]);
    },
    async quitApp(name) {
      // Checking first matters: "tell application X to quit" would launch X.
      if (!(await isRunning(name))) return false;
      await run(['on run argv', 'tell application (item 1 of argv) to quit', 'end run'], [name]);
      return true;
    },
    async lockScreen() {
      // ⌃⌘Q needs Accessibility permission; fall back to sleeping the display,
      // which locks when "require password after sleep" is on.
      try {
        await run(['tell application "System Events" to keystroke "q" using {control down, command down}']);
      } catch {
        await launcher.run(['pmset', 'displaysleepnow']);
      }
    },
    async sleepDisplay() {
      await launcher.run(['pmset', 'displaysleepnow']);
    },
    async sleep() {
      await launcher.run(['pmset', 'sleepnow']);
    },
    async setDarkMode(mode) {
      const target = mode === 'toggle' ? 'not dark mode' : String(mode);
      const out = await run([
        'tell application "System Events" to tell appearance preferences',
        `set dark mode to ${target}`,
        'return dark mode',
        'end tell',
      ]);
      return out === '' ? mode !== false : out === 'true';
    },
    readClipboard: () => launcher.run(['pbpaste'], { readOnly: true }),
    async writeClipboard(text) {
      await launcher.run(['pbcopy'], { input: text });
    },
    async screenshot(file) {
      await launcher.run(['screencapture', '-x', file]);
    },
    async notify(title, message) {
      await run(
        ['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"', 'end run'],
        [title, message],
      );
    },
  };
  return control;
}

// --- Linux -----------------------------------------------------------------

function linuxControl(launcher: Launcher): SystemControl {
  const wayland = Boolean(process.env.WAYLAND_DISPLAY);
  const control: SystemControl = {
    platform: 'linux',
    async getVolume() {
      const out = await launcher.run(['pactl', 'get-sink-volume', '@DEFAULT_SINK@'], { readOnly: true });
      const match = /(\d+)%/.exec(out);
      if (!match) throw new Error("The volume couldn't be read");
      return Number(match[1]);
    },
    async setVolume(level) {
      await launcher.run(['pactl', 'set-sink-volume', '@DEFAULT_SINK@', `${clampVolume(level)}%`]);
    },
    async changeVolume(delta) {
      const next = clampVolume((await control.getVolume()) + delta);
      await control.setVolume(next);
      return next;
    },
    async setMuted(muted) {
      await launcher.run(['pactl', 'set-sink-mute', '@DEFAULT_SINK@', muted ? '1' : '0']);
    },
    async media(action) {
      await launcher.run(['playerctl', action === 'playpause' ? 'play-pause' : action]);
      return 'the media player';
    },
    async nowPlaying() {
      const out = await launcher
        .run(['playerctl', 'metadata', '--format', '{{title}}\n{{artist}}\n{{playerName}}'], { readOnly: true })
        .catch(() => '');
      const [title, artist, player] = out.split('\n');
      return title ? { title, artist: artist ?? '', player: player ?? 'player' } : null;
    },
    installedApps: async () => [],
    runningApps: () => Promise.reject(new UnsupportedError('Listing open apps', 'linux')),
    openApp: () => Promise.reject(new UnsupportedError('Opening apps by name', 'linux')),
    focusApp: () => Promise.reject(new UnsupportedError('Switching apps', 'linux')),
    quitApp: () => Promise.reject(new UnsupportedError('Quitting apps', 'linux')),
    async lockScreen() {
      await launcher.run(['loginctl', 'lock-session']);
    },
    async sleepDisplay() {
      await launcher.run(['xset', 'dpms', 'force', 'off']);
    },
    async sleep() {
      await launcher.run(['systemctl', 'suspend']);
    },
    async setDarkMode(mode) {
      const key = ['gsettings', 'get', 'org.gnome.desktop.interface', 'color-scheme'];
      const current = (await launcher.run(key, { readOnly: true })).includes('dark');
      const next = mode === 'toggle' ? !current : mode;
      await launcher.run(['gsettings', 'set', 'org.gnome.desktop.interface', 'color-scheme', next ? 'prefer-dark' : 'default']);
      return next;
    },
    readClipboard: () =>
      launcher.run(wayland ? ['wl-paste', '--no-newline'] : ['xclip', '-selection', 'clipboard', '-o'], { readOnly: true }),
    async writeClipboard(text) {
      await launcher.run(wayland ? ['wl-copy'] : ['xclip', '-selection', 'clipboard'], { input: text });
    },
    async screenshot(file) {
      await launcher.run(wayland ? ['grim', file] : ['gnome-screenshot', '-f', file]);
    },
    async notify(title, message) {
      await launcher.run(['notify-send', '--app-name=ARES', title, message]);
    },
  };
  return control;
}

// --- Windows ---------------------------------------------------------------

function windowsControl(launcher: Launcher): SystemControl {
  // Media and volume keys via WScript.Shell; the key code is the only input.
  const pressKey = (code: number, times = 1) =>
    launcher.run([
      'powershell',
      '-NoProfile',
      '-Command',
      `$s = New-Object -ComObject WScript.Shell; 1..${times} | ForEach-Object { $s.SendKeys([char]${code}) }`,
    ]);
  const unsupported = (feature: string) => () => Promise.reject(new UnsupportedError(feature, 'win32'));

  return {
    platform: 'win32',
    getVolume: unsupported('Reading the volume'),
    setVolume: unsupported('Setting an exact volume'),
    async changeVolume(delta) {
      // Each volume key press moves Windows volume by 2 points.
      await pressKey(delta > 0 ? 175 : 174, Math.min(50, Math.ceil(Math.abs(delta) / 2)));
      return null;
    },
    async setMuted() {
      await pressKey(173);
    },
    async media(action) {
      const code = { playpause: 179, play: 179, pause: 179, next: 176, previous: 177 }[action];
      await pressKey(code);
      return 'the media player';
    },
    nowPlaying: async () => null,
    installedApps: async () => [],
    runningApps: unsupported('Listing open apps'),
    openApp: unsupported('Opening apps by name'),
    focusApp: unsupported('Switching apps'),
    quitApp: unsupported('Quitting apps'),
    async lockScreen() {
      await launcher.run(['rundll32.exe', 'user32.dll,LockWorkStation']);
    },
    sleepDisplay: unsupported('Turning off the display'),
    async sleep() {
      await launcher.run(['rundll32.exe', 'powrprof.dll,SetSuspendState', '0,1,0']);
    },
    async setDarkMode(mode) {
      const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
      let dark = mode === true;
      if (mode === 'toggle') {
        const out = await launcher.run(['reg', 'query', key, '/v', 'AppsUseLightTheme'], { readOnly: true });
        dark = /0x1\b/.test(out);
      }
      const value = dark ? '0' : '1';
      for (const name of ['AppsUseLightTheme', 'SystemUsesLightTheme']) {
        await launcher.run(['reg', 'add', key, '/v', name, '/t', 'REG_DWORD', '/d', value, '/f']);
      }
      return dark;
    },
    readClipboard: () => launcher.run(['powershell', '-NoProfile', '-Command', 'Get-Clipboard -Raw'], { readOnly: true }),
    async writeClipboard(text) {
      await launcher.run(['powershell', '-NoProfile', '-Command', '$input | Set-Clipboard'], { input: text });
    },
    screenshot: unsupported('Taking screenshots'),
    notify: async () => {}, // the dashboard shows and speaks alerts
  };
}

function clampVolume(level: number): number {
  return Math.max(0, Math.min(100, Math.round(level)));
}
