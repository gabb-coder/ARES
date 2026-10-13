import { useEffect, useRef } from 'react';
import type { HookCard } from '../lib/api';
import type { Entry, Status } from '../lib/assistant';
import { ExternalIcon, TrashIcon } from './icons';

interface ConversationProps {
  entries: Entry[];
  interim: string;
  status: Status;
  onClear: () => void;
}

export function Conversation({ entries, interim, status, onClear }: ConversationProps) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [entries.length, interim]);

  return (
    <section className="panel flex min-h-[320px] flex-col overflow-hidden lg:h-full" aria-label="Conversation">
      <header className="flex items-center justify-between border-b border-white/5 px-5 py-3">
        <h2 className="hud-label">Log</h2>
        <button
          type="button"
          onClick={onClear}
          disabled={entries.length === 0}
          className="rounded-md p-1.5 text-ink-500 transition hover:bg-white/5 hover:text-ink-300 disabled:opacity-30"
          aria-label="Clear conversation"
          title="Clear conversation"
        >
          <TrashIcon width={16} height={16} />
        </button>
      </header>

      <div ref={scroller} className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-5 py-5" aria-live="polite">
        {entries.length === 0 && !interim && (
          <div className="grid h-full place-items-center py-10 text-center">
            <div>
              <p className="text-sm text-ink-300">No exchanges yet.</p>
              <p className="mt-1 text-sm text-ink-500">Try “What time is it?” or “Check network status”.</p>
            </div>
          </div>
        )}

        {entries.map((entry) => (entry.role === 'user' ? <UserLine key={entry.id} entry={entry} /> : <AresLine key={entry.id} entry={entry} />))}

        {status === 'listening' && interim && (
          <div className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl rounded-br-md border border-dashed border-ares-500/30 px-4 py-2.5 text-sm text-ink-400 italic">
              {interim}
              <span className="ml-0.5 animate-blink text-ares-400">▍</span>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function UserLine({ entry }: { entry: Entry }) {
  return (
    <div className="flex animate-rise justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.06] px-4 py-2.5 text-sm text-ink-100">{entry.text}</p>
    </div>
  );
}

function AresLine({ entry }: { entry: Entry }) {
  return (
    <div className="animate-rise">
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`size-1.5 rounded-full ${entry.ok === false ? 'bg-ember-400' : 'bg-ares-500'}`} />
        <span className="font-mono text-[0.68rem] font-semibold tracking-[0.2em] text-ares-400">ARES</span>
        {entry.intent && (
          <span className="font-mono text-[0.65rem] text-ink-500">
            {entry.intent}
            {entry.durationMs !== undefined && ` · ${entry.durationMs} ms`}
          </span>
        )}
      </div>
      <p className={`text-[0.95rem] leading-relaxed ${entry.ok === false ? 'text-ember-400' : 'text-ink-100'}`}>{entry.text}</p>
      {entry.card && <Card card={entry.card} />}
    </div>
  );
}

function Card({ card }: { card: HookCard }) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-white/[0.07] bg-ink-900/70">
      <div className="flex items-center justify-between gap-3 border-b border-white/5 px-3.5 py-2">
        <span className="truncate font-mono text-xs text-ink-300">{card.title}</span>
        {card.link && (
          <a
            href={card.link}
            target="_blank"
            rel="noreferrer noopener"
            className="flex shrink-0 items-center gap-1 text-xs text-ares-400 hover:text-ares-300"
          >
            Open <ExternalIcon width={12} height={12} />
          </a>
        )}
      </div>

      {card.fields && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3.5 py-3 text-xs">
          {card.fields.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-ink-500">{f.label}</dt>
              <dd className="min-w-0 truncate font-mono text-ink-200" title={f.value}>
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {card.items && (
        <ul className="scrollbar-thin max-h-56 overflow-y-auto px-3.5 py-2.5 font-mono text-xs leading-6 text-ink-300">
          {card.items.length === 0 && <li className="text-ink-500">Empty</li>}
          {card.items.map((item, i) => (
            <li key={`${i}-${item}`} className={`truncate ${item.endsWith('/') ? 'text-ares-300' : ''}`} title={item}>
              {item}
            </li>
          ))}
        </ul>
      )}

      {card.body && (
        <pre className="scrollbar-thin max-h-64 overflow-auto px-3.5 py-3 font-mono text-xs leading-5 whitespace-pre-wrap text-ink-300">
          {card.body}
        </pre>
      )}
    </div>
  );
}
