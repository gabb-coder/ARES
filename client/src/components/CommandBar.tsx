import { useState, type FormEvent } from 'react';
import { SendIcon } from './icons';

export function CommandBar({ disabled, onSubmit }: { disabled: boolean; onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSubmit(text);
    setText('');
  };

  return (
    <form onSubmit={submit} className="panel flex w-full items-center gap-2 p-1.5 pl-4 focus-within:border-ares-500/40">
      <span className="font-mono text-sm text-ares-500" aria-hidden>
        ›
      </span>
      <label htmlFor="command" className="sr-only">
        Type a command
      </label>
      <input
        id="command"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a command…"
        autoComplete="off"
        maxLength={500}
        className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="grid size-9 place-items-center rounded-xl bg-ares-500/15 text-ares-400 transition hover:bg-ares-500/25 disabled:opacity-30"
        aria-label="Send command"
      >
        <SendIcon width={18} height={18} />
      </button>
    </form>
  );
}
