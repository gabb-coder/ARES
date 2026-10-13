import { aresConfig } from '../config';
import {
  api,
  type AresEvent,
  type CommandResponse,
  type HookCard,
  type HookInfo,
  type IntegrationStatus,
  type PendingAction,
  type ScheduledItem,
  type ServerConfig,
} from './api';
import { earcon } from './audio/earcon';
import { Microphone } from './audio/microphone';
import { LocalSttInput } from './speech/localStt';
import { isSynthesisSupported, Speaker } from './speech/speaker';
import { SpeechInputError, type ListenSession, type SpeechInput } from './speech/types';
import { isWebSpeechSupported, WebSpeechInput } from './speech/webSpeech';
import { effectiveTts, loadSettings, saveSettings, type Settings } from './settings';
import { extractCommand } from './wake';

export type Status = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface Entry {
  id: string;
  role: 'user' | 'ares';
  text: string;
  at: number;
  intent?: string | null;
  card?: HookCard;
  ok?: boolean;
  durationMs?: number;
}

export interface AssistantState {
  status: Status;
  /** Live partial transcript while listening. */
  interim: string;
  entries: Entry[];
  error: string | null;
  /** Hands-free: the wake word was heard (or the button pressed); next words are a command. */
  awaitingCommand: boolean;
  online: boolean;
  server: ServerConfig | null;
  hooks: HookInfo[];
  settings: Settings;
  voices: SpeechSynthesisVoice[];
  support: { webSpeech: boolean; synthesis: boolean };
  /** An agent action waiting for yes/no. */
  pending: PendingAction | null;
  /** Running timers and upcoming reminders, soonest first. */
  schedule: ScheduledItem[];
  integrations: IntegrationStatus[];
}

const MAX_ENTRIES = 100;
const MIC_IDLE_RELEASE_MS = 20_000;
const HEALTH_INTERVAL_MS = 5_000;
const FOLLOW_UP_LISTEN_MS = 8_000;

/**
 * The dashboard's brain: a small state machine that owns the microphone,
 * speech engines and the conversation. React subscribes via useAssistant().
 *
 *   idle ──tap──▶ listening ──transcript──▶ thinking ──reply──▶ speaking ──▶ idle
 *
 * Hands-free mode loops listening → (wake word?) → thinking → speaking.
 */
export class AssistantController {
  readonly speaker = new Speaker();
  mic: Microphone | null = null;

  #state: AssistantState;
  #listeners = new Set<() => void>();
  #input: SpeechInput | null = null;
  #session: ListenSession | null = null;
  #wakeLoop: AbortController | null = null;
  #forceCommand = false;
  #busy: Promise<void> | null = null;
  #micPromise: Promise<Microphone> | null = null;
  #micReleaseTimer: ReturnType<typeof setTimeout> | undefined;
  #healthTimer: ReturnType<typeof setInterval> | undefined;
  #disposers: Array<() => void> = [];

  constructor() {
    this.#state = {
      status: 'idle',
      interim: '',
      entries: [],
      error: null,
      awaitingCommand: false,
      online: false,
      server: null,
      hooks: [],
      settings: loadSettings(),
      voices: [],
      support: { webSpeech: isWebSpeechSupported(), synthesis: isSynthesisSupported() },
      pending: null,
      schedule: [],
      integrations: [],
    };
  }

  // --- store plumbing (useSyncExternalStore) -------------------------------

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getState = () => this.#state;

  #set(patch: Partial<AssistantState>) {
    this.#state = { ...this.#state, ...patch };
    this.#listeners.forEach((l) => l());
  }

  // --- lifecycle -----------------------------------------------------------

  start() {
    const refreshVoices = () => this.#set({ voices: this.speaker.voices() });
    refreshVoices();
    this.#disposers.push(this.speaker.onVoicesChanged(refreshVoices));

    void this.#checkHealth();
    this.#healthTimer = setInterval(() => void this.#checkHealth(), HEALTH_INTERVAL_MS);
    this.#disposers.push(api.events((event) => this.#onEvent(event)));

    // Browsers keep audio suspended until a user gesture; resume on the first one.
    const resumeAudio = () => {
      if (this.mic?.context.state === 'suspended') void this.mic.context.resume();
    };
    window.addEventListener('pointerdown', resumeAudio);
    window.addEventListener('keydown', resumeAudio);
    this.#disposers.push(() => {
      window.removeEventListener('pointerdown', resumeAudio);
      window.removeEventListener('keydown', resumeAudio);
    });

    if (this.#state.settings.wakeWord) this.#startWakeLoop();
  }

  dispose() {
    clearInterval(this.#healthTimer);
    this.#disposers.splice(0).forEach((d) => d());
    this.#stopWakeLoop();
    this.#session?.abort();
    this.speaker.stop();
    this.#input?.dispose();
    this.#releaseMic();
  }

  async #checkHealth() {
    const wasOnline = this.#state.online;
    try {
      await api.health();
      if (!wasOnline) {
        const [server, hooks] = await Promise.all([api.config(), api.hooks()]);
        this.#set({ online: true, server, hooks });
      }
    } catch {
      if (wasOnline || this.#state.server === null) this.#set({ online: false });
    }
  }

  // --- user actions --------------------------------------------------------

  /** The microphone button. */
  toggle() {
    const { status, settings, awaitingCommand } = this.#state;
    this.#set({ error: null });

    if (status === 'speaking') {
      this.speaker.stop();
      return;
    }
    if (status === 'thinking') return;

    if (settings.wakeWord) {
      // Hands-free: the button means "skip the wake word for the next command".
      this.#forceCommand = !awaitingCommand;
      this.#set({ awaitingCommand: this.#forceCommand });
      if (this.#forceCommand) earcon('wake');
      return;
    }

    if (status === 'listening') this.#session?.stop();
    else void this.#listenOnce();
  }

  /** A typed command. */
  async submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || this.#state.status === 'thinking') return;
    this.speaker.stop();
    this.#session?.abort();
    await this.#handle(trimmed, { viaVoice: false });
  }

  stopSpeaking() {
    this.speaker.stop();
  }

  /** Answers the agent's "Confirm?" from the dashboard buttons. */
  async confirmPending(approve: boolean) {
    const pending = this.#state.pending;
    if (!pending || this.#state.status === 'thinking') return;
    this.speaker.stop();
    this.#session?.abort();
    await this.#exchange(approve ? 'Confirm' : 'Cancel', () => api.resolvePending(pending.id, approve));
  }

  async cancelScheduled(id: string) {
    await api.cancelScheduled(id).catch((err: Error) => this.#set({ error: err.message }));
  }

  async reconnectIntegration(name: string) {
    await api.reconnectIntegration(name).catch((err: Error) => this.#set({ error: err.message }));
  }

  clearHistory() {
    this.#set({ entries: [] });
  }

  dismissError() {
    this.#set({ error: null });
  }

  updateSettings(patch: Partial<Settings>) {
    const previous = this.#state.settings;
    const settings = { ...previous, ...patch };
    saveSettings(settings);
    this.#set({ settings });

    if (patch.sttEngine && patch.sttEngine !== previous.sttEngine) {
      this.#session?.abort();
      this.#input?.dispose();
      this.#input = null;
      if (settings.wakeWord) this.#restartWakeLoop();
    }
    if (patch.wakeWord !== undefined && patch.wakeWord !== previous.wakeWord) {
      if (patch.wakeWord) this.#startWakeLoop();
      else this.#stopWakeLoop();
    }
    if (patch.muted) this.speaker.stop();
  }

  /** Preview the current voice settings. */
  async testVoice() {
    await this.#say('ARES online. Systems nominal.', { force: true });
  }

  // --- core flow -------------------------------------------------------------

  async #listenOnce(timeoutMs?: number) {
    try {
      await this.#ensureMic(this.#state.settings.sttEngine === 'local');
      earcon('listen');
      const text = await this.#listen(timeoutMs);
      if (text) await this.#handle(text);
    } catch (err) {
      this.#fail(err);
    } finally {
      if (this.#state.status === 'listening') this.#set({ status: 'idle' });
      this.#set({ interim: '' });
      this.#scheduleMicRelease();
    }
  }

  async #listen(timeoutMs?: number): Promise<string> {
    const input = this.#speechInput();
    this.#set({ status: 'listening', interim: '' });
    const session = input.listen({ timeoutMs, onInterim: (interim) => this.#set({ interim }) });
    this.#session = session;
    try {
      return await session.result;
    } finally {
      if (this.#session === session) this.#session = null;
    }
  }

  /** Sends a command to the server and speaks the reply. */
  #handle(text: string, { viaVoice = true } = {}) {
    return this.#exchange(text, () => api.command(text), viaVoice);
  }

  async #exchange(userText: string, send: () => Promise<CommandResponse>, viaVoice = false) {
    const release = this.#claim();
    this.#push({ role: 'user', text: userText });
    this.#set({ status: 'thinking', interim: '', awaitingCommand: false, pending: null });

    let pending: PendingAction | null = null;
    try {
      const res = await send();
      pending = res.pending ?? null;
      this.#push({
        role: 'ares',
        text: res.speech,
        intent: res.intent,
        card: res.card,
        ok: res.ok,
        durationMs: res.durationMs,
      });
      this.#set({ pending });
      // ARES asked "Confirm?": take the next words as the answer, no wake word needed.
      if (pending && this.#state.settings.wakeWord) {
        this.#forceCommand = true;
        this.#set({ awaitingCommand: true });
      }
      await this.#say(res.speech);
    } catch (err) {
      const message = (err as Error).message;
      this.#push({ role: 'ares', text: message, ok: false });
      this.#set({ error: message });
      earcon('error');
    } finally {
      this.#set({ status: 'idle' });
      release();
    }

    // Spoken push-to-talk command: listen once for the yes/no without another tap.
    // (Deferred so the caller's own cleanup runs first.)
    if (pending && viaVoice && !this.#state.settings.wakeWord) {
      setTimeout(() => void this.#listenOnce(FOLLOW_UP_LISTEN_MS), 0);
    }
  }

  /** Marks ARES busy so hands-free listening pauses; returns the release. */
  #claim(): () => void {
    let release!: () => void;
    const busy = new Promise<void>((r) => (release = r));
    this.#busy = busy;
    return () => {
      if (this.#busy === busy) this.#busy = null;
      release();
    };
  }

  #onEvent(event: AresEvent) {
    if (event.type === 'schedule') this.#set({ schedule: event.items });
    else if (event.type === 'integrations') this.#set({ integrations: event.servers });
    else if (event.type === 'alert') void this.#announce(event);
  }

  /** Timer and reminder alerts: chime now, speak once ARES is free. */
  async #announce(event: Extract<AresEvent, { type: 'alert' }>) {
    this.#push({ role: 'ares', text: event.speech, intent: event.kind, card: event.card, ok: true });
    earcon('alert');
    while (this.#busy) await this.#busy;
    // Don't talk over someone mid-sentence in push-to-talk mode.
    for (let waited = 0; this.#state.status === 'listening' && !this.#state.settings.wakeWord && waited < 15_000; waited += 250) {
      await new Promise((r) => setTimeout(r, 250));
    }
    const release = this.#claim();
    if (this.#state.settings.wakeWord) this.#session?.abort();
    try {
      await new Promise((r) => setTimeout(r, 900)); // let the chime finish
      await this.#say(event.speech);
    } finally {
      release();
    }
  }

  async #say(text: string, { force = false } = {}) {
    const { settings, server } = this.#state;
    if (settings.muted && !force) return;
    this.#set({ status: 'speaking' });
    try {
      await this.speaker.speak(text, {
        engine: effectiveTts(settings, server),
        serverAvailable: Boolean(server?.tts.available),
        voiceURI: settings.voiceURI,
        rate: settings.rate,
        pitch: settings.pitch,
      });
    } finally {
      if (this.#state.status === 'speaking') this.#set({ status: 'idle' });
    }
  }

  // --- hands-free mode -----------------------------------------------------

  #startWakeLoop() {
    if (this.#wakeLoop) return;
    const controller = new AbortController();
    this.#wakeLoop = controller;
    void this.#runWakeLoop(controller.signal);
  }

  #stopWakeLoop() {
    this.#wakeLoop?.abort();
    this.#wakeLoop = null;
    this.#session?.abort();
    this.#forceCommand = false;
    this.#set({ awaitingCommand: false, interim: '' });
  }

  #restartWakeLoop() {
    this.#stopWakeLoop();
    this.#startWakeLoop();
  }

  async #runWakeLoop(signal: AbortSignal) {
    let failures = 0;
    try {
      await this.#ensureMic(this.#state.settings.sttEngine === 'local');
    } catch (err) {
      this.#fail(err);
      this.updateSettings({ wakeWord: false });
      return;
    }

    while (!signal.aborted) {
      // Never listen while ARES is thinking or talking: it would hear itself.
      while (this.#busy) await this.#busy;
      if (signal.aborted) break;

      try {
        const awaiting = this.#forceCommand;
        const heard = await this.#listen(awaiting ? aresConfig.wake.followUpWindowMs : undefined);
        failures = 0;
        if (signal.aborted) break;
        if (this.#busy) continue; // a typed command took over

        if (awaiting || this.#forceCommand) {
          this.#forceCommand = false;
          this.#set({ awaitingCommand: false });
          if (heard) await this.#handle(heard);
          continue;
        }

        const command = heard ? extractCommand(heard) : null;
        if (command === null) continue;
        if (command === '') {
          // Wake word alone: chime, then take the next utterance as the command.
          this.#forceCommand = true;
          this.#set({ awaitingCommand: true });
          earcon('wake');
          continue;
        }
        await this.#handle(command);
      } catch (err) {
        if (err instanceof SpeechInputError && err.fatal) {
          this.#fail(err);
          this.updateSettings({ wakeWord: false });
          return;
        }
        failures++;
        await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** failures, 8000)));
      } finally {
        if (this.#state.status === 'listening') this.#set({ status: 'idle', interim: '' });
      }
    }
    this.#scheduleMicRelease();
  }

  // --- plumbing ------------------------------------------------------------

  #speechInput(): SpeechInput {
    const engine = this.#state.settings.sttEngine;
    if (this.#input?.engine !== engine) {
      this.#input?.dispose();
      this.#input =
        engine === 'local'
          ? new LocalSttInput(() => this.#ensureMic(true))
          : new WebSpeechInput(aresConfig.stt.language);
    }
    return this.#input;
  }

  /**
   * Opens the mic for the visualizer (and local STT). With Web Speech the
   * browser captures audio itself, so a failure here is not fatal.
   */
  #ensureMic(required: true): Promise<Microphone>;
  #ensureMic(required: boolean): Promise<Microphone | null>;
  async #ensureMic(required: boolean): Promise<Microphone | null> {
    clearTimeout(this.#micReleaseTimer);
    if (this.mic) return this.mic;
    this.#micPromise ??= Microphone.open().then(
      (mic) => (this.mic = mic),
      (err: Error) => {
        this.#micPromise = null;
        throw new SpeechInputError(
          err.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it from the address bar.' : err.message,
          true,
        );
      },
    );
    if (required) return this.#micPromise;
    return this.#micPromise.catch(() => null);
  }

  #scheduleMicRelease() {
    clearTimeout(this.#micReleaseTimer);
    this.#micReleaseTimer = setTimeout(() => {
      if (!this.#wakeLoop && this.#state.status === 'idle') this.#releaseMic();
    }, MIC_IDLE_RELEASE_MS);
  }

  #releaseMic() {
    this.mic?.close();
    this.mic = null;
    this.#micPromise = null;
  }

  #push(entry: Omit<Entry, 'id' | 'at'>) {
    const full: Entry = { ...entry, id: crypto.randomUUID(), at: Date.now() };
    this.#set({ entries: [...this.#state.entries, full].slice(-MAX_ENTRIES) });
  }

  #fail(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    this.#set({ error: message, status: 'idle', interim: '' });
    earcon('error');
  }
}
