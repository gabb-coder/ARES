import { describe, expect, it } from 'vitest';
import { normalizeUtterance, patterns, spokenToFilename } from '../src/core/intent.js';

describe('normalizeUtterance', () => {
  it.each([
    ['Hey ARES, what time is it?', 'what time is it'],
    ['Aries open YouTube.', 'open YouTube'],
    ['ok ares please could you just list files in downloads', 'list files in downloads'],
    ['Can you check the network status for me please?', 'check the network status'],
    ['  open   github dot com  ', 'open github dot com'],
    ['ARES', ''],
    ['Read file Notes.TXT', 'Read file Notes.TXT'],
  ])('%j → %j', (raw, expected) => {
    expect(normalizeUtterance(raw)).toBe(expected);
  });

  it('keeps words that merely contain the wake word', () => {
    expect(normalizeUtterance('areas of improvement')).toBe('areas of improvement');
  });
});

describe('spokenToFilename', () => {
  it.each([
    ['notes dot txt', 'notes.txt'],
    ['my underscore file dot md', 'my_file.md'],
    ['“report.pdf”', 'report.pdf'],
    ['q3 dash plan dot docx', 'q3-plan.docx'],
  ])('%j → %j', (spoken, expected) => {
    expect(spokenToFilename(spoken)).toBe(expected);
  });
});

describe('patterns', () => {
  it('returns named groups from the first matching pattern', () => {
    const match = patterns(/^ping (?<host>\S+)$/i, /^open (?<target>.+)$/i);
    expect(match('open YouTube')).toEqual({ target: 'YouTube' });
    expect(match('ping example.com')).toEqual({ host: 'example.com' });
    expect(match('hello')).toBeNull();
  });
});
