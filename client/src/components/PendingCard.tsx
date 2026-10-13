import { useEffect, useState } from 'react';
import type { PendingAction } from '../lib/api';
import { CheckIcon, CloseIcon } from './icons';

/** The agent wants to send/create/change something: show exactly what, and ask. */
export function PendingCard({ pending, busy, onAnswer }: { pending: PendingAction; busy: boolean; onAnswer: (approve: boolean) => void }) {
  const seconds = useSecondsLeft(pending.expiresAt);
  const args = Object.entries(pending.args);

  return (
    <section
      aria-label="Confirm action"
      className="w-full max-w-xl animate-rise rounded-2xl border border-ember-500/35 bg-gradient-to-b from-ember-500/10 to-transparent p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="hud-label text-ember-400">Confirm · {pending.title}</p>
        <span className="font-mono text-[0.65rem] text-ink-500">{seconds > 0 ? `${seconds}s` : 'expired'}</span>
      </div>
      {args.length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {args.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-ink-500">{key}</dt>
              <dd className="max-h-28 min-w-0 overflow-auto font-mono text-xs leading-5 break-words whitespace-pre-wrap text-ink-100">
                {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={busy || seconds <= 0}
          onClick={() => onAnswer(true)}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-ares-500 to-ember-500 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40"
        >
          <CheckIcon width={16} height={16} /> Confirm
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(false)}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-ink-300 transition hover:bg-white/5 disabled:opacity-40"
        >
          <CloseIcon width={16} height={16} /> Cancel
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-ink-500">Or say “yes” or “cancel”.</p>
    </section>
  );
}

function useSecondsLeft(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.round((until - now) / 1000));
}
