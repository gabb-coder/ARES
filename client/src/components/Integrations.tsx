import type { IntegrationStatus } from '../lib/api';
import { ExternalIcon, PlugIcon, RefreshIcon } from './icons';

const STATE_LABEL: Record<IntegrationStatus['state'], string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  'needs-auth': 'Sign-in needed',
  error: 'Error',
  disabled: 'Off',
};

const STATE_DOT: Record<IntegrationStatus['state'], string> = {
  connected: 'bg-signal-400',
  connecting: 'bg-ember-400 animate-pulse',
  'needs-auth': 'bg-ember-400',
  error: 'bg-ares-500',
  disabled: 'bg-ink-700',
};

interface IntegrationsProps {
  servers: IntegrationStatus[];
  /** LLM provider; integrations do nothing without one. */
  brain: string | undefined;
  onReconnect: (name: string) => void;
}

/** Connected apps (MCP servers from server/integrations.json). */
export function Integrations({ servers, brain, onReconnect }: IntegrationsProps) {
  return (
    <section className="panel p-5" aria-label="Integrations">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="hud-label">Integrations</h2>
        <span className="font-mono text-[0.68rem] text-ink-500">
          {servers.filter((s) => s.state === 'connected').length} connected
        </span>
      </div>

      {servers.length > 0 && brain === 'none' && (
        <p className="mb-3 rounded-lg border border-ember-500/25 bg-ember-500/10 px-3 py-2 text-xs text-ember-400">
          Integrations need an AI model. Set <code className="font-mono">ARES_BRAIN=ollama</code> in server/.env.
        </p>
      )}

      {servers.length === 0 ? (
        <div className="flex items-start gap-3 text-sm text-ink-400">
          <PlugIcon width={18} height={18} className="mt-0.5 shrink-0 text-ink-500" />
          <p>
            Connect Gmail, Calendar, GitHub, Notion, Slack and more: copy{' '}
            <code className="font-mono text-xs text-ink-300">server/integrations.example.json</code> to{' '}
            <code className="font-mono text-xs text-ink-300">integrations.json</code> and enable the apps you use.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-white/5">
          {servers.map((s) => (
            <li key={s.name} className="flex items-center gap-3 py-2.5">
              <span className={`size-2 shrink-0 rounded-full ${STATE_DOT[s.state]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink-100">{s.name}</p>
                <p className="truncate text-xs text-ink-500" title={s.error}>
                  {s.state === 'connected' ? `${s.tools} tools` : (s.error ?? STATE_LABEL[s.state])}
                </p>
              </div>
              {s.state === 'needs-auth' && s.authUrl && (
                <a
                  href={s.authUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-1.5 rounded-lg bg-ares-500/15 px-3 py-1.5 text-xs font-medium text-ares-300 hover:bg-ares-500/25"
                >
                  Sign in <ExternalIcon width={12} height={12} />
                </a>
              )}
              {(s.state === 'error' || s.state === 'needs-auth') && (
                <button
                  type="button"
                  onClick={() => onReconnect(s.name)}
                  className="grid size-8 place-items-center rounded-lg text-ink-500 hover:bg-white/5 hover:text-ink-100"
                  aria-label={`Retry ${s.name}`}
                  title="Retry"
                >
                  <RefreshIcon width={15} height={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
