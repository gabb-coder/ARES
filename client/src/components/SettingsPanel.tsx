import { useEffect, useRef, type ReactNode } from 'react';
import type { SttEngine, TtsEngine } from '../config';
import type { ServerConfig } from '../lib/api';
import { effectiveTts, type Settings } from '../lib/settings';
import { CloseIcon } from './icons';

interface SettingsPanelProps {
  open: boolean;
  settings: Settings;
  server: ServerConfig | null;
  voices: SpeechSynthesisVoice[];
  support: { webSpeech: boolean; synthesis: boolean };
  onChange: (patch: Partial<Settings>) => void;
  onTestVoice: () => void;
  onClose: () => void;
}

const PROVIDER_NAMES = { browser: 'Cloud', elevenlabs: 'ElevenLabs', fishaudio: 'Fish Audio' } as const;

export function SettingsPanel({ open, settings, server, voices, support, onChange, onTestVoice, onClose }: SettingsPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const localSttReady = Boolean(server?.stt.local);
  const cloudTtsReady = Boolean(server?.tts.available);
  const englishFirst = [...voices].sort((a, b) => Number(b.lang.startsWith('en')) - Number(a.lang.startsWith('en')) || a.name.localeCompare(b.name));

  return (
    <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className={`absolute top-0 right-0 flex h-full w-full max-w-sm flex-col border-l border-white/[0.07] bg-ink-900 shadow-2xl transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <h2 className="hud-label">Settings</h2>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-white/5 hover:text-ink-100" aria-label="Close settings">
            <CloseIcon width={18} height={18} />
          </button>
        </header>

        <div className="scrollbar-thin flex-1 space-y-7 overflow-y-auto px-6 py-6">
          <Field label="Speech recognition">
            <Segmented<SttEngine>
              value={settings.sttEngine}
              onChange={(sttEngine) => onChange({ sttEngine })}
              options={[
                { value: 'webspeech', label: 'Web Speech', disabled: !support.webSpeech },
                { value: 'local', label: 'Local Whisper', disabled: !localSttReady },
              ]}
            />
            <Hint>
              {settings.sttEngine === 'webspeech'
                ? 'Built into the browser. Chrome sends audio to its own speech service.'
                : 'Streams to the ARES server and a whisper server on this machine. Offline.'}
              {!localSttReady && ' Set LOCAL_STT_URL on the server to enable Local Whisper.'}
            </Hint>
          </Field>

          <Field label="Voice output">
            <Segmented<TtsEngine>
              value={effectiveTts(settings, server)}
              onChange={(ttsEngine) => onChange({ ttsEngine })}
              options={[
                { value: 'browser', label: 'Browser', disabled: !support.synthesis },
                { value: 'server', label: server ? PROVIDER_NAMES[server.tts.provider] : 'Cloud', disabled: !cloudTtsReady },
              ]}
            />
            <Hint>
              {cloudTtsReady
                ? 'Cloud voice falls back to the browser voice if a request fails.'
                : 'Free and offline. For ElevenLabs or Fish Audio, set TTS_PROVIDER and its API key in server/.env.'}
            </Hint>
          </Field>

          <Field label="Browser voice">
            <select
              value={settings.voiceURI ?? ''}
              onChange={(e) => onChange({ voiceURI: e.target.value || null })}
              className="w-full rounded-xl border border-white/10 bg-ink-850 px-3 py-2 text-sm text-ink-100 focus:border-ares-500/50 focus:outline-none"
            >
              <option value="">Automatic (prefers en-GB)</option>
              {englishFirst.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} · {v.lang}
                </option>
              ))}
            </select>
          </Field>

          <Field label={`Rate · ${settings.rate.toFixed(2)}×`}>
            <Range value={settings.rate} min={0.7} max={1.5} step={0.05} onChange={(rate) => onChange({ rate })} label="Speech rate" />
          </Field>
          <Field label={`Pitch · ${settings.pitch.toFixed(2)}`}>
            <Range value={settings.pitch} min={0.5} max={1.5} step={0.05} onChange={(pitch) => onChange({ pitch })} label="Speech pitch" />
          </Field>

          <Toggle
            label="Hands-free mode"
            description="Listen continuously and respond to “ARES, …”."
            checked={settings.wakeWord}
            onChange={(wakeWord) => onChange({ wakeWord })}
          />
          <Toggle label="Mute voice" description="Show replies without speaking them." checked={settings.muted} onChange={(muted) => onChange({ muted })} />

          <button
            type="button"
            onClick={onTestVoice}
            className="w-full rounded-xl border border-ares-500/30 bg-ares-500/10 px-4 py-2.5 text-sm font-medium text-ares-300 transition hover:bg-ares-500/20"
          >
            Test voice
          </button>
        </div>

        <footer className="border-t border-white/5 px-6 py-4 font-mono text-[0.68rem] leading-5 text-ink-500">
          Space: talk · Esc: stop · Settings save in this browser.
        </footer>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="hud-label">{label}</div>
      {children}
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-ink-500">{children}</p>;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.07] bg-ink-950/60 p-1" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-35 ${
            value === o.value ? 'bg-ares-500/20 text-ares-300 shadow-[inset_0_0_0_1px] shadow-ares-500/40' : 'text-ink-400 hover:text-ink-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Range({ value, min, max, step, label, onChange }: { value: number; min: number; max: number; step: number; label: string; onChange: (v: number) => void }) {
  return (
    <input
      type="range"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-ares-500"
    />
  );
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm text-ink-100">{label}</span>
        <span className="block text-xs text-ink-500">{description}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full border border-white/10 bg-ink-800 transition peer-checked:border-ares-500/50 peer-checked:bg-ares-500/40 peer-focus-visible:outline-2 peer-focus-visible:outline-ares-400 after:absolute after:top-0.5 after:left-0.5 after:size-4.5 after:rounded-full after:bg-ink-300 after:transition peer-checked:after:translate-x-5 peer-checked:after:bg-white"
      />
    </label>
  );
}
