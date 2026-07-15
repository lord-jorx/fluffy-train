# ⚔️ War Table — Claude Edition

Five Claude personas debate your toughest decisions across three rounds and deliver a verdict.

An **unofficial replica of [wartable.co](https://wartable.co/)** for personal use, with two ways to run — auto-detected at startup:

1. **With a Claude Pro/Max subscription** (no API key): uses the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), which authenticates through your existing Claude Code login.
2. **Without any subscription**: set `ANTHROPIC_API_KEY` and it uses the Claude API directly. A new [console.anthropic.com](https://console.anthropic.com) account comes with free starter credits — enough for a good number of debates. (Claude Code itself is not available on free claude.ai accounts, so this is the no-subscription path.)

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

# Option B — no subscription (API key + free starter credits):
export ANTHROPIC_API_KEY=sk-ant-...
npm start

# open http://localhost:3000
```

If `ANTHROPIC_API_KEY` is set it wins; unset it to use your subscription login.

Want to try the UI without spending any usage? Demo mode streams canned responses:

```bash
npm run dev   # MOCK=1
```

## Configuration

| Env var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Switches to the Claude API backend (the no-subscription path). |
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
