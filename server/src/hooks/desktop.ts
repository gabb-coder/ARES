import fs from 'node:fs/promises';
import path from 'node:path';
import { localStamp } from '../core/format.js';
import { patterns } from '../core/intent.js';
import { defineHook } from '../core/types.js';

const DEVICE = String.raw`(?:screen|computer|mac|macbook|laptop|pc|machine|system)`;

export const lockHook = defineHook({
  name: 'power.lock',
  category: 'Power',
  description: 'Lock the screen',
  examples: ['Lock my screen'],
  match: patterns(new RegExp(String.raw`^lock(?: the| my)? ${DEVICE}$`, 'i'), /^lock(?: it| up)?$/i),
  run: async (_params, ctx) => {
    await ctx.system.lockScreen();
    return { speech: 'Locking.' };
  },
});

export const displaySleepHook = defineHook({
  name: 'power.display',
  category: 'Power',
  description: 'Turn the display off',
  examples: ['Turn off the display'],
  match: patterns(
    /^(?:turn off|switch off|sleep|blank)(?: the| my)? (?:display|screen|monitor)s?$/i,
    /^put(?: the| my)? (?:display|screen|monitor)s? to sleep$/i,
  ),
  run: async (_params, ctx) => {
    await ctx.system.sleepDisplay();
    return { speech: 'Display off.' };
  },
});

export const sleepHook = defineHook({
  name: 'power.sleep',
  category: 'Power',
  description: 'Put the computer to sleep',
  examples: ['Put the computer to sleep'],
  match: patterns(
    new RegExp(String.raw`^put(?: the| my)? ${DEVICE} to sleep$`, 'i'),
    new RegExp(String.raw`^sleep(?: the| my)? ${DEVICE}$`, 'i'),
    /^go to sleep$/i,
  ),
  run: async (_params, ctx) => {
    // Speak first: once the machine sleeps, there's no reply.
    setTimeout(() => void ctx.system.sleep().catch((err) => ctx.log.warn(`sleep failed: ${err.message}`)), 2500);
    return { speech: 'Going to sleep.' };
  },
});

export const darkModeHook = defineHook<{ mode: boolean | 'toggle' }>({
  name: 'appearance.darkMode',
  category: 'Power',
  description: 'Toggle dark mode',
  examples: ['Toggle dark mode', 'Turn on light mode'],
  match: (input) => {
    const m =
      /^(?:(?<verb>toggle|switch|flip|turn|enable|disable|use|go)(?: (?<pre>on|off|to))? )?(?:the )?(?<theme>dark|light) (?:mode|theme)(?: (?<post>on|off))?$/i.exec(input);
    if (!m?.groups) return null;
    const { verb = '', pre = '', post = '', theme } = m.groups;
    const v = verb.toLowerCase();
    if ((v === 'toggle' || v === 'flip' || v === 'switch') && !pre && !post) return { mode: 'toggle' };
    const off = v === 'disable' || pre.toLowerCase() === 'off' || post.toLowerCase() === 'off';
    const dark = theme!.toLowerCase() === 'dark';
    return { mode: off ? !dark : dark };
  },
  run: async ({ mode }, ctx) => {
    const dark = await ctx.system.setDarkMode(mode);
    return { speech: dark ? 'Dark mode on.' : 'Light mode on.' };
  },
});

const MAX_SPOKEN_CLIPBOARD = 280;

export const readClipboardHook = defineHook({
  name: 'clipboard.read',
  category: 'Clipboard',
  description: 'Read the clipboard aloud',
  examples: ['Read my clipboard'],
  match: patterns(
    /^(?:read|show)(?: me)?(?: my| the)? clipboard$/i,
    /^what(?:'s| is)(?: on| in)(?: my| the)? clipboard$/i,
    /^what did I copy$/i,
  ),
  run: async (_params, ctx) => {
    const text = (await ctx.system.readClipboard()).trim();
    if (!text) return { speech: 'The clipboard is empty.' };
    const card = { title: 'Clipboard', body: text.slice(0, 8000) };
    if (text.length <= MAX_SPOKEN_CLIPBOARD) return { speech: text, card };
    return { speech: `${text.length} characters on the clipboard. It's on screen.`, card };
  },
});

export const copyHook = defineHook({
  name: 'clipboard.copy',
  category: 'Clipboard',
  description: 'Copy text to the clipboard',
  examples: ['Copy hello world to the clipboard'],
  match: patterns(/^copy (?<text>.+?) to(?: my| the)? clipboard$/i),
  run: async ({ text }, ctx) => {
    await ctx.system.writeClipboard(text ?? '');
    return { speech: 'Copied.', card: { title: 'Copied to clipboard', body: text } };
  },
});

export const screenshotHook = defineHook({
  name: 'screen.capture',
  category: 'Clipboard',
  description: 'Take a screenshot (saved to the Desktop)',
  examples: ['Take a screenshot'],
  match: patterns(
    /^(?:take|grab|capture|make|snap)(?: a| me a)? (?:screenshot|screen ?shot|screen capture|screen grab)$/i,
    /^(?:screenshot|screen ?shot)(?: (?:this|that|the screen))?$/i,
    /^capture(?: the| my)? screen$/i,
  ),
  run: async (_params, ctx) => {
    const desktop = await ctx.fs.location('desktop');
    const dir = (await fs.stat(desktop).catch(() => null))?.isDirectory() ? desktop : ctx.fs.root;
    const file = path.join(dir, `ARES Screenshot ${localStamp(new Date(), '.').replace(' ', ' at ')}.png`);
    await ctx.system.screenshot(file);
    return { speech: 'Screenshot saved.', card: { title: 'Screenshot', items: [ctx.fs.display(file)] } };
  },
});

export const desktopHooks = [lockHook, displaySleepHook, sleepHook, darkModeHook, readClipboardHook, copyHook, screenshotHook];
