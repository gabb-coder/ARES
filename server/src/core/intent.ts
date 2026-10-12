import type { HookParams } from './types.js';

// Speech engines commonly mis-hear "Ares" as one of these.
const WAKE_WORD = String.raw`(?:hey\s+|ok(?:ay)?\s+|yo\s+)?(?:ares|aries|ayres|arees|eris)\b[\s,.!:;-]*`;
const WAKE_RE = new RegExp(`^${WAKE_WORD}`, 'i');

const LEADING_FILLER = new RegExp(
  '^(?:' +
    [
      'please',
      'can you',
      'could you',
      'would you',
      'will you',
      'would you mind',
      'i want you to',
      'i would like you to',
      "i'd like you to",
      'i need you to',
      'go ahead and',
      'just',
      'quickly',
    ].join('|') +
    String.raw`)\b[\s,]*`,
  'i',
);

const TRAILING_FILLER = /[\s,]+(?:please|for me|thanks|thank you|now|right now)$/i;

/**
 * Normalizes a raw transcript into something hooks can pattern-match against:
 * strips the wake word, politeness filler and trailing punctuation, and collapses
 * whitespace. Case is preserved so file names survive; match with the `i` flag.
 */
export function normalizeUtterance(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  text = text.replace(WAKE_RE, '');

  // Strip repeatedly: "please, could you just ..." has several layers.
  let previous: string;
  do {
    previous = text;
    text = text.replace(LEADING_FILLER, '').replace(TRAILING_FILLER, '').trim();
    text = text.replace(/[\s.?!,;:]+$/, '');
  } while (text !== previous);

  return text;
}

/**
 * Builds a `match` function from regular expressions. The first pattern that
 * matches wins, and its named groups become the hook's parameters.
 */
export function patterns(...regexes: RegExp[]): (input: string) => HookParams | null {
  return (input) => {
    for (const re of regexes) {
      const m = re.exec(input);
      if (m) return { ...(m.groups ?? {}) };
    }
    return null;
  };
}

/** Converts spoken file names ("notes dot txt") into their written form. */
export function spokenToFilename(text: string): string {
  return text
    .trim()
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s+(?:underscore)\s+/gi, '_')
    .replace(/\s+(?:dash|hyphen)\s+/gi, '-')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
}
