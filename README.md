# 🏛️ Quorum

Five AI advisors debate your toughest decisions across three rounds and deliver a verdict.

Sparked by the idea behind [wartable.co](https://wartable.co/) — a panel of AIs arguing out a decision — Quorum takes it further: **you choose which AI powers the panel**, right in the app, with no forced subscription or spend. Four engines, picked from a settings panel:

1. **🖥️ Local / free — no account at all**: any OpenAI-compatible server. Local: [Ollama](https://github.com/ollama/ollama), [LM Studio](https://lmstudio.ai), [Jan](https://github.com/menloresearch/jan), [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`), [LocalAI](https://github.com/mudler/LocalAI). Free hosted tiers: OpenRouter (`:free` models), Groq, Google AI Studio, Cerebras.
2. **🔑 Claude API**: paste an `ANTHROPIC_API_KEY`. A new [console.anthropic.com](https://console.anthropic.com) account comes with free starter credits — no subscription needed.
3. **💎 Claude subscription**: uses the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk) and your existing Claude Code login (Pro/Max), no API key.
4. **🎭 Demo**: canned answers, zero usage — handy for trying the UI.

Your choice and any keys are saved **only in your browser** (localStorage) and sent only to the Quorum server you run. You can still set env vars (below) to preselect a default; the in-app picker overrides them per request.

The panel is five personas, each arguing from its own angle:

| Panelist | Default model | Angle |
|---|---|---|
| The Strategist | `sonnet` | Long-term thinking, second-order effects |
| The Skeptic | `sonnet` | Hidden assumptions and failure modes |
| The Pragmatist | `sonnet` | What can actually be executed |
| The Contrarian | `sonnet` | Steelmans the side nobody else will |
| The Analyst | `haiku` | First principles, numbers, base rates |
| **The Arbiter** (judge) | `sonnet` | Weighs the transcript, delivers the verdict |

Defaults are Pro-friendly. On a Max plan you can promote the panel to Opus (see Configuration) — or, for a genuinely multi-model quorum, give each advisor a *different* model (see below).

## How it works

1. You ask a question.
2. **Round 1 — Opening positions:** all five panelists state their stance.
3. **Round 2 — Cross-examination:** each panelist reads the others' openings, attacks the weakest argument, and defends their own.
4. **Round 3 — Closing arguments:** final recommendations, with forced concessions.
5. **Verdict:** the Arbiter reads the full transcript and delivers a structured ruling — verdict, decisive arguments, dissent worth keeping, and a confidence percentage.
6. **Follow-ups:** after the verdict, ask the panel anything else ("what if I wait six months?"). Every advisor answers with the full debate in mind, and the Arbiter issues an updated verdict. Repeat as many times as you like.

Everything streams live to the browser over Server-Sent Events, and a **⏹ Stop
debate** button cancels mid-flight (the server aborts in-progress turns, so no
usage is wasted).

## History & export

- Every debate (with all its follow-ups) is saved to **🗂 History** — stored
  only in this browser's localStorage, most recent 50. Reopen any past debate
  and even continue it with new follow-ups.
- Each verdict has **⎘ Copy verdict** (Markdown to clipboard) and
  **⬇ Download transcript** (the full debate as a `.md` file).

## Requirements

- Node.js 18+
- Whichever engine you plan to use: a local server (Ollama etc.), an `ANTHROPIC_API_KEY`, or Claude Code logged in — see the four options above. None are required to launch the app itself.

## Run it

```bash
npm install
npm start
# open http://localhost:3000, then click ⚙︎ Engine and choose your backend
```

That's it — everything is picked in the UI. If you'd rather set a **default** engine
so it's preselected (e.g. for a shared/hosted instance), use env vars:

```bash
# Default to local Ollama:
ollama pull llama3.1
LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=llama3.1 npm start

# Default to the Claude API:
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Env default priority (when the request doesn't pick one): `LLM_BASE_URL` > `ANTHROPIC_API_KEY` > Claude Code login.

### Local / free endpoints (choose in ⚙︎ Engine → Local, or as `LLM_BASE_URL`)

The Local option has presets for these; "Other…" lets you type any URL.

| Server | URL | Notes |
|---|---|---|
| Ollama | `http://localhost:11434/v1` | CLI-first, easiest local option |
| LM Studio | `http://localhost:1234/v1` | Polished GUI + model browser |
| llama.cpp (`llama-server`) | `http://localhost:8080/v1` | Zero-dependency workhorse |
| Jan / LocalAI | see their docs | Open-source local servers |
| OpenRouter | `https://openrouter.ai/api/v1` | 20+ `:free` models; paste an API key; model e.g. `meta-llama/llama-3.3-70b-instruct:free` |
| Groq | `https://api.groq.com/openai/v1` | Fast free tier; paste an API key |
| Google AI Studio | `https://generativelanguage.googleapis.com/v1beta/openai` | Free Gemini quota; paste an API key |

### A true multi-model quorum

Open **🎛️ Different model per advisor** under ⚙︎ Engine to give each of the five
panelists — and the judge — its own model, instead of one model playing all five
personas. With Ollama this is a real *quorum of different minds*, closest to the
wartable.co idea of independently-sourced advisors:

```bash
ollama pull llama3.1 && ollama pull qwen2.5 && ollama pull mistral && ollama pull gemma2 && ollama pull phi3
LLM_BASE_URL=http://localhost:11434/v1 npm start
```

Then in the panel, set: Strategist → `llama3.1`, Skeptic → `qwen2.5`, Pragmatist →
`mistral`, Contrarian → `gemma2`, Analyst → `phi3`. (The same override is available
as `DEBATER_MODELS` / `JUDGE_MODEL` env vars if you'd rather set it as the default —
see Configuration.)

Want to try the UI without spending any usage? Demo mode streams canned responses:

```bash
npm run dev   # MOCK=1
```

## Install as an app (desktop & mobile)

Quorum is a **PWA**, so it installs as a real app — its own window, icon and
splash — on all five platforms from a single codebase. The AI backend (Ollama /
Claude / API) always runs on the computer that serves the app; phones connect to
it over your Wi-Fi.

### 🖥️ Windows · macOS · Linux

Two options:

- **Install the PWA (quickest):** run `npm start`, open `http://localhost:3000`
  in Chrome or Edge, and click the **⬇︎ Install app** button (or the install icon
  in the address bar). You get a standalone windowed app in your Start menu /
  Launchpad / app grid.
- **Native desktop app (no browser, no terminal):** package it with Electron —
  it bundles the server and everything else into a single installer:
  ```bash
  cd desktop
  npm install
  npm run dist        # or dist:win / dist:mac / dist:linux
  # installers land in desktop/dist/  (.exe / .dmg / .AppImage · .deb)
  ```
  During development, `npm start` inside `desktop/` launches the app directly.
  > Each installer is built **on its own OS** (Windows `.exe` on Windows, `.dmg`
  > on macOS, etc.), or all three from CI — that's an Electron/electron-builder
  > requirement, not a limitation of this app.

### 📱 Android · iOS

The phone runs the app in installed/full-screen mode; the debate itself runs on
your computer's backend.

1. On your computer: `npm start` (it prints a `http://192.168.x.x:3000` URL for your phone).
2. On the phone (same Wi-Fi), open that URL:
   - **Android (Chrome):** menu → **Add to Home screen / Install app**.
   - **iOS (Safari):** Share → **Add to Home Screen**.
3. Launch it from the home-screen icon — full screen, no browser chrome.

> **Note on mobile install:** iOS "Add to Home Screen" works over plain Wi-Fi
> (`http://`). Android's full *Install* prompt needs HTTPS or `localhost`; over a
> plain LAN address it still adds a home-screen shortcut. For a first-class
> install prompt on Android, put the app behind HTTPS — e.g. a quick tunnel
> (`cloudflared tunnel --url http://localhost:3000`) or any reverse proxy with a
> certificate.

## Configuration

| Env var | Purpose |
|---|---|
| `LLM_BASE_URL` | Switches to any OpenAI-compatible backend (Ollama, LM Studio, llama.cpp, OpenRouter, Groq…). |
| `LLM_MODEL` | Default model for the whole panel on the local backend (default `llama3.1`). |
| `LLM_API_KEY` | API key for hosted OpenAI-compatible providers (not needed for local servers). |
| `ANTHROPIC_API_KEY` | Switches to the Claude API backend (the no-subscription Claude path). |
| `DEBATER_MODELS` | Comma-separated list of up to 5 models to override the panel — the env-var equivalent of the in-app "different model per advisor" panel. Accepts aliases (`opus`, `sonnet`, `haiku`) or full model IDs. E.g. `DEBATER_MODELS=opus,opus,sonnet,sonnet,haiku` |
| `JUDGE_MODEL` | Model for the Arbiter (default `sonnet`; `opus` recommended on Max). |
| `DEBATE_CONCURRENCY` | How many panelists speak at once (default 3). Lower it if you hit plan limits. |
| `TURN_TIMEOUT_MS` | Hard per-turn ceiling (default 300000 = 5 min). Raise it for very large, slow local models. |
| `MOCK=1` | Demo mode — canned responses, no usage. |
| `PORT` | Server port (default 3000). |

## Notes

- Debaters answer in the language the question was asked in.
- One full debate = 16 messages (15 turns + verdict) against your plan's usage limits or API credits. If you hit a limit mid-debate, the affected panelist shows an error and the debate continues without them.
- On the Claude API engine a full sonnet/haiku debate costs a few cents, so free starter credits go a long way. On very tight credits, set every advisor to `haiku` in ⚙︎ Engine.
- Personal use on your own account — don't share your login or key with others; that's against Anthropic's usage policy.
- Not affiliated with wartable.co — an independent project inspired by its premise.
