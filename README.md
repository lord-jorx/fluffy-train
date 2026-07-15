# ⚔️ War Table — Claude Edition

Five Claude personas debate your toughest decisions across three rounds and deliver a verdict.

An **unofficial replica of [wartable.co](https://wartable.co/)** for personal use, with three ways to run — auto-detected at startup:

1. **100% free / local — no account at all**: set `LLM_BASE_URL` and it talks to any OpenAI-compatible server. Local: [Ollama](https://github.com/ollama/ollama), [LM Studio](https://lmstudio.ai), [Jan](https://github.com/menloresearch/jan), [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`), [LocalAI](https://github.com/mudler/LocalAI). Free hosted tiers: OpenRouter (`:free` models), Groq, Google AI Studio, Cerebras.
2. **With a Claude Pro/Max subscription** (no API key): uses the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), which authenticates through your existing Claude Code login.
3. **Without a subscription, on Claude**: set `ANTHROPIC_API_KEY` and it uses the Claude API directly. A new [console.anthropic.com](https://console.anthropic.com) account comes with free starter credits.

The panel is five personas, each arguing from its own angle:

| Panelist | Default model | Angle |
|---|---|---|
| The Strategist | `sonnet` | Long-term thinking, second-order effects |
| The Skeptic | `sonnet` | Hidden assumptions and failure modes |
| The Pragmatist | `sonnet` | What can actually be executed |
| The Contrarian | `sonnet` | Steelmans the side nobody else will |
| The Analyst | `haiku` | First principles, numbers, base rates |
| **The Arbiter** (judge) | `sonnet` | Weighs the transcript, delivers the verdict |

Defaults are Pro-friendly. On a Max plan you can promote the panel to Opus (see Configuration).

## How it works

1. You ask a question.
2. **Round 1 — Opening positions:** all five panelists state their stance.
3. **Round 2 — Cross-examination:** each panelist reads the others' openings, attacks the weakest argument, and defends their own.
4. **Round 3 — Closing arguments:** final recommendations, with forced concessions.
5. **Verdict:** the Arbiter reads the full transcript and delivers a structured ruling — verdict, decisive arguments, dissent worth keeping, and a confidence percentage.

Everything streams live to the browser over Server-Sent Events. Each turn is a tools-disabled, single-turn Claude Code query, so it behaves like a plain chat completion charged against your subscription usage.

## Requirements

- Node.js 18+
- **Either** [Claude Code](https://claude.com/claude-code) logged in with a Pro/Max account (run `claude` once and `/login`), **or** an `ANTHROPIC_API_KEY` from console.anthropic.com (free starter credits included on new accounts)

## Run it

```bash
npm install

# Option A — Pro/Max subscription (Claude Code login, no key):
npm start

# Option B — no subscription (Claude API key + free starter credits):
export ANTHROPIC_API_KEY=sk-ant-...
npm start

# Option C — 100% free and local with Ollama (no account, works offline):
ollama pull llama3.1        # or qwen2.5, mistral, gemma2, phi3…
export LLM_BASE_URL=http://localhost:11434/v1
export LLM_MODEL=llama3.1
npm start

# open http://localhost:3000
```

Backend priority: `LLM_BASE_URL` > `ANTHROPIC_API_KEY` > Claude Code login.

### More free/local endpoints (same two env vars)

| Server | `LLM_BASE_URL` | Notes |
|---|---|---|
| Ollama | `http://localhost:11434/v1` | CLI-first, easiest local option |
| LM Studio | `http://localhost:1234/v1` | Polished GUI + model browser |
| llama.cpp (`llama-server`) | `http://localhost:8080/v1` | Zero-dependency workhorse |
| Jan / LocalAI | see their docs | Open-source local servers |
| OpenRouter | `https://openrouter.ai/api/v1` | 20+ `:free` models; set `LLM_API_KEY`; model e.g. `meta-llama/llama-3.3-70b-instruct:free` |
| Groq | `https://api.groq.com/openai/v1` | Fast free tier; set `LLM_API_KEY` |
| Google AI Studio | `https://generativelanguage.googleapis.com/v1beta/openai` | Free Gemini quota; set `LLM_API_KEY` |

Fun trick with Ollama — make it a *real* multi-model debate, like the original wartable.co:

```bash
ollama pull llama3.1 && ollama pull qwen2.5 && ollama pull mistral && ollama pull gemma2 && ollama pull phi3
LLM_BASE_URL=http://localhost:11434/v1 \
DEBATER_MODELS=llama3.1,qwen2.5,mistral,gemma2,phi3 \
JUDGE_MODEL=llama3.1 \
npm start
```

Want to try the UI without spending any usage? Demo mode streams canned responses:

```bash
npm run dev   # MOCK=1
```

## Configuration

| Env var | Purpose |
|---|---|
| `LLM_BASE_URL` | Switches to any OpenAI-compatible backend (Ollama, LM Studio, llama.cpp, OpenRouter, Groq…). |
| `LLM_MODEL` | Default model for the whole panel on the local backend (default `llama3.1`). |
| `LLM_API_KEY` | API key for hosted OpenAI-compatible providers (not needed for local servers). |
| `ANTHROPIC_API_KEY` | Switches to the Claude API backend (the no-subscription Claude path). |
| `DEBATER_MODELS` | Comma-separated list of up to 5 models to override the panel. Accepts aliases (`opus`, `sonnet`, `haiku`) or full model IDs; aliases map to current models on the API backend. E.g. `DEBATER_MODELS=opus,opus,sonnet,sonnet,haiku` |
| `JUDGE_MODEL` | Model for the Arbiter (default `sonnet`; `opus` recommended on Max). |
| `DEBATE_CONCURRENCY` | How many panelists speak at once (default 3). Lower it if you hit plan limits. |
| `MOCK=1` | Demo mode — canned responses, no Claude usage. |
| `PORT` | Server port (default 3000). |

## Notes

- Debaters answer in the language the question was asked in.
- One full debate = 16 messages (15 turns + verdict) against your plan's usage limits or API credits. If you hit a limit mid-debate, the affected panelist shows an error and the debate continues without them.
- On the API backend a full sonnet/haiku debate costs a few cents, so the free starter credits go a long way. On very tight credits, run `DEBATER_MODELS=haiku,haiku,haiku,haiku,haiku JUDGE_MODEL=haiku`.
- Personal use on your own account — don't share your login or key with others; that's against Anthropic's usage policy.
- Not affiliated with wartable.co — a functional homage built for learning purposes.
