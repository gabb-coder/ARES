import { all, create, type MathJsInstance } from 'mathjs';
import { defineHook } from '../core/types.js';

const math: MathJsInstance = create(all!);
const evaluate = math.evaluate.bind(math);
const format = math.format.bind(math);
// Lock down what spoken input can reach (per mathjs's security guidance).
const blocked = () => {
  throw new Error('Function disabled');
};
math.import(
  { import: blocked, createUnit: blocked, evaluate: blocked, parse: blocked, simplify: blocked, derivative: blocked, resolve: blocked },
  { override: true },
);

/** Spoken unit names → mathjs units. Longest phrases first. */
const UNIT_SYNONYMS: Array<[RegExp, string]> = [
  [/\bdegrees? (?:fahrenheit|f)\b|\bfahrenheit\b/gi, 'degF'],
  [/\bdegrees? (?:celsius|centigrade|c)\b|\bcelsius\b|\bcentigrade\b/gi, 'degC'],
  [/\bkelvins?\b/gi, 'K'],
  [/\bmiles? (?:per|an|a) hour\b|\bmph\b/gi, 'mi/h'],
  [/\bkilomet(?:er|re)s? (?:per|an|a) hour\b|\bkph\b|\bkmh\b|\bkm\/hr?\b/gi, 'km/h'],
  [/\bmet(?:er|re)s? (?:per|a) second\b/gi, 'm/s'],
  [/\bfluid ounces?\b|\bfl\.? ?oz\b/gi, 'floz'],
  [/\bsquare (feet|foot|inch(?:es)?|yards?|miles?|met(?:er|re)s?|kilomet(?:er|re)s?|centimet(?:er|re)s?)\b/gi, '$1^2'],
  [/\bcubic (feet|foot|inch(?:es)?|yards?|met(?:er|re)s?|centimet(?:er|re)s?)\b/gi, '$1^3'],
  [/\bpounds?\b|\blbs\b/gi, 'lb'],
  [/\btbsp\b/gi, 'tablespoon'],
  [/\btsp\b/gi, 'teaspoon'],
  [/metres\b/gi, 'meters'],
  [/metre\b/gi, 'meter'],
  [/litres\b/gi, 'liters'],
  [/litre\b/gi, 'liter'],
];

/** Human names for units mathjs prints, so TTS doesn't spell out "k g". */
const SPOKEN_UNITS: Record<string, string> = {
  degF: 'degrees Fahrenheit',
  degC: 'degrees Celsius',
  K: 'kelvin',
  lb: 'pounds',
  oz: 'ounces',
  floz: 'fluid ounces',
  'mi / h': 'miles per hour',
  'km / h': 'kilometers per hour',
  'm / s': 'meters per second',
  km: 'kilometers',
  m: 'meters',
  cm: 'centimeters',
  mm: 'millimeters',
  mi: 'miles',
  ft: 'feet',
  in: 'inches',
  yd: 'yards',
  kg: 'kilograms',
  g: 'grams',
  mg: 'milligrams',
  l: 'liters',
  L: 'liters',
  ml: 'milliliters',
  mL: 'milliliters',
  h: 'hours',
  min: 'minutes',
  s: 'seconds',
  KB: 'kilobytes',
  MB: 'megabytes',
  GB: 'gigabytes',
  TB: 'terabytes',
};

function speakUnit(unit: string, value: number): string {
  const power = /^(.+)\^([23])$/.exec(unit);
  const base = power ? power[1]! : unit;
  let name = SPOKEN_UNITS[base] ?? base;
  if (power) name = `${power[2] === '2' ? 'square' : 'cubic'} ${name}`;
  // "1 kilometers" → "1 kilometer"; "feet"/"inches" have irregular singulars.
  if (Math.abs(value) === 1) name = name.replace(/\bfeet$/, 'foot').replace(/inches$/, 'inch').replace(/(?<!s)s$/, '');
  return name;
}

const OPERATOR_HINT = /[+\-*/^%]|\b(?:sqrt|cbrt)\(|\bto\b/i;

/**
 * Turns spoken arithmetic and conversions into a mathjs expression:
 * "15 percent of 240" → "(15/100)*240", "how many cups in a liter" → "1 liter to cups".
 */
export function toExpression(spoken: string): string | null {
  // Case is kept: mathjs units are case-sensitive (TB vs tb, mL, K).
  let s = spoken
    .trim()
    .replace(/^(?:what(?:'s| is)|calculate|compute|how much is|solve|evaluate|convert|work out)\s+/i, '')
    .replace(/[?=]+$/, '')
    .replace(/,(?=\d{3}\b)/g, '') // 1,000 → 1000
    .trim();

  const howMany = /^how many (?<target>.+?) (?:are )?(?:in|per) (?<source>.+)$/i.exec(s);
  if (howMany?.groups) s = `${howMany.groups.source} to ${howMany.groups.target}`;

  s = s
    .replace(/\b(?:an?|one) (?=[a-z])/gi, '1 ')
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent) off (?:of )?/gi, '(1-$1/100)*')
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent) of /gi, '($1/100)*')
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\b/gi, '($1/100)')
    .replace(/\b(?:the )?square root of (\d+(?:\.\d+)?|\([^)]*\))/gi, 'sqrt($1)')
    .replace(/\b(?:the )?cube root of (\d+(?:\.\d+)?|\([^)]*\))/gi, 'cbrt($1)')
    .replace(/\bsquared\b/gi, '^2')
    .replace(/\bcubed\b/gi, '^3')
    .replace(/\bto the power of\b|\braised to(?: the)?\b/gi, '^')
    .replace(/\bplus\b/gi, '+')
    .replace(/\bminus\b/gi, '-')
    .replace(/\b(?:times|multiplied by)\b|(?<=\d)\s*x\s*(?=\d)/gi, '*')
    .replace(/\b(?:divided by|over)\b/gi, '/');

  for (const [re, unit] of UNIT_SYNONYMS) s = s.replace(re, unit);
  // "72 degF in degC" → "72 degF to degC" (only when there's no "to" already).
  if (!/\bto\b/i.test(s)) s = s.replace(/ in (?=[a-z][a-z^/0-9 ]*$)/i, ' to ');
  s = s.replace(/\s+/g, ' ').trim();

  if (!/\d/.test(s) || !/^[\w\s.+\-*/^()%,]+$/.test(s)) return null;
  return s;
}

export interface Calculation {
  expression: string;
  /** Spoken answer, e.g. "8.05 kilometers". */
  answer: string;
  isConversion: boolean;
}

/** Evaluates spoken math; null when it isn't math (so other hooks can try). */
export function calculate(spoken: string, requireOperator = false): Calculation | null {
  const expression = toExpression(spoken);
  if (!expression) return null;
  if (requireOperator && !OPERATOR_HINT.test(expression)) return null;

  // Try as spoken, then lowercased ("5 Miles" → "5 miles"; "1 TB" must stay as is).
  let result: unknown = null;
  let used = expression;
  for (const candidate of new Set([expression, expression.toLowerCase()])) {
    try {
      result = evaluate(candidate);
      used = candidate;
      break;
    } catch {
      result = null;
    }
  }
  if (result === null) return null;
  const isConversion = /\bto\b/i.test(used);
  if (typeof result === 'number') {
    if (!Number.isFinite(result)) return null;
    return { expression: used, answer: speakNumber(result), isConversion };
  }
  if (math.isUnit(result)) {
    const formatted = format(result, { precision: 4, lowerExp: -6, upperExp: 12 });
    const match = /^(-?[\d.e+-]+)\s+(.+)$/.exec(formatted);
    if (!match) return null;
    const value = Number(match[1]);
    return { expression: used, answer: `${speakNumber(value)} ${speakUnit(match[2]!, value)}`, isConversion };
  }
  return null;
}

function speakNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toLocaleString('en-US');
  const rounded = Number(n.toPrecision(Math.abs(n) >= 1 ? 6 : 4));
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 10 });
}

export const calculatorHook = defineHook<{ calc: Calculation }>({
  name: 'math.calculate',
  category: 'Math',
  description: 'Calculate and convert units',
  examples: ["What's 15% of 240?", 'Convert 5 miles to kilometers', '72 Fahrenheit in Celsius'],
  // Below the specific hooks: "what's the volume" must never become math.
  priority: -5,
  match: (input) => {
    const explicit = /^(?:what(?:'s| is)|calculate|compute|how much is|how many|solve|evaluate|convert|work out)\b/i.test(input);
    // Bare phrases ("12 times 7") need an operator so "10 minutes" isn't hijacked.
    const calc = calculate(input, !explicit);
    return calc ? { calc } : null;
  },
  run: ({ calc }) => ({
    speech: `${calc.answer}.`,
    card: { title: calc.isConversion ? 'Conversion' : 'Calculation', fields: [{ label: calc.expression, value: calc.answer }] },
  }),
});

export const mathHooks = [calculatorHook];
