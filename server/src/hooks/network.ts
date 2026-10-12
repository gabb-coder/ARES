import dns from 'node:dns/promises';
import net from 'node:net';
import os from 'node:os';
import { patterns } from '../core/intent.js';
import { defineHook } from '../core/types.js';

/** Public anycast resolvers: reachable from almost anywhere, no HTTP needed. */
const PROBES = [
  { host: '1.1.1.1', port: 443 },
  { host: '8.8.8.8', port: 443 },
];

export const networkStatusHook = defineHook({
  name: 'net.status',
  category: 'Network',
  description: 'Check internet connectivity, DNS and latency',
  examples: ['Check network status', 'Am I online?'],
  match: patterns(
    /^(?:check|test|run|show|what(?:'s| is))?(?: the| my| a)? ?(?:network|internet|connection|connectivity|wi-?fi)(?: status| connection| check| test| diagnostics)?$/i,
    /^(?:am i|are we|is (?:this|the) (?:computer|machine)) (?:online|connected)(?: to the internet)?$/i,
    /^is (?:the )?(?:internet|network|wi-?fi) (?:up|working|down|ok|okay)$/i,
    /^(?:do i|do we) have (?:internet|a connection|network)$/i,
  ),
  run: async () => {
    const [latency, dnsOk] = await Promise.all([measureLatency(), checkDns()]);
    const addresses = localAddresses();
    const local = addresses[0];

    const fields = [
      { label: 'Internet', value: latency !== null ? 'Reachable' : 'Unreachable' },
      { label: 'Latency', value: latency !== null ? `${latency} ms` : '—' },
      { label: 'DNS', value: dnsOk ? 'Resolving' : 'Failing' },
      ...addresses.map((a) => ({ label: a.iface, value: a.address })),
    ];
    const card = { title: 'Network status', fields };

    if (latency !== null) {
      const suffix = dnsOk ? '' : ' DNS is failing, though.';
      return { speech: `Online. ${latency} millisecond latency.${suffix}`, card };
    }
    if (local) {
      return { ok: false, speech: `Offline. Local network is up at ${local.address}, but the internet is unreachable.`, card };
    }
    return { ok: false, speech: 'Offline. No active network interface.', card };
  },
});

export const ipHook = defineHook({
  name: 'net.ip',
  category: 'Network',
  description: 'Report local (and on request, public) IP address',
  examples: ["What's my IP address?", "What's my public IP?"],
  match: patterns(/^what(?:'s| is) my (?<scope>local |public |external |private )?ip(?: address)?$/i, /^(?:my |show my )(?<scope>local |public |external )?ip(?: address)?$/i),
  run: async ({ scope }) => {
    const local = localAddresses();
    const wantsPublic = /public|external/i.test(scope ?? '');
    const fields = local.map((a) => ({ label: a.iface, value: a.address }));

    if (wantsPublic) {
      // The one outbound call in this hook, and only when explicitly asked for.
      const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error('The IP lookup service is unavailable');
      const { ip } = (await res.json()) as { ip: string };
      return { speech: `Your public IP is ${spellIp(ip)}.`, card: { title: 'IP addresses', fields: [{ label: 'Public', value: ip }, ...fields] } };
    }

    if (!local[0]) return { ok: false, speech: 'No active network interface.' };
    return { speech: `Your local IP is ${spellIp(local[0].address)}.`, card: { title: 'IP addresses', fields } };
  },
});

export const pingHook = defineHook({
  name: 'net.ping',
  category: 'Network',
  description: 'Check whether a host is reachable',
  examples: ['Ping github.com', 'Is google.com up?'],
  match: patterns(
    /^(?:ping|check(?: the)? latency (?:to|for)|check|test) (?<host>[a-z0-9-]+(?:\s*(?:\.|dot)\s*[a-z0-9-]+)+)$/i,
    /^is (?<host>[a-z0-9-]+(?:\s*(?:\.|dot)\s*[a-z0-9-]+)+) (?:up|down|online|reachable|working)$/i,
  ),
  run: async ({ host: spoken }) => {
    const host = (spoken ?? '').replace(/\s*(?:\.|\bdot\b)\s*/gi, '.').toLowerCase();
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const ms = await tcpLatency(host, 443).catch(() => null);
      if (ms !== null) samples.push(ms);
    }
    if (samples.length === 0) return { ok: false, speech: `${host} is unreachable.` };

    const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
    return {
      speech: `${host} is up. ${avg} milliseconds.`,
      card: {
        title: `Ping ${host}`,
        fields: [
          { label: 'Average', value: `${avg} ms` },
          { label: 'Samples', value: samples.map((s) => `${s} ms`).join(', ') },
          { label: 'Method', value: 'TCP connect, port 443' },
        ],
      },
    };
  },
});

// --- probes ----------------------------------------------------------------

/**
 * Time to open a TCP connection. Unlike ICMP ping this needs no privileges and
 * behaves the same on every OS.
 */
export function tcpLatency(host: string, port: number, timeoutMs = 2500): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.destroy();
      resolve(Math.round(performance.now() - started));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('timeout'));
    });
    socket.once('error', (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

async function measureLatency(): Promise<number | null> {
  for (const probe of PROBES) {
    const ms = await tcpLatency(probe.host, probe.port).catch(() => null);
    if (ms !== null) return ms;
  }
  return null;
}

async function checkDns(): Promise<boolean> {
  try {
    await Promise.race([
      dns.resolve4('example.com'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export function localAddresses(): Array<{ iface: string; address: string }> {
  return Object.entries(os.networkInterfaces()).flatMap(([iface, infos]) =>
    (infos ?? [])
      .filter((i) => i.family === 'IPv4' && !i.internal)
      .map((i) => ({ iface, address: i.address })),
  );
}

/** "192.168.1.20" → "192 dot 168 dot 1 dot 20" so TTS doesn't read it as a number. */
function spellIp(ip: string): string {
  return ip.includes(':') ? ip : ip.split('.').join(' dot ');
}

export const networkHooks = [networkStatusHook, ipHook, pingHook];
