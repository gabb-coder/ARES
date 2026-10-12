import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Capabilities } from './components/Capabilities';
import { CommandBar } from './components/CommandBar';
import { Conversation } from './components/Conversation';
import { Header } from './components/Header';
import { CloseIcon } from './components/icons';
import { MicButton } from './components/MicButton';
import { SettingsPanel } from './components/SettingsPanel';
import { useAssistant } from './hooks/useAssistant';
import type { AssistantState } from './lib/assistant';

export default function App() {
  const { state, controller } = useAssistant();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { status, settings } = state;

  const getAnalyser = useCallback(
    () => (controller.getState().status === 'speaking' ? controller.speaker.analyser : (controller.mic?.analyser ?? null)),
    [controller],
  );
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // Space toggles the mic, Escape stops whatever is happening.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (settingsOpen || target.closest('input, textarea, select, button, [contenteditable]')) return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        controller.toggle();
      } else if (e.key === 'Escape') {
        if (controller.getState().status === 'speaking') controller.stopSpeaking();
        else if (controller.getState().status === 'listening' && !controller.getState().settings.wakeWord) controller.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller, settingsOpen]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <Header
        online={state.online}
        server={state.server}
        settings={settings}
        onToggleMute={() => controller.updateSettings({ muted: !settings.muted })}
        onToggleWake={() => controller.updateSettings({ wakeWord: !settings.wakeWord })}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {!state.online && (
        <Banner tone="warn">
          ARES server is offline. Start it with <code className="font-mono text-ink-100">npm run dev</code> from the project root.
        </Banner>
      )}
      {state.error && (
        <Banner tone="error" onDismiss={() => controller.dismissError()}>
          {state.error}
        </Banner>
      )}

      <main className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:grid-rows-[auto_1fr]">
        <section className="panel flex min-w-0 flex-col items-center gap-5 px-4 pt-6 pb-6 sm:px-8" aria-label="Voice control">
          <MicButton
            status={status}
            wakeMode={settings.wakeWord}
            awaitingCommand={state.awaitingCommand}
            getAnalyser={getAnalyser}
            onPress={() => controller.toggle()}
          />
          <div className="min-h-14 text-center" aria-live="polite">
            <p className="hud-label text-ink-300">{statusLabel(state)}</p>
            <p className="mt-2 min-h-6 max-w-xl text-lg text-ink-100">
              {status === 'listening' && state.interim ? state.interim : lastReply(state)}
            </p>
          </div>
          <div className="w-full max-w-xl">
            <CommandBar disabled={status === 'thinking'} onSubmit={(text) => void controller.submit(text)} />
          </div>
        </section>

        {/* Second on small screens, a full-height side column on large ones. */}
        <div className="min-h-0 lg:sticky lg:top-7 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-[calc(100dvh-8rem)]">
          <Conversation entries={state.entries} interim={state.interim} status={status} onClear={() => controller.clearHistory()} />
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <Capabilities hooks={state.hooks} disabled={status === 'thinking' || !state.online} onRun={(text) => void controller.submit(text)} />
        </div>
      </main>

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        server={state.server}
        voices={state.voices}
        support={state.support}
        onChange={(patch) => controller.updateSettings(patch)}
        onTestVoice={() => void controller.testVoice()}
        onClose={closeSettings}
      />
    </div>
  );
}

function statusLabel({ status, settings, awaitingCommand }: AssistantState): string {
  if (status === 'thinking') return 'Processing';
  if (status === 'speaking') return 'Speaking · tap to interrupt';
  if (settings.wakeWord) return awaitingCommand ? 'Go ahead' : 'Hands-free · say “ARES, …”';
  if (status === 'listening') return 'Listening';
  return 'Tap or press Space to speak';
}

function lastReply({ entries }: AssistantState): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.role === 'ares') return entries[i]!.text;
  }
  return '';
}

function Banner({ tone, children, onDismiss }: { tone: 'warn' | 'error'; children: ReactNode; onDismiss?: () => void }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
        tone === 'error' ? 'border-ares-500/30 bg-ares-500/10 text-ares-300' : 'border-ember-500/25 bg-ember-500/10 text-ember-400'
      }`}
    >
      <p>{children}</p>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100" aria-label="Dismiss">
          <CloseIcon width={16} height={16} />
        </button>
      )}
    </div>
  );
}
