import { describe, expect, it } from 'vitest';
import { resolveUrl, searchUrl } from '../src/hooks/web.js';
import { testRuntime } from './helpers.js';

describe('resolveUrl', () => {
  it.each([
    ['YouTube', 'https://www.youtube.com'],
    ['the github website', 'https://github.com'],
    ['github dot com', 'https://github.com/'],
    ['docs dot python dot org slash 3', 'https://docs.python.org/3'],
    ['https://example.com/a?b=c', 'https://example.com/a?b=c'],
    ['Example.com/CaseSensitive', 'https://example.com/CaseSensitive'],
    ['localhost:8080', 'https://localhost:8080/'],
  ])('%j → %s', (spoken, url) => {
    expect(resolveUrl(spoken)).toBe(url);
  });

  it.each(['the pod bay doors', 'calculator', 'file.txt1', 'javascript:alert(1)'])('rejects %j', (spoken) => {
    expect(resolveUrl(spoken)).toBeNull();
  });
});

describe('searchUrl', () => {
  it('encodes queries for each engine', () => {
    expect(searchUrl('lo-fi & chill', 'youtube')).toBe('https://www.youtube.com/results?search_query=lo-fi%20%26%20chill');
    expect(searchUrl('espresso')).toBe('https://www.google.com/search?q=espresso');
  });
});

describe('web hooks', () => {
  it('opens sites and searches through the launcher', async () => {
    const { rt, launcher } = await testRuntime();
    expect((await rt.assistant.handle('ARES, open YouTube')).speech).toBe('Opening YouTube.');
    expect((await rt.assistant.handle('search wikipedia for alan turing')).speech).toBe('Searching Wikipedia for alan turing.');
    expect(launcher.calls.map((c) => c.target)).toEqual([
      'https://www.youtube.com',
      'https://en.wikipedia.org/w/index.php?search=alan%20turing',
    ]);
  });
});
