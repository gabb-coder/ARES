import { patterns } from '../core/intent.js';
import { defineHook } from '../core/types.js';
import { PERSONA, phrases } from '../persona.js';

export const identityHook = defineHook({
  name: 'ares.identity',
  category: 'ARES',
  description: 'Introduce ARES',
  examples: ['Who are you?', "What's your name?"],
  match: patterns(
    /^(?:who|what) are you$/i,
    /^what(?:'s| is) your name$/i,
    /^(?:introduce|identify) yourself$/i,
  ),
  run: () => ({
    speech: `I'm ${PERSONA.name}. I run on this machine and handle files, network checks, apps and the web.`,
  }),
});

export const greetingHook = defineHook({
  name: 'ares.greeting',
  category: 'ARES',
  description: 'Greet ARES',
  examples: ['Hello', 'Good morning'],
  match: patterns(/^(?:hi|hello|hey|yo|greetings|good (?:morning|afternoon|evening))(?: there)?$/i),
  run: () => ({ speech: phrases.greeting() }),
});

export const wellbeingHook = defineHook({
  name: 'ares.status',
  category: 'ARES',
  description: 'Ask how ARES is doing',
  examples: ['How are you?', 'Status report'],
  match: patterns(/^how are you(?: doing)?(?: today)?$/i, /^(?:status report|are you (?:there|online|awake))$/i),
  run: () => ({ speech: 'All systems nominal.' }),
});

export const thanksHook = defineHook({
  name: 'ares.thanks',
  category: 'ARES',
  description: 'Thank ARES',
  examples: ['Thank you', 'Nice work'],
  match: patterns(/^(?:thanks|thank you|cheers|nice work|good job|well done|perfect|great)$/i),
  run: () => ({ speech: phrases.thanks() }),
});

export const helpHook = defineHook({
  name: 'ares.help',
  category: 'ARES',
  description: 'List what ARES can do',
  examples: ['Help', 'What can you do?'],
  match: patterns(
    /^(?:help|commands|capabilities|options)$/i,
    /^what (?:can|do) you do$/i,
    /^(?:list|show)(?: me)?(?: your| the)? (?:commands|capabilities|hooks)$/i,
  ),
  run: (_params, ctx) => {
    const hooks = ctx.hooks();
    const categories = [...new Set(hooks.map((h) => h.category))].filter((c) => c !== 'ARES');
    return {
      speech: `I handle ${listify(categories.map((c) => c.toLowerCase()))}. Commands are on screen.`,
      card: {
        title: 'Commands',
        items: hooks.filter((h) => h.examples[0]).map((h) => `${h.examples[0]} — ${h.description}`),
      },
    };
  },
});

function listify(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

export const aresHooks = [identityHook, greetingHook, wellbeingHook, thanksHook, helpHook];
