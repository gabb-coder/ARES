import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculate } from '../src/hooks/math.js';
import { testRuntime } from './helpers.js';

describe('calculator', () => {
  it.each([
    ["what's 15% of 240", '36'],
    ['what is 12 times 7 plus 3', '87'],
    ['square root of 144', '12'],
    ['what is 2 to the power of 10', '1,024'],
    ['what is 100 divided by 7', '14.2857'],
    ['20 percent off 80', '64'],
    ['what is 1,250 times 4', '5,000'],
    ['what is 0.1 plus 0.2', '0.3'],
  ])('%j → %s', (spoken, answer) => {
    expect(calculate(spoken)?.answer).toBe(answer);
  });

  it.each([
    ['convert 5 miles to kilometers', '8.047 kilometers'],
    ['72 Fahrenheit in Celsius', '22.22 degrees Celsius'],
    ['how many cups in a liter', '4.227 cups'],
    ['how many feet in a mile', '5,280 feet'],
    ['convert 10 pounds to kg', '4.536 kilograms'],
    ["what's 60 mph in kilometers per hour", '96.56 kilometers per hour'],
    ['convert 1500 square feet to square meters', '139.4 square meters'],
    ['convert 1 TB to GB', '1,000 gigabytes'],
    ['convert 1 kilometer to miles', '0.6214 miles'],
  ])('%j → %s', (spoken, answer) => {
    expect(calculate(spoken)?.answer).toBe(answer);
  });

  it('cannot reach mathjs internals', () => {
    expect(calculate('what is evaluate("1+1")')).toBeNull();
    expect(calculate('what is import(1)')).toBeNull();
  });

  it('leaves non-math to other hooks', async () => {
    const { rt } = await testRuntime();
    expect((await rt.assistant.handle("what's 15% of 240")).speech).toBe('36.');
    expect((await rt.assistant.handle('12 times 7')).intent).toBe('math.calculate');
    expect((await rt.assistant.handle('what is the date')).intent).toBe('system.date');
    expect((await rt.assistant.handle("what's the volume")).intent).toBe('media.volume');
    expect((await rt.assistant.handle('set a timer for 10 minutes')).intent).toBe('timer.set');
  });
});

describe('weather', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubOpenMeteo() {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      urls.push(url);
      const body = url.includes('geocoding')
        ? { results: [{ name: 'Lisbon', latitude: 38.72, longitude: -9.14 }] }
        : {
            current: { temperature_2m: 21.4, apparent_temperature: 20.6, weather_code: 2, wind_speed_10m: 12 },
            daily: {
              time: ['2026-10-12', '2026-10-13'],
              weather_code: [2, 63],
              temperature_2m_max: [23.2, 19.1],
              temperature_2m_min: [15.8, 14.2],
              precipitation_probability_max: [10, 80],
            },
          };
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    });
    return urls;
  }

  it('reports current conditions for the default location', async () => {
    const urls = stubOpenMeteo();
    const { rt } = await testRuntime({ weather: { location: 'Lisbon', units: 'celsius' } });
    const res = await rt.assistant.handle("What's the weather?");
    expect(res.speech).toBe('21° and partly cloudy in Lisbon. High 23°, low 16°.');
    expect(urls[1]).toContain('temperature_unit=celsius');
    expect(res.card?.fields?.[0]).toEqual({ label: 'Now', value: '21° · partly cloudy' });
  });

  it('answers rain questions for tomorrow and a named city', async () => {
    const urls = stubOpenMeteo();
    const { rt } = await testRuntime({ weather: { location: '', units: 'fahrenheit' } });
    expect((await rt.assistant.handle('will it rain tomorrow in Lisbon')).speech).toBe('Likely. 80% chance of rain tomorrow.');
    expect((await rt.assistant.handle('weather in lisbon tomorrow')).speech).toBe(
      'Tomorrow in Lisbon: rain, high 19°, low 14°, 80% chance of rain.',
    );
    expect(urls.some((u) => u.includes('wind_speed_unit=mph'))).toBe(true);
  });

  it('asks for a city when none is configured', async () => {
    stubOpenMeteo();
    const { rt } = await testRuntime({ weather: { location: '', units: 'celsius' } });
    expect((await rt.assistant.handle("what's the weather")).speech).toMatch(/^Which city\?/);
  });
});
