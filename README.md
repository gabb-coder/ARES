# ARES

A local, voice-activated desktop assistant. Speak to it in the browser and it runs commands on your machine: it reads and organizes files, checks the network, opens websites and launches apps. Replies are short and spoken aloud.

- **Dashboard:** React, Vite and Tailwind CSS, with an animated microphone button and a live audio visualizer.
- **Server:** Node.js with Express, bound to `127.0.0.1`. It turns transcripts into intents and runs them through an extensible hook system.
- **Free by default.** The browser handles speech in both directions (Web Speech API in, Speech Synthesis out), so you need no API keys. Cloud voices (ElevenLabs, Fish Audio), local Whisper transcription and an LLM fallback are optional.

```
You:   "ARES, list files in my downloads folder."
ARES:  "2 folders and 14 files in Downloads."
```

## Quick start

Requires Node.js 20.19+ (or 22.12+), plus Chrome, Edge or Safari for in-browser speech recognition.

```bash
npm install
npm run dev
```

Open **http://127.0.0.1:5173**, click the microphone (or press <kbd>Space</kbd>) and say *"What time is it?"*.

`npm run dev` starts the API server on `:3001` and the Vite dashboard on `:5173`, with hot reload for both. For a single production process:

```bash
npm run build   # builds the dashboard into client/dist
npm start       # serves API + dashboard at http://127.0.0.1:3001
```

To try ARES without it touching your system, run `ARES_DRY_RUN=1 npm run dev`. URLs, apps and files are then logged instead of opened.

## What it can do

| Area | Say… | Hook |
|---|---|---|
| Files | "List files in downloads" · "What's on my desktop?" | `fs.list` |
| | "Read file notes dot txt in documents" | `fs.read` |
| | "Create a folder called projects on my desktop" | `fs.mkdir` |
| | "Create a file called todo.txt with buy milk" | `fs.touch` |
| | "Take a note: call the bank tomorrow" | `fs.note` |
| | "Find files named invoice in documents" | `fs.search` |
| | "Open my downloads folder" · "Open file report.pdf" | `fs.open` |
| Network | "Check network status" · "Am I online?" | `net.status` |
| | "What's my IP?" · "What's my public IP?" | `net.ip` |
| | "Ping github.com" · "Is google dot com up?" | `net.ping` |
| Web | "Open YouTube" · "Go to github dot com" | `web.open` |
| | "Search for espresso grinders" · "Search YouTube for lo-fi" | `web.search` |
| Apps | "Open calculator" · "Launch terminal" | `app.launch` |
| System | "What time is it?" · "What's the date?" · "System status" | `system.*` |
| ARES | "Who are you?" · "Help" | `ares.*` |
| Plugin example | "Flip a coin" · "Roll a d20" | `fun.*` |

You can address ARES by name or not; "Hey ARES", "please" and "could you" are stripped before matching. The dashboard lists every registered hook, and clicking an example runs it.

## How it works

```
 Browser dashboard                                   ARES server  (127.0.0.1:3001)
┌──────────────────────────────────────┐            ┌──────────────────────────────────────────┐
│ getUserMedia ─▶ Web Audio analyser ──▶ visualizer │                                          │
│      │                               │            │  POST /api/command { text }              │
│      ├─▶ Web Speech API ── transcript ────────────▶   normalize ("Hey ARES, please …")       │
│      │   (default)                   │            │   HookRegistry: first match by priority  │
│      └─▶ AudioWorklet 16 kHz PCM ─── /ws/stt ─────▶   └─ hook.run() ─ fs · net · launcher    │
│          (local mode)                │            │      no match ─▶ LLM fallback (optional) │
│                                      │            │   ◀─ { speech, card }                    │
│ speechSynthesis ◀── speech ◀─────────────────────────────────────────────────────────────────│
│ <audio> ◀── /api/tts ◀── ElevenLabs / Fish Audio (optional, keys stay server-side)           │
└──────────────────────────────────────┘            └──────────────────────────────────────────┘
```

1. **Capture.** The mic button opens the microphone through the Web Audio API, which drives the radial visualizer.
2. **Transcribe.** The browser's Web Speech API transcribes the speech, or in local mode the dashboard streams 16 kHz PCM to the server and a local Whisper server transcribes it.
3. **Parse.** The server normalizes the transcript and asks each hook, in priority order, whether it matches. The first match extracts parameters, such as `{ location: "downloads" }`.
4. **Execute.** The hook runs. Filesystem work stays inside a sandbox, and URLs, files and apps open through a single launcher with no shell.
5. **Respond.** The hook returns a one-line `speech` plus an optional `card` (a list, key/value pairs or file contents) for the log.
6. **Speak.** The dashboard reads the reply aloud with the browser voice, or with a cloud voice when one is configured.

## Voice pipeline

### Speech-to-text

| Engine | How | Notes |
|---|---|---|
| **Web Speech** (default) | Browser `SpeechRecognition` | Instant, no setup. Chrome and Edge transcribe on their vendor's servers, so audio leaves the machine. Not available in Firefox. |
| **Local Whisper** | Mic → AudioWorklet → `/ws/stt` → your Whisper server | Fully offline and works in any browser. The end of an utterance is detected in the dashboard by an energy-based voice-activity detector. |

To use Local Whisper, run a Whisper server and point ARES at it. For example, with [whisper.cpp](https://github.com/ggml-org/whisper.cpp):

```bash
./build/bin/whisper-server -m models/ggml-base.en.bin --port 8080
```

```ini
# server/.env
LOCAL_STT_URL=http://127.0.0.1:8080
LOCAL_STT_API=whisper.cpp      # or "openai" for faster-whisper-server, speaches, LocalAI…
```

Then pick **Local Whisper** in the dashboard settings.

### Text-to-speech

The browser's `speechSynthesis` is the default. It is free and offline, and ARES prefers a calm en-GB voice when one is installed. You can choose the voice, rate and pitch in settings.

For a cloud voice, set the provider and key in `server/.env`. The dashboard switches to it automatically and falls back to the browser voice if a request fails:

```ini
TTS_PROVIDER=elevenlabs          # or fishaudio
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
# FISH_AUDIO_API_KEY=...
# FISH_AUDIO_REFERENCE_ID=<voice model id>
```

API keys never reach the browser: the dashboard calls `POST /api/tts`, and the server forwards the request to the provider. Dashboard-side defaults (engines, preferred voices, rate, pitch, voice-activity thresholds) live in [`client/src/config.ts`](client/src/config.ts).

### Hands-free mode

Toggle the ear icon to make ARES listen continuously and respond only when addressed: *"ARES, open YouTube"*. Saying just *"ARES"* plays a chime, and your next sentence is taken as the command. While hands-free mode is on, pressing the mic button skips the wake word for one command. ARES stops listening while it is thinking or speaking, so it never hears itself.

## Persona

ARES is calm, capable and brief, because spoken replies need to be fast. Each hook writes its own reply in that register ("Online. 18 millisecond latency.", "Folder projects created."). Shared phrasing, the speech cleanup (Markdown, links and code stripped, long text cut at a sentence boundary) and the LLM system prompt are in [`server/src/persona.ts`](server/src/persona.ts).

## Writing hooks

A hook is an object with a `match` function, which turns an utterance into parameters or returns `null`, and a `run` function, which acts and returns what to say:

```ts
// server/plugins/weather.ts: any .ts/.js file in server/plugins/ loads at startup
import { patterns } from '../src/core/intent.js';
import { defineHook } from '../src/core/types.js';

export default defineHook({
  name: 'weather.now',
  category: 'Weather',
  description: 'Current weather for a city',
  examples: ['Weather in Lisbon'],
  match: patterns(/^(?:what's the )?weather in (?<city>.+)$/i),
  async run({ city }, ctx) {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city!)}?format=%C+%t`);
    return { speech: `${city}: ${(await res.text()).trim()}.` };
  },
});
```

- **Matching.** `match` receives the normalized utterance (wake word, politeness and trailing punctuation already stripped; case kept). `patterns(...)` turns regexes with named groups into a matcher.
- **Priority.** Hooks with a higher `priority` are tried first, and hooks with equal priority are tried in registration order. Built-in `fs.open` (20) and `app.launch` (10) sit above `web.open` (-10), so "open downloads" opens a folder and "open YouTube" opens a site.
- **Context.** `ctx.fs` resolves paths inside the sandbox, `ctx.launcher` opens URLs, files and apps, and `ctx.config` and `ctx.log` give access to configuration and logging.
- **Replies.** Keep `speech` to one or two short sentences and put detail in `card: { title, items?, fields?, body?, link? }`.
- **Errors.** A thrown error becomes "That failed. *reason*." Hooks time out after 15 seconds.
- **Plugins.** A plugin exports one hook or an array of hooks. If a plugin fails to load, the error is logged and the server starts without it. Files starting with `_` are ignored. [`server/plugins/dice.ts`](server/plugins/dice.ts) is a working example.

Built-in hooks live in [`server/src/hooks/`](server/src/hooks) and are registered in [`hooks/index.ts`](server/src/hooks/index.ts).

## Optional LLM fallback

By default, a request that no hook matches gets *"No hook handles that yet."* Set `ARES_BRAIN` to answer general questions in the ARES persona instead:

| `ARES_BRAIN` | Backend | Cost |
|---|---|---|
| `none` (default) | Rule-based only | Free, offline |
| `ollama` | Any local model via [Ollama](https://ollama.com) (`OLLAMA_MODEL=llama3.2`) | Free, offline |
| `anthropic` | Claude via the Anthropic API (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL=claude-opus-5-5`) | Paid API |

Hooks always run first, and the LLM only answers questions. It cannot take actions on your machine. It sees the list of available commands so it can point you to the right phrase, plus the last few exchanges so follow-up questions work.

## Configuration

Copy [`server/.env.example`](server/.env.example) to `server/.env`. Every setting is optional:

| Variable | Default | Purpose |
|---|---|---|
| `ARES_HOST` / `ARES_PORT` | `127.0.0.1` / `3001` | Where the API listens |
| `ARES_FS_ROOT` | your home folder | The only directory filesystem hooks can touch |
| `ARES_APPS` | per-OS defaults | JSON allowlist of launchable apps, e.g. `{"spotify":["spotify"]}` |
| `ARES_DRY_RUN` | `false` | Log system actions instead of performing them |
| `ARES_PLUGIN_DIR` | `plugins` | Drop-in hook directory |
| `TTS_PROVIDER` | `browser` | `browser`, `elevenlabs` or `fishaudio` |
| `LOCAL_STT_URL` | (unset) | Whisper server for local speech-to-text |
| `ARES_BRAIN` | `none` | `none`, `ollama` or `anthropic` |

## Security model

ARES executes commands, so it is locked down by default:

- **Local only.** It binds to `127.0.0.1`. Every API call and WebSocket upgrade must come from the dashboard's origin, which blocks other websites open in your browser, and the `Host` header is checked to defeat DNS rebinding.
- **Filesystem sandbox.** Paths are resolved inside `ARES_FS_ROOT`, following symlinks, so `../` and links cannot escape it. Files are never overwritten, and there is no delete hook.
- **No shell.** URLs open through [`open`](https://github.com/sindresorhus/open) (http and https only), and apps start from an explicit argv allowlist with `shell: false`.
- **Keys stay on the server.** `/api/config` reports which features are enabled, never their credentials.

## Project layout

```
ARES/
├── client/                      React + Vite + Tailwind dashboard
│   ├── public/pcm-worklet.js    AudioWorklet: mic → 16 kHz PCM16
│   └── src/
│       ├── config.ts            dashboard voice defaults (STT/TTS engines, voices, VAD)
│       ├── lib/assistant.ts     state machine: idle → listening → thinking → speaking
│       ├── lib/audio/           Web Audio mic capture, earcons
│       ├── lib/speech/          Web Speech input, local STT client, TTS speaker
│       └── components/          MicButton + visualizer, log, hooks list, settings
└── server/
    ├── .env.example
    ├── plugins/                 drop-in hooks (dice.ts example)
    ├── src/
    │   ├── index.ts             entry point
    │   ├── persona.ts           ARES voice, speech shaping, LLM system prompt
    │   ├── security.ts          origin / host guard
    │   ├── core/                hook types, registry, intent normalizer, plugin loader
    │   ├── hooks/               built-in hooks: ares, system, filesystem, network, apps, web
    │   ├── services/            fs sandbox, launcher, TTS, STT, LLM fallback
    │   ├── routes/api.ts        REST API
    │   └── ws/sttSocket.ts      microphone streaming for local STT
    └── test/                    Vitest: intent table, hooks, sandbox, API, WebSocket, LLM wiring
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | API server and dashboard with hot reload |
| `npm run build` | Production dashboard build |
| `npm start` | API server, plus the built dashboard if present |
| `npm test` | Server test suite |
| `npm run typecheck` | TypeScript checks for both workspaces |

## Troubleshooting

- **"Microphone access was blocked."** Allow the microphone from the address bar's site settings. Browsers only allow microphone access on `localhost`/`127.0.0.1` or HTTPS.
- **"The browser's speech service is unreachable."** Chrome's recognition needs internet access. Switch to Local Whisper to work offline.
- **No voices, or a robotic voice, on Linux.** Chrome uses `speech-dispatcher`. Install it with a voice such as `espeak-ng`, or configure a cloud voice.
- **Firefox.** Firefox has no Web Speech recognition. Use Local Whisper. Speech output still works.
- **Hands-free mode stays silent after a reload.** Click anywhere on the page once; browsers keep audio suspended until you interact with it.
