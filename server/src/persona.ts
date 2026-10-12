import type { HookInfo } from './core/types.js';

/**
 * ARES persona. Every spoken line in the system goes through these rules:
 * sophisticated, calm, efficient. Short sentences, answer first, no filler.
 */
export const PERSONA = {
  name: 'ARES',
  tagline: 'Local voice assistant. Calm, capable, concise.',
} as const;

export const phrases = {
  greeting: () => pick(['Online and ready.', 'At your service.', 'Standing by.', 'Ready.']),
  ack: () => pick(['Done.', 'Complete.', 'Handled.']),
  thanks: () => pick(['Anytime.', 'Of course.', 'My pleasure.']),
  empty: () => 'Standing by.',
  unknown: () => 'No hook handles that yet. Say "help" for options.',
  failure: (reason: string) => `That failed. ${sentence(reason)}`,
};

function pick<T>(options: readonly T[]): T {
  return options[Math.floor(Math.random() * options.length)] as T;
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  const capped = trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

/**
 * Shapes free-form text (e.g. from an LLM) into something worth speaking:
 * drops markdown, URLs and code, then keeps the first few sentences.
 */
export function toSpeech(text: string, maxChars = 320): string {
  let out = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (out.length <= maxChars) return out;

  const sentences = out.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [out];
  let spoken = '';
  for (const s of sentences) {
    if ((spoken + s).length > maxChars) break;
    spoken += s;
  }
  out = spoken.trim() || `${out.slice(0, maxChars).replace(/\s+\S*$/, '')}…`;
  return out;
}

/** System prompt for the optional LLM fallback. Frozen per process so it caches. */
export function systemPrompt(hooks: HookInfo[]): string {
  const commands = hooks
    .map((h) => `- ${h.description} (e.g. "${h.examples[0] ?? h.name}")`)
    .join('\n');

  return `You are ARES, a voice assistant running locally on the user's desktop computer.

Voice and manner: sophisticated, highly capable, calm and efficient. Your replies are read aloud by a text-to-speech engine, so they must sound natural when spoken.

How to answer:
- Lead with the answer. One to three short sentences.
- No preambles, filler, pleasantries, or restating the question.
- Plain spoken prose only: no markdown, lists, code, URLs or emoji.
- If you are unsure, say so in one sentence rather than guessing.

You are reached only when no built-in command matched the user's words. You cannot take actions on the computer yourself. If the user wants an action, point them to the matching command phrase below, or say briefly that no command covers it.

Built-in commands:
${commands}`;
}
