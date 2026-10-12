import os from 'node:os';
import { patterns } from '../core/intent.js';
import { defineHook } from '../core/types.js';

export const timeHook = defineHook({
  name: 'system.time',
  category: 'System',
  description: 'Tell the current time',
  examples: ['What time is it?'],
  match: patterns(
    /^what(?:'s| is) the time$/i,
    /^what time is it$/i,
    /^(?:tell me the |the |current )?time(?: please)?$/i,
  ),
  run: () => ({
    speech: `It's ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`,
  }),
});

export const dateHook = defineHook({
  name: 'system.date',
  category: 'System',
  description: "Tell today's date",
  examples: ["What's the date?", 'What day is it?'],
  match: patterns(
    /^what(?:'s| is) (?:the |today's )?date(?: today)?$/i,
    /^what day is (?:it|today)$/i,
    /^(?:today's |the )?date$/i,
  ),
  run: () => ({
    speech: `It's ${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}.`,
  }),
});

export const systemStatusHook = defineHook({
  name: 'system.status',
  category: 'System',
  description: 'Report CPU, memory and uptime',
  examples: ['System status', 'How much memory am I using?'],
  match: patterns(
    /^(?:system|computer|machine) (?:status|info|information|report|check|diagnostics)$/i,
    /^(?:run )?(?:a )?(?:system )?diagnostics$/i,
    /^(?:what(?:'s| is) (?:the |my )?)?(?:cpu|processor|memory|ram) (?:usage|load|status)$/i,
    /^how much (?:memory|ram) am i using$/i,
    /^how(?:'s| is) (?:the|my) (?:system|computer|machine)(?: doing)?$/i,
  ),
  run: async () => {
    const cpu = await cpuUsage();
    const total = os.totalmem();
    const used = total - os.freemem();
    const cpus = os.cpus();

    return {
      speech: `CPU at ${cpu} percent. Memory ${gb(used)} of ${gb(total)} gigabytes. Up ${duration(os.uptime())}.`,
      card: {
        title: 'System status',
        fields: [
          { label: 'Host', value: os.hostname() },
          { label: 'Platform', value: `${os.type()} ${os.release()} (${os.arch()})` },
          { label: 'CPU', value: `${cpus[0]?.model.trim() ?? 'Unknown'} × ${cpus.length}` },
          { label: 'CPU load', value: `${cpu}%` },
          { label: 'Memory', value: `${gb(used)} / ${gb(total)} GB (${Math.round((used / total) * 100)}%)` },
          { label: 'Uptime', value: duration(os.uptime()) },
        ],
      },
    };
  },
});

/** Samples CPU counters twice to get a real utilisation figure (os.loadavg is 0 on Windows). */
async function cpuUsage(sampleMs = 250): Promise<number> {
  const totals = () =>
    os.cpus().reduce(
      (acc, { times }) => {
        const all = times.user + times.nice + times.sys + times.idle + times.irq;
        return { idle: acc.idle + times.idle, all: acc.all + all };
      },
      { idle: 0, all: 0 },
    );
  const a = totals();
  await new Promise((r) => setTimeout(r, sampleMs));
  const b = totals();
  const all = b.all - a.all;
  return all > 0 ? Math.round(100 * (1 - (b.idle - a.idle) / all)) : 0;
}

function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

export function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d} ${d === 1 ? 'day' : 'days'}`);
  if (h) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
  if (!d && m) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
  return parts.join(' ') || 'under a minute';
}

export const systemHooks = [timeHook, dateHook, systemStatusHook];
