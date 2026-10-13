import { useEffect, useState } from 'react';
import type { ScheduledItem } from '../lib/api';
import { BellIcon, ClockIcon, CloseIcon } from './icons';

/** Running timers (live countdown) and upcoming reminders, each cancellable. */
export function ScheduleStrip({ items, onCancel }: { items: ScheduledItem[]; onCancel: (id: string) => void }) {
  const now = useTicker(items.some((i) => i.kind === 'timer'));
  if (items.length === 0) return null;

  return (
    <ul className="flex w-full max-w-xl flex-wrap justify-center gap-2" aria-label="Timers and reminders">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] py-1 pr-1 pl-3 text-xs text-ink-300"
        >
          {item.kind === 'timer' ? (
            <ClockIcon width={14} height={14} className="text-ember-400" />
          ) : (
            <BellIcon width={14} height={14} className="text-ares-400" />
          )}
          <span className="max-w-48 truncate">{item.label}</span>
          <span className="font-mono text-ink-100 tabular-nums">
            {item.kind === 'timer' ? countdown(item.dueAt - now) : when(item.dueAt)}
          </span>
          <button
            type="button"
            onClick={() => onCancel(item.id)}
            className="grid size-5 place-items-center rounded-full text-ink-500 hover:bg-white/10 hover:text-ink-100"
            aria-label={`Cancel ${item.label}`}
          >
            <CloseIcon width={12} height={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function when(at: number): string {
  const date = new Date(at);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}
