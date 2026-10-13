/**
 * Example drop-in plugin. Any .ts/.js file in server/plugins/ is loaded at
 * startup; export a hook (or an array of hooks) as the default export.
 * Files starting with "_" are ignored.
 */
import { patterns } from '../src/core/intent.js';
import { defineHook } from '../src/core/types.js';

const coinFlip = defineHook({
  name: 'fun.coin',
  category: 'Fun',
  description: 'Flip a coin',
  examples: ['Flip a coin'],
  match: patterns(/^(?:flip|toss) a coin$/i, /^heads or tails$/i),
  run: () => ({ speech: Math.random() < 0.5 ? 'Heads.' : 'Tails.' }),
});

const diceRoll = defineHook({
  name: 'fun.dice',
  category: 'Fun',
  description: 'Roll a die, e.g. a d20',
  examples: ['Roll a die', 'Roll a d20'],
  match: patterns(/^roll (?:a |one )?(?:die|dice|d(?<sides>\d{1,3}))$/i),
  run: ({ sides }) => {
    const n = Math.max(2, Number(sides ?? 6));
    return { speech: `${1 + Math.floor(Math.random() * n)}.` };
  },
});

export default [coinFlip, diceRoll];
