# ⚔️ War Table — Claude Edition

Five Claude personas debate your toughest decisions across three rounds and deliver a verdict.

An **unofficial replica of [wartable.co](https://wartable.co/)** for personal use that runs on your **Claude Pro/Max subscription** — no API key, no per-token billing. It uses the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), which authenticates through your existing Claude Code login.

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
- [Claude Code](https://claude.com/claude-code) installed and logged in with your Pro/Max account (run `claude` once and `/login` if you haven't)

## Run it

```bash
npm install
npm start
# open http://localhost:3000
```

Want to try the UI without spending any usage? Demo mode streams canned responses:

```bash
npm run dev   # MOCK=1
```

## Configuration

| Env var | Purpose |
|---|---|
| `DEBATER_MODELS` | Comma-separated list of up to 5 models to override the panel. Accepts Claude Code aliases (`opus`, `sonnet`, `haiku`) or full model IDs. E.g. `DEBATER_MODELS=opus,opus,sonnet,sonnet,haiku` |
| `JUDGE_MODEL` | Model for the Arbiter (default `sonnet`; `opus` recommended on Max). |
| `DEBATE_CONCURRENCY` | How many panelists speak at once (default 3). Lower it if you hit plan limits. |
| `MOCK=1` | Demo mode — canned responses, no Claude usage. |
| `PORT` | Server port (default 3000). |

## Notes

- Debaters answer in the language the question was asked in.
- One full debate = 16 messages (15 turns + verdict) against your plan's usage limits. If you hit a limit mid-debate, the affected panelist shows an error and the debate continues without them.
- Personal use on your own subscription. Not affiliated with wartable.co — a functional homage built for learning purposes.
