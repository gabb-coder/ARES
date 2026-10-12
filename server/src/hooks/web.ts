import { patterns } from '../core/intent.js';
import { defineHook } from '../core/types.js';

/** Spoken site names → URLs. Extend freely. */
export const SITES: Record<string, string> = {
  google: 'https://www.google.com',
  gmail: 'https://mail.google.com',
  'google maps': 'https://maps.google.com',
  maps: 'https://maps.google.com',
  'google drive': 'https://drive.google.com',
  drive: 'https://drive.google.com',
  'google calendar': 'https://calendar.google.com',
  calendar: 'https://calendar.google.com',
  youtube: 'https://www.youtube.com',
  github: 'https://github.com',
  'stack overflow': 'https://stackoverflow.com',
  reddit: 'https://www.reddit.com',
  wikipedia: 'https://en.wikipedia.org',
  'hacker news': 'https://news.ycombinator.com',
  twitter: 'https://x.com',
  x: 'https://x.com',
  linkedin: 'https://www.linkedin.com',
  netflix: 'https://www.netflix.com',
  amazon: 'https://www.amazon.com',
  claude: 'https://claude.ai',
  'spotify web': 'https://open.spotify.com',
  weather: 'https://weather.com',
  news: 'https://news.google.com',
};

/** Search URL templates; `%s` is replaced with the encoded query. */
export const SEARCH_ENGINES: Record<string, string> = {
  google: 'https://www.google.com/search?q=%s',
  youtube: 'https://www.youtube.com/results?search_query=%s',
  wikipedia: 'https://en.wikipedia.org/w/index.php?search=%s',
  github: 'https://github.com/search?q=%s',
  duckduckgo: 'https://duckduckgo.com/?q=%s',
  amazon: 'https://www.amazon.com/s?k=%s',
  reddit: 'https://www.reddit.com/search/?q=%s',
  maps: 'https://www.google.com/maps/search/%s',
};
const ENGINE_NAMES = Object.keys(SEARCH_ENGINES).join('|');

/**
 * Turns a spoken target into a URL: a known site name, a domain ("github dot
 * com"), or a full URL. Returns null for anything else so other hooks (or the
 * LLM fallback) can have it.
 */
export function resolveUrl(spoken: string): string | null {
  const target = cleanTarget(spoken);

  const site = SITES[target.toLowerCase()];
  if (site) return site;

  const written = target.replace(/\s*\bdot\b\s*/gi, '.').replace(/\s*\bslash\b\s*/gi, '/');
  const candidate = /^https?:\/\//i.test(written) ? written : `https://${written}`;
  if (/\s/.test(written)) return null;
  try {
    const url = new URL(candidate);
    // Require a real-looking host: "name.tld" with an alphabetic TLD (or localhost).
    if (url.hostname !== 'localhost' && !/\.[a-z]{2,}$/.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** "the GitHub website" → "GitHub" */
function cleanTarget(spoken: string): string {
  return spoken
    .trim()
    .replace(/^(?:the|my)\s+/i, '')
    .replace(/\s+(?:website|site|web ?page|page|homepage)$/i, '');
}

export function searchUrl(query: string, engine = 'google'): string {
  const template = SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.google!;
  return template.replace('%s', encodeURIComponent(query.trim()));
}

const openPatterns = patterns(
  /^(?:open|launch|go to|navigate to|visit|pull up|bring up|load|take me to)(?: up)? (?<target>.+?)(?: in (?:the |my )?browser)?$/i,
);

export const openUrlHook = defineHook<{ url: string; label: string }>({
  name: 'web.open',
  category: 'Web',
  description: 'Open a website in the default browser',
  examples: ['Open YouTube', 'Go to github dot com'],
  priority: -10,
  match: (input) => {
    const spoken = openPatterns(input)?.target;
    const url = spoken ? resolveUrl(spoken) : null;
    if (!spoken || !url) return null;
    // Known sites keep their spoken name; domains are announced by host.
    const name = cleanTarget(spoken);
    return { url, label: SITES[name.toLowerCase()] ? titleCase(name) : new URL(url).host.replace(/^www\./, '') };
  },
  run: async ({ url, label }, ctx) => {
    await ctx.launcher.openUrl(url);
    return { speech: `Opening ${label}.`, card: { title: 'Opened in browser', link: url } };
  },
});

export const webSearchHook = defineHook({
  name: 'web.search',
  category: 'Web',
  description: 'Search the web (Google, YouTube, Wikipedia, GitHub and more)',
  examples: ['Search for the best espresso grinder', 'Search YouTube for lo-fi beats'],
  priority: -10,
  match: patterns(
    new RegExp(String.raw`^(?:search|look up|find) (?<engine>${ENGINE_NAMES}) for (?<query>.+)$`, 'i'),
    new RegExp(String.raw`^(?:search(?: the web)?(?: for)?|google|look up|search online for|web search(?: for)?) (?<query>.+?)(?: on (?<engine>${ENGINE_NAMES}))?$`, 'i'),
    /^play (?<query>.+?) on (?<engine>youtube)$/i,
  ),
  run: async ({ query, engine }, ctx) => {
    const name = (engine ?? 'google').toLowerCase();
    const url = searchUrl(query ?? '', name);
    await ctx.launcher.openUrl(url);
    return {
      speech: `Searching ${titleCase(name)} for ${query}.`,
      card: { title: `${titleCase(name)} search`, body: query, link: url },
    };
  },
});

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

export const webHooks = [openUrlHook, webSearchHook];
