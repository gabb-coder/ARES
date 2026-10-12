# ARES

A local, voice-activated desktop assistant. Speak to it in the browser and it gets things done on your computer: it controls music and apps, runs timers and reminders, does math, checks the weather and handles files. With a local AI model it also works across your apps (Gmail, Calendar, Drive, GitHub, Notion, Slack, Linear and anything else with an MCP server) to draft emails, summarize threads and file tickets. Replies are short and spoken aloud.

- **Dashboard:** React, Vite and Tailwind CSS, with an animated microphone button, a live audio visualizer, a log of each exchange and live timers.
- **Server:** Node.js with Express, bound to `127.0.0.1`. It turns speech into intents and runs them through an extensible hook system, with an optional AI agent behind it.
- **Free by default.** The browser handles speech in and out, Ollama runs the AI locally, and Open-Meteo provides the weather. Cloud voices (ElevenLabs, Fish Audio) and Claude are optional.

```
You:   "ARES, set a pasta timer for 12 minutes."
ARES:  "Pasta timer set for 12 minutes."
You:   "Summarize my unread emails from Sam and draft a reply saying Thursday works."
ARES:  "Sam asked to move the review to Thursday. I've drafted a reply. Confirm?"
```

## Quick start

You need Node.js 20.19 or newer (22.12+ also works), plus Chrome, Edge or Safari.

```bash
git clone https://github.com/gabb-coder/ARES.git
cd ARES
npm install
npm run dev
```

Open **http://127.0.0.1:5173**, click the microphone (or press <kbd>Space</kbd>) and say *"What time is it?"*

`npm run dev` starts the API server on `:3001` and the dashboard on `:5173`. To run a single production process, use `npm run build && npm start` and open `http://127.0.0.1:3001`. To try ARES without it touching your system, run `ARES_DRY_RUN=1 npm run dev`: actions are logged instead of performed.

## What it can do

| Area | Say… |
|---|---|
| **Timers and reminders** | "Set a timer for 10 minutes" · "Set a pasta timer for 12 minutes" · "How much time is left?" · "Remind me at 3pm to call Sam" · "Remind me tomorrow to water the plants" · "What are my reminders?" · "Cancel the timer" |
| **Math and conversions** | "What's 15% of 240?" · "12 times 7 plus 3" · "Square root of 144" · "Convert 5 miles to kilometers" · "72 Fahrenheit in Celsius" · "How many cups in a liter?" |
| **Weather** | "What's the weather?" · "Weather in Tokyo tomorrow" · "Will it rain tomorrow?" · "Do I need an umbrella?" |
| **Music and volume** | "Volume to 40" · "Turn it up" · "Mute" · "Pause the music" · "Next song" · "What's playing?" (Spotify or Apple Music) |
| **Apps** (macOS: any installed app) | "Open Spotify" · "Launch Chrome" · "Quit Safari" · "Switch to Slack" · "What apps are open?" |
| **Power and appearance** | "Lock my screen" · "Turn off the display" · "Put the computer to sleep" · "Toggle dark mode" |
| **Clipboard and screen** | "Read my clipboard" · "Copy hello world to the clipboard" · "Take a screenshot" (saved to your Desktop) |
| **Files** | "List files in downloads" · "Read file notes.txt in documents" · "Create a folder called projects on my desktop" · "Take a note: call the bank" · "Find files named invoice" · "Open my downloads folder" |
| **Network** | "Check network status" · "What's my IP?" · "Ping github.com" |
| **Web** | "Open YouTube" · "Go to github dot com" · "Search YouTube for lo-fi beats" |
| **Anything else** (with the AI model) | "Explain black holes" · "Pull up my tax documents from last year" · "What's on my calendar today?" · "Draft an email to Sam about Friday" · "File a Linear ticket for the login bug" |

You don't have to start with "ARES"; "Hey ARES", "please" and "could you" are stripped before matching. The dashboard lists every command, and clicking one runs it. When a timer or reminder goes off, the dashboard chimes and speaks, and your computer shows a notification.

## Set up the local AI (free)

ARES uses [Ollama](https://ollama.com) to run a language model on your Mac. It answers open questions and powers the integrations.

1. **Install Ollama.** Download it from [ollama.com/download](https://ollama.com/download) or run `brew install ollama`, then start the Ollama app. You'll see a llama icon in the menu bar.
2. **Download a model that can use tools.** About 5 GB:
   ```bash
   ollama pull qwen3:8b
   ```
   On a Mac with 8 GB of memory, use `qwen3:4b` instead. With 32 GB or more, `qwen3:14b` is smarter.
3. **Point ARES at it.** Create `server/.env` from the template and turn the AI on:
   ```bash
   cp server/.env.example server/.env
   ```
   Then edit `server/.env`:
   ```ini
   ARES_BRAIN=ollama
   OLLAMA_MODEL=qwen3:8b
   ```
4. **Restart ARES** (<kbd>Ctrl</kbd>+<kbd>C</kbd>, then `npm run dev`). The dashboard header shows **LLM · ollama**. Try *"Explain how a heat pump works."*

Built-in commands still run instantly; the model only handles what they don't. `OLLAMA_THINK=false` (the template's setting) skips the model's slow "thinking" step for faster spoken replies. If you prefer Claude, set `ARES_BRAIN=anthropic` and `ANTHROPIC_API_KEY` instead (paid).

## Integrations: Gmail, Calendar, GitHub, Notion, Slack and more

ARES connects to apps through [MCP](https://modelcontextprotocol.io) (Model Context Protocol), the open standard AI assistants use for tool integrations. Thousands of MCP servers exist, so if an app has one, ARES can use it.

1. Copy the example, which has Google Workspace, GitHub, Notion, Slack and Linear set up but switched off:
   ```bash
   cp server/integrations.example.json server/integrations.json
   ```
2. For each app you want, set `"disabled": false` and add its secret to `server/.env`. The config refers to secrets as `${NAME}`.
3. Restart ARES. The **Integrations** panel on the dashboard shows each app's status. The AI model must be on (see above).

| App | How it connects | What you need |
|---|---|---|
| **Gmail, Calendar, Drive, Docs** | [`workspace-mcp`](https://pypi.org/project/workspace-mcp/) (runs with `uvx`; install [uv](https://docs.astral.sh/uv/) via `brew install uv`) | A Google Cloud OAuth client: `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. The first request asks you to sign in with Google; the link appears in the log. |
| **GitHub** | GitHub's hosted MCP server | A [personal access token](https://github.com/settings/tokens) as `GITHUB_TOKEN` |
| **Notion** | [`@notionhq/notion-mcp-server`](https://github.com/makenotion/notion-mcp-server) | An [integration token](https://www.notion.so/profile/integrations) as `NOTION_TOKEN`, with your pages shared to it |
| **Slack** | [`slack-mcp-server`](https://github.com/korotovsky/slack-mcp-server) | A user token as `SLACK_MCP_XOXP_TOKEN`. Posting is off unless you also set `SLACK_MCP_ADD_MESSAGE_TOOL`. |
| **Linear** | Linear's hosted MCP server | Nothing. Click **Sign in** in the Integrations panel. |

Any other MCP server works the same way: paste its config (the same `mcpServers` format Claude Desktop uses) into `integrations.json`. A server can be a local command (`command`, `args`, `env`) or a remote URL (`url`, optional `headers`). Remote servers without an `Authorization` header sign in with OAuth: ARES shows a **Sign in** button, you approve in the browser, and the token is saved in `~/.ares/oauth/` (readable only by you).

**ARES confirms before it acts.** Tools that only read (searching email, listing events, reading pages) run immediately. Anything that sends, creates, changes or deletes something pauses first. ARES says what it's about to do ("Ready to send email to Sam… Confirm?") and shows the details on screen. Say *"yes"* or *"cancel"*, or use the buttons. Unanswered requests expire after 3 minutes. Tools count as read-only when the server marks them that way, or when they are unmarked and named like `get_…`, `list_…` or `search_…`.

Optional per-app keys in `integrations.json`:

| Key | Purpose |
|---|---|
| `keywords` | Only offer this app's tools when one of these words is spoken (e.g. `["email", "inbox"]`). Keeps small local models focused. |
| `includeTools` / `excludeTools` | Limit which of the server's tools ARES may use. |
| `autoApprove` | Tool names that skip confirmation, or `true` for all. |
| `disabled` | Keep the entry without connecting. |

ARES also gives the model its own tools for your computer: search, list, read and open files (inside the filesystem sandbox), open web pages and set reminders. That's how *"pull up my tax documents from last year"* works with no integration at all.

## macOS permissions

The first time ARES does certain things, macOS asks for permission for **Terminal** (or whichever app runs `npm run dev`):

| Feature | Permission |
|---|---|
| Music control, "what apps are open", dark mode | **Automation**: allow control of Spotify, Music and System Events when prompted |
| Lock screen | **Accessibility**: System Settings → Privacy & Security → Accessibility → Terminal. Without it, ARES turns the display off instead, which locks if a password is required after sleep. |
| Screenshots | **Screen Recording**: System Settings → Privacy & Security → Screen & System Audio Recording → Terminal. Without it, screenshots only show the desktop background. |
| Timer and reminder notifications | **Notifications** for Script Editor (macOS shows them on its behalf) |

On Linux, ARES uses `pactl`, `playerctl`, `xclip`/`wl-clipboard`, `loginctl`, `gsettings` and `notify-send` where they're installed. On Windows, it uses media keys, lock and sleep. Anything unavailable gets a short spoken "isn't supported on … yet".

## How it works

```
 Browser dashboard                                ARES server (127.0.0.1:3001)
┌────────────────────────────────────┐          ┌──────────────────────────────────────────────┐
│ Mic ─ Web Audio ─▶ visualizer      │          │ POST /api/command                            │
│  ├─ Web Speech API ─ transcript ───────────────▶  normalize ─▶ hooks (priority order)        │
│  └─ AudioWorklet PCM ─ /ws/stt ────────────────▶  │   timers · math · weather · media · apps  │
│      (local Whisper option)        │          │  │   files · network · power · web · plugins │
│                                    │          │  └─ no match ─▶ AI agent (Ollama / Claude)   │
│                                    │          │        ├─ ARES tools (files, URLs, reminders)│
│                                    │          │        └─ MCP integrations ─▶ Gmail, GitHub… │
│ Confirm / Cancel ◀── pending action ◀──────────│           (actions wait for your yes)        │
│ speechSynthesis ◀── reply ◀─────────────────────│                                              │
│ alerts ◀── /api/events (SSE) ◀───────────────────│ scheduler: timers, reminders (~/.ares)       │
└────────────────────────────────────┘          └──────────────────────────────────────────────┘
```

1. **Hear.** The mic button captures audio through the Web Audio API. The browser's Web Speech API transcribes it, or a local Whisper server does.
2. **Match.** The server strips filler and checks each hook in priority order. Built-in commands answer in milliseconds without the model.
3. **Think.** Anything else goes to the agent. It can call ARES's own tools and your integrations' tools, chaining several calls. Read-only calls run straight away; actions wait for your confirmation.
4. **Speak.** Replies are kept to one to three sentences and read aloud, with detail shown as a card in the log.
5. **Alert.** Timers and reminders fire on the server (reminders survive restarts), which pushes them to the dashboard over server-sent events.

## Voice pipeline

**Speech-to-text.** By default the browser's Web Speech API transcribes speech. It's instant, but Chrome and Edge send the audio to their vendor's servers. **Local Whisper** keeps audio on your machine and works in every browser:

```bash
./build/bin/whisper-server -m models/ggml-base.en.bin --port 8080   # whisper.cpp
```

```ini
# server/.env
LOCAL_STT_URL=http://127.0.0.1:8080
LOCAL_STT_API=whisper.cpp      # or "openai" for faster-whisper-server, speaches, LocalAI…
```

Then pick **Local Whisper** in the dashboard settings.

**Text-to-speech.** The browser's `speechSynthesis` is the default: free, offline, and set to a calm en-GB voice when one is installed. For a cloud voice, set `TTS_PROVIDER=elevenlabs` (or `fishaudio`) and its API key in `server/.env`. The dashboard switches to it automatically and falls back to the browser voice if a request fails. Keys stay on the server, and the dashboard calls `POST /api/tts`. Dashboard defaults live in [`client/src/config.ts`](client/src/config.ts).

**Hands-free mode.** Toggle the ear icon and ARES listens continuously, responding to *"ARES, …"*. When it asks you to confirm something, just answer *"yes"*; no wake word is needed. ARES stops listening while it's thinking or speaking, so it never hears itself.

## Writing hooks

A hook turns an utterance into parameters (`match`) and acts on them (`run`). Drop a file into `server/plugins/` and it loads at startup:

```ts
// server/plugins/standup.ts
import { patterns } from '../src/core/intent.js';
import { defineHook } from '../src/core/types.js';

export default defineHook({
  name: 'standup.start',
  category: 'Work',
  description: 'Start the daily standup routine',
  examples: ['Start my standup'],
  match: patterns(/^start (?:my )?standup$/i),
  async run(_params, ctx) {
    await ctx.system.setVolume(30);
    await ctx.system.openApp('Zoom');
    ctx.scheduler.add('timer', 'Standup timer', Date.now() + 15 * 60_000);
    return { speech: 'Standup ready. Fifteen minutes on the clock.' };
  },
});
```

- **Matching.** `match` sees the normalized utterance (wake word, politeness and trailing punctuation stripped; case kept). `patterns(...)` turns regexes with named groups into a matcher.
- **Priority.** Hooks with a higher `priority` are tried first. `fs.open` (20) and `app.*` (10) sit above `web.open` (-10), so "open downloads" opens a folder and "open YouTube" a website.
- **Context.** `ctx.system` controls volume, media, apps, power, appearance, clipboard and notifications. `ctx.scheduler` sets timers and reminders. `ctx.fs` resolves sandboxed paths and `ctx.launcher` opens URLs and files. `ctx.config` and `ctx.log` are also available.
- **Replies.** Return a short `speech` and an optional `card: { title, items?, fields?, body?, link? }`. A thrown error becomes "That failed. *reason*."

[`server/plugins/dice.ts`](server/plugins/dice.ts) is a working example.

## Configuration

Copy [`server/.env.example`](server/.env.example) to `server/.env`. Every setting is optional.

| Variable | Default | Purpose |
|---|---|---|
| `ARES_HOST` / `ARES_PORT` | `127.0.0.1` / `3001` | Where the API listens |
| `ARES_FS_ROOT` | home folder | The only directory file commands and tools can touch |
| `ARES_DATA_DIR` | `~/.ares` | Reminders and integration sign-ins |
| `ARES_DRY_RUN` | `false` | Log system actions instead of performing them |
| `ARES_APPS` | per-OS defaults | Extra app nicknames: `{"spotify":["spotify"]}` |
| `WEATHER_LOCATION` / `WEATHER_UNITS` | (unset) / by region | Default city (or `lat,lon`) and `celsius` or `fahrenheit` |
| `ARES_BRAIN` | `none` | `none`, `ollama` or `anthropic` |
| `OLLAMA_MODEL` / `OLLAMA_THINK` | `qwen3:8b` / model default | Local model, and whether it "thinks" first |
| `ARES_AGENT_MAX_TOOLS` | `40` | Most tools offered to the model per request |
| `ARES_INTEGRATIONS` | `integrations.json` | MCP integrations file (relative to `server/`) |
| `TTS_PROVIDER` | `browser` | `browser`, `elevenlabs` or `fishaudio` |
| `LOCAL_STT_URL` | (unset) | Whisper server for local speech-to-text |

## Security model

ARES executes commands and can act in your accounts, so it is locked down by default:

- **Local only.** It binds to `127.0.0.1`. API calls and WebSocket upgrades must come from the dashboard's origin, which stops other websites in your browser from using it, and the `Host` header is checked to block DNS rebinding.
- **Confirmation before actions.** Integration tools that send, create, change or delete wait for your explicit yes, and so does the AI opening a web page (an instruction hidden in an email could otherwise smuggle data out in a link). The confirmation card shows exactly what will be sent.
- **Filesystem sandbox.** Paths, including those the AI asks for, resolve inside `ARES_FS_ROOT` with symlinks followed. Files are never overwritten, and there is no delete command.
- **No shell.** Every OS command runs as an argument list with `shell: false`. AppleScript receives spoken names as arguments, never as script text, so a spoken name can't inject commands.
- **Secrets stay on the server.** API keys live in `server/.env`. OAuth tokens are stored in `~/.ares/oauth/` with owner-only permissions. Neither ever reaches the browser, and `integrations.json` is git-ignored.

## Project layout

```
ARES/
├── client/                         React + Vite + Tailwind dashboard
│   ├── public/pcm-worklet.js       AudioWorklet: mic → 16 kHz PCM
│   └── src/
│       ├── lib/assistant.ts        state machine: listen → think → speak, alerts, confirmations
│       ├── lib/speech/             Web Speech input, local STT client, TTS speaker
│       └── components/             mic + visualizer, log, confirm card, timers, integrations
└── server/
    ├── .env.example
    ├── integrations.example.json   Gmail/Calendar/Drive, GitHub, Notion, Slack, Linear
    ├── plugins/                    drop-in hooks
    ├── src/
    │   ├── hooks/                  timers, math, weather, media, apps, desktop, files, network, web
    │   ├── services/               agent (Ollama/Claude), OS controls, scheduler, sandbox, TTS, STT
    │   ├── integrations/           MCP client manager, OAuth, built-in agent tools
    │   ├── core/                   hook registry, intent parsing, events
    │   └── persona.ts              ARES's voice and system prompt
    └── test/                       Vitest suite, including a real MCP server and OAuth flow
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

- **`npm error enoent Could not read package.json`.** Run commands inside the `ARES` folder (`cd ARES`), not your home folder.
- **"Microphone access was blocked."** Allow the microphone from the address bar's site settings.
- **"Ollama isn't reachable."** Start the Ollama app (llama icon in the menu bar) or run `ollama serve`.
- **"Model … isn't installed."** Run `ollama pull qwen3:8b`, or whichever model `OLLAMA_MODEL` names.
- **An integration shows an error.** Hover over it to read the reason. Common ones are a missing secret ("Set NOTION_TOKEN in server/.env") or a missing tool (`uvx` needs `brew install uv`). Click retry after fixing it.
- **The AI ignores an app.** Small models handle a few tools better than many. Add `keywords` to that app in `integrations.json`, or use `includeTools` to trim its tool list.
- **Music, lock or screenshots don't work on macOS.** Grant the permissions listed above, then try again.
- **"The browser's speech service is unreachable."** Chrome's recognition needs internet access. Switch to Local Whisper to work offline.
- **Hands-free mode stays silent after a reload.** Click anywhere on the page once; browsers keep audio suspended until you interact with it.
