/**
 * Dashboard defaults. Users can change most of these from the settings panel;
 * their choices are saved in this browser.
 */
export const aresConfig = {
  stt: {
    /**
     * webspeech = the browser's Web Speech API (Chrome, Edge, Safari). Instant
     *             and free; note that Chrome transcribes on Google's servers.
     * local     = stream the mic to the ARES server, which forwards it to a
     *             local whisper server (LOCAL_STT_URL). Fully offline.
     */
    engine: 'webspeech' as SttEngine,
    language: 'en-US',
    /** Local engine: silence that ends an utterance. */
    endOfSpeechMs: 900,
    /** Local engine: give up if no speech starts within this window. */
    noSpeechTimeoutMs: 8000,
    /** Local engine: RMS level (0–1) treated as speech. */
    speechThreshold: 0.02,
  },
  tts: {
    /**
     * auto    = the server's cloud voice when one is configured, else browser.
     * browser = Web Speech Synthesis. Free, offline, no keys.
     * server  = the cloud voice configured on the server (ElevenLabs or Fish
     *           Audio via TTS_PROVIDER). Falls back to the browser voice on error.
     */
    engine: 'auto' as TtsEngine | 'auto',
    /** First installed voice that matches wins. Calm, low, en-GB voices suit ARES. */
    preferredVoices: [
      'Microsoft Ryan Online (Natural) - English (United Kingdom)',
      'Google UK English Male',
      'Daniel',
      'Arthur',
      'Microsoft George - English (United Kingdom)',
      'Microsoft Guy Online (Natural) - English (United States)',
      'Alex',
    ],
    rate: 1.05,
    pitch: 0.9,
    volume: 1,
  },
  wake: {
    /** Hands-free mode: listen continuously and respond to "ARES, …". */
    enabled: false,
    /** Seconds to wait for a command after hearing the wake word alone. */
    followUpWindowMs: 7000,
  },
};

export type SttEngine = 'webspeech' | 'local';
export type TtsEngine = 'browser' | 'server';
