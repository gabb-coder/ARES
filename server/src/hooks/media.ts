import { patterns } from '../core/intent.js';
import { defineHook } from '../core/types.js';
import type { MediaAction } from '../services/system.js';

const STEP = 10;
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, max: 100, maximum: 100, half: 50,
};

export const volumeHook = defineHook({
  name: 'media.volume',
  category: 'Media',
  description: 'Set, raise, lower or report the volume',
  examples: ['Volume to 40', 'Turn it up', "What's the volume?"],
  match: patterns(
    /^(?:set |change |turn )?(?:the )?(?:volume|sound)(?: level)? (?:to |at )?(?<level>\d{1,3}|zero|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|max(?:imum)?|half)(?: ?%| percent)?$/i,
    /^(?:turn|crank|bring) (?:it|the volume|the sound|the music) (?<direction>up|down)(?: a (?<amount>bit|little|lot))?$/i,
    /^(?:volume|sound) (?<direction>up|down)$/i,
    /^(?<word>louder|quieter|softer)$/i,
    /^(?:what(?:'s| is) the |current )?volume(?: level)?$/i,
  ),
  run: async ({ level, direction, amount, word }, ctx) => {
    if (level !== undefined) {
      const value = NUMBER_WORDS[level.toLowerCase()] ?? Number(level);
      await ctx.system.setVolume(value);
      return { speech: `Volume ${Math.min(100, value)}.` };
    }
    if (direction || word) {
      const up = direction ? direction.toLowerCase() === 'up' : word!.toLowerCase() === 'louder';
      const step = amount === 'lot' ? STEP * 2 : amount ? STEP / 2 : STEP;
      const now = await ctx.system.changeVolume(up ? step : -step);
      return { speech: now === null ? (up ? 'Louder.' : 'Quieter.') : `Volume ${now}.` };
    }
    return { speech: `Volume is at ${await ctx.system.getVolume()}.` };
  },
});

export const muteHook = defineHook({
  name: 'media.mute',
  category: 'Media',
  description: 'Mute or unmute the computer',
  examples: ['Mute', 'Unmute'],
  match: patterns(/^(?<action>mute|unmute|silence)(?: (?:the )?(?:sound|volume|audio|computer|mac|speakers))?$/i),
  run: async ({ action }, ctx) => {
    const muted = action!.toLowerCase() !== 'unmute';
    await ctx.system.setMuted(muted);
    return { speech: muted ? 'Muted.' : 'Sound on.' };
  },
});

const MEDIA_TARGET = String.raw`(?: (?:the )?(?:music|song|track|playback|spotify|audio|podcast))?`;

export const playbackHook = defineHook<{ action: MediaAction }>({
  name: 'media.playback',
  category: 'Media',
  description: 'Play, pause and skip music (Spotify or Apple Music)',
  examples: ['Pause the music', 'Next song'],
  match: (input) => {
    if (new RegExp(`^(?:pause|stop|hold)${MEDIA_TARGET}$`, 'i').test(input)) return { action: 'pause' };
    if (new RegExp(`^(?:play|resume|continue|unpause)${MEDIA_TARGET}$`, 'i').test(input)) return { action: 'play' };
    if (/^(?:next|skip)(?: (?:the )?(?:song|track|this(?: song)?|one))?$/i.test(input)) return { action: 'next' };
    if (/^(?:previous|last|go back(?: a)?|back)(?: (?:the )?(?:song|track))$|^previous$/i.test(input)) return { action: 'previous' };
    return null;
  },
  run: async ({ action }, ctx) => {
    const player = await ctx.system.media(action);
    const speech = { play: 'Playing.', pause: 'Paused.', playpause: 'Done.', next: 'Skipping.', previous: 'Going back.' }[action];
    return { speech, card: { title: player, items: [action] } };
  },
});

export const nowPlayingHook = defineHook({
  name: 'media.nowPlaying',
  category: 'Media',
  description: "Say what's playing",
  examples: ["What's playing?"],
  match: patterns(
    /^what(?:'s| is)(?: this| the)?(?: song| track)?(?: that's)? playing(?: now)?$/i,
    /^what(?:'s| is) (?:this|the) (?:song|track)$/i,
    /^what song is (?:this|playing)$/i,
    /^who(?:'s| is) (?:this|singing|playing)$/i,
  ),
  run: async (_params, ctx) => {
    const now = await ctx.system.nowPlaying();
    if (!now) return { ok: false, speech: 'Nothing is playing.' };
    return {
      speech: now.artist ? `${now.title}, by ${now.artist}.` : `${now.title}.`,
      card: { title: `Now playing · ${now.player}`, fields: [{ label: 'Track', value: now.title }, { label: 'Artist', value: now.artist || '—' }] },
    };
  },
});

export const mediaHooks = [volumeHook, muteHook, playbackHook, nowPlayingHook];
