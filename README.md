# ⚔️ War Table — Claude Edition

Five Claude models debate your toughest decisions across three rounds and deliver a verdict.

An **unofficial replica of [wartable.co](https://wartable.co/)** built entirely on the Claude API — instead of five different AI providers, the panel is five distinct Claude models, each arguing from its own perspective:

| Panelist | Model | Angle |
|---|---|---|
| The Strategist | `claude-opus-4-8` | Long-term thinking, second-order effects |
| The Skeptic | `claude-opus-4-7` | Hidden assumptions and failure modes |
| The Pragmatist | `claude-sonnet-5` | What can actually be executed |
| The Contrarian | `claude-sonnet-4-6` | Steelmans the side nobody else will |
| The Analyst | `claude-haiku-4-5` | First principles, numbers, base rates |
| **The Arbiter** (judge) | `claude-opus-4-8` | Weighs the transcript, delivers the verdict |

## How it works

1. You ask a question.
2. **Round 1 — Opening positions:** all five panelists state their stance (in parallel).
3. **Round 2 — Cross-examination:** each panelist reads the others' openings, attacks the weakest argument, and defends their own.
4. **Round 3 — Closing arguments:** final recommendations, with forced concessions.
5. **Verdict:** the Arbiter reads the full transcript and delivers a structured ruling — verdict, decisive arguments, dissent worth keeping, and a confidence percentage.

Everything streams live to the browser over Server-Sent Events.

## Run it

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start
# open http://localhost:3000
```

No API key? It runs in **demo mode** automatically (canned responses, same UI):

```bash
npm run dev
```

## Configuration

| Env var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key. Without it the app runs in demo mode. |
| `DEBATER_MODELS` | Comma-separated list of up to 5 model IDs to override the panel. |
| `JUDGE_MODEL` | Model ID for the Arbiter (default `claude-opus-4-8`). |
| `MOCK=1` | Force demo mode even with a key present. |
| `PORT` | Server port (default 3000). |

## Notes

- Debaters answer in the language the question was asked in.
- Each turn is capped (~180 words prompted, 900 tokens hard) to keep debates punchy; one full debate is 15 model calls + 1 verdict call.
- Not affiliated with wartable.co — this is a functional homage built for learning purposes.
