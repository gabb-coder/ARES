// Speech engines often transcribe "Ares" as one of these.
const WAKE_RE = /\b(?:(?:hey|ok|okay)\s+)?(?:ares|aries|ayres|arees|eris)\b[\s,.!?:;-]*/i;

/**
 * Splits a transcript heard in hands-free mode.
 * Returns null when ARES wasn't addressed, '' for the wake word alone, or the
 * command ("Ares, open YouTube" → "open YouTube").
 */
export function extractCommand(transcript: string): string | null {
  const match = WAKE_RE.exec(transcript);
  if (!match) return null;
  const after = transcript.slice(match.index + match[0].length).trim();
  const before = transcript.slice(0, match.index).trim().replace(/[\s,.!?]+$/, '');
  return after || before;
}
