import { beforeAll, describe, expect, it } from 'vitest';
import { normalizeUtterance } from '../src/core/intent.js';
import type { HookContext } from '../src/core/types.js';
import type { Runtime } from '../src/runtime.js';
import { recordingLauncher, silentLog, testRuntime } from './helpers.js';

let rt: Runtime;

beforeAll(async () => {
  ({ rt } = await testRuntime({ apps: { calculator: ['calc'], 'vs code': ['code'] } }));
});

function route(utterance: string): string | null {
  const input = normalizeUtterance(utterance);
  const ctx: HookContext = {
    utterance,
    input,
    config: rt.config,
    log: silentLog,
    fs: rt.fs,
    launcher: recordingLauncher(),
    system: rt.system,
    apps: rt.apps,
    scheduler: rt.scheduler,
    hooks: () => rt.registry.list(),
  };
  return rt.registry.resolve(input, ctx)?.hook.name ?? null;
}

// The intent table: what users say → which hook must handle it.
const TABLE: Array<[string, string | null]> = [
  ['Who are you?', 'ares.identity'],
  ['Hey ARES', null],
  ['Hello there', 'ares.greeting'],
  ['ARES, help', 'ares.help'],
  ['what can you do', 'ares.help'],
  ['thank you', 'ares.thanks'],
  ['What time is it?', 'system.time'],
  ["what's the date today", 'system.date'],
  ['system status', 'system.status'],
  ['how much memory am I using', 'system.status'],

  ['list files in my downloads folder', 'fs.list'],
  ['show me the files on the desktop', 'fs.list'],
  ["what's in documents", 'fs.list'],
  ['read file notes dot txt in documents', 'fs.read'],
  ['read todo.md', 'fs.read'],
  ['create a folder called projects on my desktop', 'fs.mkdir'],
  ['make a new directory named archive', 'fs.mkdir'],
  ['create a file called todo.txt with buy milk', 'fs.touch'],
  ['take a note: call the bank tomorrow', 'fs.note'],
  ['remember that the meeting moved to Friday', 'fs.note'],
  ['find files named invoice in documents', 'fs.search'],
  ['search for files called report', 'fs.search'],
  ["where's budget.xlsx", 'fs.search'],
  ['open my downloads folder', 'fs.open'],
  ['open documents', 'fs.open'],
  ['open file report.pdf in documents', 'fs.open'],

  ['check network status', 'net.status'],
  ['am I online', 'net.status'],
  ['is the internet working', 'net.status'],
  ["what's my IP address", 'net.ip'],
  ["what's my public ip", 'net.ip'],
  ['ping github.com', 'net.ping'],
  ['is google dot com up', 'net.ping'],

  ['open calculator', 'app.launch'],
  ['launch VS Code', 'app.launch'],

  ['open YouTube', 'web.open'],
  ['go to github dot com', 'web.open'],
  ['open https://example.com/docs', 'web.open'],
  ['visit the hacker news website', 'web.open'],
  ['search for the best espresso grinder', 'web.search'],
  ['search YouTube for lo-fi beats', 'web.search'],
  ['google how tall is mount everest', 'web.search'],
  ['play daft punk on youtube', 'web.search'],

  ['set a timer for 10 minutes', 'timer.set'],
  ['set a 5 minute pasta timer', 'timer.set'],
  ['how much time is left', 'timer.status'],
  ['cancel the timer', 'timer.cancel'],
  ['remind me at 3pm to call Sam', 'reminder.set'],
  ['what are my reminders', 'reminder.list'],
  ['cancel my reminder to call Sam', 'reminder.cancel'],
  ["what's the weather", 'weather.forecast'],
  ['will it rain tomorrow', 'weather.forecast'],
  ['do I need an umbrella', 'weather.forecast'],
  ["what's 15% of 240", 'math.calculate'],
  ['convert 5 miles to kilometers', 'math.calculate'],
  ['volume to 40', 'media.volume'],
  ['turn it down', 'media.volume'],
  ['mute', 'media.mute'],
  ['pause the music', 'media.playback'],
  ['next song', 'media.playback'],
  ["what's playing", 'media.nowPlaying'],
  ['lock my screen', 'power.lock'],
  ['turn off the display', 'power.display'],
  ['put the computer to sleep', 'power.sleep'],
  ['toggle dark mode', 'appearance.darkMode'],
  ['read my clipboard', 'clipboard.read'],
  ['copy hello to the clipboard', 'clipboard.copy'],
  ['take a screenshot', 'screen.capture'],

  ['flip a coin', 'fun.coin'],
  ['roll a d20', 'fun.dice'],

  ['open the pod bay doors', null],
  ['what is the meaning of life', null],
];

describe('intent routing', () => {
  it.each(TABLE)('%j → %s', (utterance, hook) => {
    expect(route(utterance)).toBe(hook);
  });
});
