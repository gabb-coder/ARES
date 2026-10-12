const UNITS: Record<string, number> = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000 };

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, couple: 2, few: 3,
};

const NUMBER = String.raw`\d+(?:\.\d+)?|(?:twenty|thirty|forty|fifty)[ -](?:one|two|three|four|five|six|seven|eight|nine)|${Object.keys(WORD_NUMBERS).join('|')}`;
const UNIT = String.raw`sec(?:ond)?s?|min(?:ute)?s?|h(?:ou)?rs?|hours?|days?`;
const PART_RE = new RegExp(String.raw`(?<n>${NUMBER})(?:\s+of(?:\s+an?)?)?\s*-?\s*(?<unit>${UNIT})(?<half>\s+and\s+a\s+half)?`, 'gi');

/** A duration phrase: "10 minutes", "an hour and a half", "1 hour 30 minutes", "half an hour". */
export const DURATION_PATTERN = String.raw`(?:(?:half an? (?:hour|minute))|(?:(?:${NUMBER})(?:\s+of(?:\s+an?)?)?\s*-?\s*(?:${UNIT})(?:\s+and\s+a\s+half)?)(?:(?:,?\s*(?:and\s+)?)(?:${NUMBER})\s*-?\s*(?:${UNIT}))*)`;

function toNumber(word: string): number {
  const lower = word.toLowerCase();
  if (/^\d/.test(lower)) return Number(lower);
  const [tens, ones] = lower.split(/[ -]/);
  if (ones) return (WORD_NUMBERS[tens!] ?? 0) + (WORD_NUMBERS[ones] ?? 0);
  return WORD_NUMBERS[lower] ?? NaN;
}

function unitMs(unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith('s')) return UNITS.second!;
  if (u.startsWith('m')) return UNITS.minute!;
  if (u.startsWith('h')) return UNITS.hour!;
  return UNITS.day!;
}

/** Parses a spoken duration into milliseconds, or null if there isn't one. */
export function parseDuration(text: string): number | null {
  const half = /\bhalf an? (hour|minute)\b/i.exec(text);
  if (half && !/\band a half\b/i.test(text)) return unitMs(half[1]!) / 2;

  let total = 0;
  for (const m of text.matchAll(PART_RE)) {
    const n = toNumber(m.groups!.n!);
    if (!Number.isFinite(n)) continue;
    const ms = unitMs(m.groups!.unit!);
    total += n * ms + (m.groups!.half ? ms / 2 : 0);
  }
  return total > 0 ? Math.round(total) : null;
}

/** 330_000 → "5 minutes 30 seconds"; rounds to what is worth saying aloud. */
export function formatDuration(ms: number): string {
  let seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds >= 3600) seconds = Math.round(seconds / 60) * 60; // drop seconds past an hour
  const parts: string[] = [];
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d) parts.push(plural(d, 'day'));
  if (h) parts.push(plural(h, 'hour'));
  if (m) parts.push(plural(m, 'minute'));
  if (s && !d) parts.push(plural(s, 'second'));
  return parts.join(' ') || '0 seconds';
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}
