import type { ReactNode } from 'react';
import type { ServerConfig } from '../lib/api';
import { effectiveTts, type Settings } from '../lib/settings';
import { EarIcon, GearIcon, MuteIcon, VolumeIcon } from './icons';

interface HeaderProps {
  online: boolean;
  server: ServerConfig | null;
  settings: Settings;
  onToggleMute: () => void;
  onToggleWake: () => void;
  onOpenSettings: () => void;
}

const TTS_NAMES = { browser: 'Browser', elevenlabs: 'ElevenLabs', fishaudio: 'Fish Audio' } as const;

export function Header({ online, server, settings, onToggleMute, onToggleWake, onOpenSettings }: HeaderProps) {
  const voice = server && effectiveTts(settings, server) === 'server' ? TTS_NAMES[server.tts.provider] : 'Browser';

  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <img src="/ares.svg" alt="" className="size-9" />
        <div>
          <h1 className="bg-gradient-to-r from-ares-400 to-ember-400 bg-clip-text font-mono text-xl font-bold tracking-[0.35em] text-transparent">
            ARES
          </h1>
          <p className="text-xs text-ink-500">{server?.persona.tagline ?? 'Local voice assistant'}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip>
          <span className={`size-1.5 rounded-full ${online ? 'bg-signal-400 shadow-[0_0_8px] shadow-signal-400' : 'bg-ares-500'}`} />
          {online ? 'Online' : 'Offline'}
        </Chip>
        <Chip title="Speech recognition">STT · {settings.sttEngine === 'local' ? 'Whisper' : 'Web Speech'}</Chip>
        <Chip title="Voice output">TTS · {voice}</Chip>
        {server && server.brain.provider !== 'none' && <Chip title={server.brain.model}>LLM · {server.brain.provider}</Chip>}
        {server?.dryRun && <Chip className="border-ember-500/40 text-ember-400">Dry run</Chip>}

        <div className="ml-1 flex items-center gap-1">
          <IconButton
            label={settings.wakeWord ? 'Disable hands-free mode' : 'Enable hands-free mode'}
            active={settings.wakeWord}
            onClick={onToggleWake}
          >
            <EarIcon width={18} height={18} />
          </IconButton>
          <IconButton label={settings.muted ? 'Unmute voice' : 'Mute voice'} active={settings.muted} onClick={onToggleMute}>
            {settings.muted ? <MuteIcon width={18} height={18} /> : <VolumeIcon width={18} height={18} />}
          </IconButton>
          <IconButton label="Settings" onClick={onOpenSettings}>
            <GearIcon width={18} height={18} />
          </IconButton>
        </div>
      </div>
    </header>
  );
}

function Chip({ children, title, className = '' }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={`flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 font-mono text-[0.68rem] tracking-wide text-ink-300 ${className}`}
    >
      {children}
    </span>
  );
}

function IconButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`grid size-9 place-items-center rounded-xl border transition ${
        active
          ? 'border-ares-500/40 bg-ares-500/15 text-ares-300'
          : 'border-transparent text-ink-400 hover:border-white/10 hover:bg-white/5 hover:text-ink-100'
      }`}
    >
      {children}
    </button>
  );
}
