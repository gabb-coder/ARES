import type { Logger } from './types.js';

const colors = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' } as const;
const reset = '\x1b[0m';

export function createLogger(scope = 'ares', silent = false): Logger {
  const write = (level: keyof typeof colors) => (message: string) => {
    if (silent) return;
    const time = new Date().toLocaleTimeString([], { hour12: false });
    const line = `${time} ${colors[level]}${level.padEnd(5)}${reset} [${scope}] ${message}`;
    (level === 'error' ? console.error : console.log)(line);
  };
  return { info: write('info'), warn: write('warn'), error: write('error') };
}
