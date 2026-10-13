import { defineHook, type HookContext } from '../core/types.js';

// Open-Meteo: free, no API key. https://open-meteo.com
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const WMO: Record<number, string> = {
  0: 'clear skies', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers', 85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorms', 96: 'thunderstorms with hail', 97: 'severe thunderstorms', 99: 'thunderstorms with hail',
};
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

type When = 'now' | 'today' | 'tonight' | 'tomorrow';
type Question = 'forecast' | 'rain' | 'snow' | 'umbrella' | 'temperature';

interface Place {
  name: string;
  latitude: number;
  longitude: number;
}

interface Forecast {
  current: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: Array<number | null>;
  };
}

const WHEN = String.raw`(?<when>today|tonight|tomorrow|right now|now|this (?:morning|afternoon|evening))`;
const PLACE = String.raw`(?:in|for|at|near) (?<place>[a-z][a-z .,'-]*?)`;

const QUERIES: Array<[RegExp, Question]> = [
  [new RegExp(String.raw`^(?:what(?:'s| is| will be)|how(?:'s| is)|check|get|show me|tell me)?(?: the)? (?:weather|forecast|weather forecast)(?: like)?(?: ${PLACE})?(?: ${WHEN})?(?: ${PLACE.replace('place', 'place2')})?$`, 'i'), 'forecast'],
  [new RegExp(String.raw`^(?:weather|forecast)(?: ${PLACE})?(?: ${WHEN})?$`, 'i'), 'forecast'],
  [new RegExp(String.raw`^(?:what(?:'s| is) the )?temperature(?: outside)?(?: ${PLACE})?(?: ${WHEN})?$`, 'i'), 'temperature'],
  [new RegExp(String.raw`^how (?:hot|cold|warm) is it(?: outside| out)?(?: ${PLACE})?$`, 'i'), 'temperature'],
  [new RegExp(String.raw`^(?:will|is|does) it (?:going to |gonna )?(?<kind>rain|snow)(?: ${WHEN})?(?: ${PLACE})?(?: ${WHEN.replace('when', 'when2')})?$`, 'i'), 'rain'],
  [new RegExp(String.raw`^(?:do i need|should i (?:bring|take|grab)) an umbrella(?: ${WHEN})?(?: ${PLACE})?$`, 'i'), 'umbrella'],
];

export const weatherHook = defineHook<{ question: Question; when: When; place: string | null }>({
  name: 'weather.forecast',
  category: 'Weather',
  description: 'Current weather and forecast (Open-Meteo, no key needed)',
  examples: ["What's the weather?", 'Will it rain tomorrow in London?'],
  match: (input) => {
    for (const [re, question] of QUERIES) {
      const m = re.exec(input);
      if (!m) continue;
      const g = m.groups;
      const whenWord = (g?.when ?? g?.when2 ?? '').toLowerCase();
      const when: When = whenWord === 'tomorrow' ? 'tomorrow' : whenWord === 'tonight' ? 'tonight' : whenWord.startsWith('today') || whenWord.startsWith('this') ? 'today' : 'now';
      const kind = g?.kind?.toLowerCase() === 'snow' ? 'snow' : question;
      return { question: kind, when, place: (g?.place ?? g?.place2)?.trim() || null };
    }
    return null;
  },
  run: async ({ question, when, place: spoken }, ctx) => {
    const place = await resolvePlace(spoken, ctx);
    if (!place) {
      return spoken
        ? { ok: false, speech: `I couldn't find ${spoken}.` }
        : { ok: false, speech: "Which city? Say 'weather in London', or set WEATHER_LOCATION." };
    }
    const unit = ctx.config.weather.units;
    const f = await fetchForecast(place, unit);
    return describe(f, place, question, when, unit);
  },
});

const geocodeCache = new Map<string, Place | null>();

async function resolvePlace(spoken: string | null, ctx: HookContext): Promise<Place | null> {
  const query = (spoken ?? ctx.config.weather.location).trim();
  if (!query) return null;

  const coords = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(query);
  if (coords) return { name: 'your location', latitude: Number(coords[1]), longitude: Number(coords[2]) };

  const key = query.toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;
  // "Paris, France" → search "Paris"; Open-Meteo matches on the name alone.
  const name = query.split(',')[0]!.trim();
  const data = (await getJson(`${GEOCODE_URL}?${new URLSearchParams({ name, count: '1', language: 'en', format: 'json' })}`)) as {
    results?: Array<{ name: string; latitude: number; longitude: number }>;
  };
  const hit = data.results?.[0];
  const place = hit ? { name: hit.name, latitude: hit.latitude, longitude: hit.longitude } : null;
  geocodeCache.set(key, place);
  return place;
}

async function fetchForecast(place: Place, unit: 'celsius' | 'fahrenheit'): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '2',
    temperature_unit: unit,
    wind_speed_unit: unit === 'fahrenheit' ? 'mph' : 'kmh',
  });
  return (await getJson(`${FORECAST_URL}?${params}`)) as Forecast;
}

async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  } catch {
    throw new Error("The weather service isn't reachable");
  }
  if (!res.ok) throw new Error(`The weather service returned ${res.status}`);
  return res.json();
}

function describe(f: Forecast, place: Place, question: Question, when: When, unit: string) {
  const day = when === 'tomorrow' ? 1 : 0;
  const deg = (n: number | undefined) => `${Math.round(n ?? 0)}°`;
  const code = when === 'now' ? f.current.weather_code : (f.daily.weather_code[day] ?? 0);
  const conditions = WMO[code] ?? 'mixed conditions';
  const high = f.daily.temperature_2m_max[day];
  const low = f.daily.temperature_2m_min[day];
  const rain = f.daily.precipitation_probability_max[day] ?? 0;
  const dayWord = day ? 'tomorrow' : 'today';
  const where = place.name === 'your location' ? '' : ` in ${place.name}`;

  const card = {
    title: `Weather · ${place.name}`,
    fields: [
      { label: 'Now', value: `${deg(f.current.temperature_2m)} · ${WMO[f.current.weather_code] ?? '—'}` },
      { label: 'Feels like', value: deg(f.current.apparent_temperature) },
      { label: 'Wind', value: `${Math.round(f.current.wind_speed_10m)} ${unit === 'fahrenheit' ? 'mph' : 'km/h'}` },
      ...f.daily.time.map((date, i) => ({
        label: i === 0 ? 'Today' : 'Tomorrow',
        value: `${deg(f.daily.temperature_2m_max[i])} / ${deg(f.daily.temperature_2m_min[i])} · ${WMO[f.daily.weather_code[i] ?? 0] ?? '—'} · ${f.daily.precipitation_probability_max[i] ?? 0}% rain`,
      })),
    ],
  };

  if (question === 'rain' || question === 'snow' || question === 'umbrella') {
    const snow = question === 'snow';
    const likely = snow ? SNOW_CODES.has(f.daily.weather_code[day] ?? -1) : rain >= 50;
    const chance = snow ? '' : ` ${rain}% chance of rain ${dayWord}.`;
    if (question === 'umbrella') {
      return { speech: likely ? `Yes.${chance}` : `Probably not.${chance}`, card };
    }
    const verdict = likely ? 'Likely.' : rain >= 25 && !snow ? 'Possibly.' : 'Unlikely.';
    return { speech: snow ? `${verdict} ${capitalize(WMO[f.daily.weather_code[day] ?? 0] ?? 'no snow')} ${dayWord}.` : `${verdict}${chance}`, card };
  }

  if (question === 'temperature' && when === 'now') {
    return { speech: `${deg(f.current.temperature_2m)}${where}, feels like ${deg(f.current.apparent_temperature)}.`, card };
  }
  if (when === 'now') {
    return {
      speech: `${deg(f.current.temperature_2m)} and ${conditions}${where}. High ${deg(high)}, low ${deg(low)}.`,
      card,
    };
  }
  if (when === 'tonight') {
    return { speech: `Tonight${where}: ${conditions}, down to ${deg(low)}.`, card };
  }
  const rainNote = rain >= 30 ? `, ${rain}% chance of rain` : '';
  return { speech: `${capitalize(dayWord)}${where}: ${conditions}, high ${deg(high)}, low ${deg(low)}${rainNote}.`, card };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const weatherHooks = [weatherHook];
