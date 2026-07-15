import Anthropic from '@anthropic-ai/sdk';
import { buildPanel, ROUNDS, VERDICT_INSTRUCTION } from './panel.js';

const MAX_TURN_TOKENS = 900;
const MAX_VERDICT_TOKENS = 1500;

const SHARED_RULES = `You are one of five advisors in "War Table", a structured decision-making debate. The user has brought a question they need to decide on.

Rules for every turn:
- Answer in the same language the question was asked in.
- Maximum ~180 words. Dense and pointed beats long and thorough.
- Speak in first person, directly to the user. No meta-commentary about being an AI or about the debate format.
- Stay in character, but truth beats character: never defend a position you believe is wrong just to play a role.`;

function transcriptText(turns) {
  return turns
    .map((t) => `[Round ${t.round} — ${t.name}]\n${t.text}`)
    .join('\n\n');
}

function buildTurnPrompt(question, round, turns) {
  let prompt = `The question under debate:\n"""\n${question}\n"""\n\n${round.instruction}`;
  if (turns.length > 0) {
    prompt += `\n\nDebate transcript so far:\n\n${transcriptText(turns)}`;
  }
  return prompt;
}

/**
 * Runs the full debate, invoking `emit(event)` for each SSE event.
 * Events: start, round_start, turn_start, delta, turn_end, turn_error,
 *         verdict_start, verdict_delta, verdict_end, done.
 */
export async function runDebate(question, emit) {
  const { debaters, judge } = buildPanel();
  const mock = process.env.MOCK === '1' || !hasCredentials();
  const client = mock ? null : new Anthropic();

  emit({
    type: 'start',
    mock,
    question,
    debaters: debaters.map(({ id, name, model, color, tagline }) => ({
      id, name, model, color, tagline,
    })),
    judge: { id: judge.id, name: judge.name, model: judge.model, color: judge.color },
    rounds: ROUNDS.map(({ number, title }) => ({ number, title })),
  });

  const turns = []; // completed turns, visible to later rounds

  for (const round of ROUNDS) {
    emit({ type: 'round_start', round: round.number, title: round.title });
    const context = [...turns]; // same-round turns run in parallel and don't see each other

    const results = await Promise.all(
      debaters.map(async (debater) => {
        emit({ type: 'turn_start', round: round.number, debater: debater.id });
        try {
          const text = mock
            ? await mockTurn(debater, round, emit)
            : await realTurn(client, debater, question, round, context, emit);
          emit({ type: 'turn_end', round: round.number, debater: debater.id });
          return { round: round.number, name: debater.name, text };
        } catch (err) {
          emit({
            type: 'turn_error',
            round: round.number,
            debater: debater.id,
            message: err?.message || 'unknown error',
          });
          return null;
        }
      })
    );

    for (const r of results) if (r) turns.push(r);
  }

  emit({ type: 'verdict_start', judge: judge.id });
  try {
    if (mock) {
      await mockVerdict(emit);
    } else {
      await realVerdict(client, judge, question, turns, emit);
    }
    emit({ type: 'verdict_end' });
  } catch (err) {
    emit({ type: 'turn_error', debater: judge.id, message: err?.message || 'unknown error' });
  }

  emit({ type: 'done' });
}

function hasCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

async function realTurn(client, debater, question, round, context, emit) {
  const stream = client.messages.stream({
    model: debater.model,
    max_tokens: MAX_TURN_TOKENS,
    system: `${SHARED_RULES}\n\n${debater.persona}`,
    messages: [{ role: 'user', content: buildTurnPrompt(question, round, context) }],
  });

  stream.on('text', (delta) => {
    emit({ type: 'delta', round: round.number, debater: debater.id, text: delta });
  });

  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') {
    throw new Error(`${debater.name} declined to argue this question.`);
  }
  return final.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

async function realVerdict(client, judge, question, turns, emit) {
  const prompt = `The question under debate:\n"""\n${question}\n"""\n\n${VERDICT_INSTRUCTION}\n\nAnswer in the same language the question was asked in.\n\nFull debate transcript:\n\n${transcriptText(turns)}`;

  const stream = client.messages.stream({
    model: judge.model,
    max_tokens: MAX_VERDICT_TOKENS,
    system: judge.persona,
    messages: [{ role: 'user', content: prompt }],
  });

  stream.on('text', (delta) => emit({ type: 'verdict_delta', text: delta }));

  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') {
    throw new Error('The Arbiter declined to rule on this question.');
  }
}

// ---------------------------------------------------------------------------
// Mock mode — no API key needed. Streams canned text so the UI can be demoed.
// ---------------------------------------------------------------------------

const MOCK_LINES = {
  strategist:
    'Looking three years out, the compounding option wins. The short-term cost is real but bounded; the long-term upside is not. I recommend committing now and revisiting in six months.',
  skeptic:
    'The question assumes both options are actually available to you. Before deciding, verify the premise: what evidence do you have that the second path is open at all? If it holds up, my objection weakens considerably.',
  pragmatist:
    'Whatever we recommend has to survive a normal Tuesday. Pick the option you can start this week with the resources you already have, and make the first step reversible.',
  contrarian:
    'Everyone here is converging too fast. Let me argue the rejected option seriously: it has a smaller downside tail, and the panel is underweighting how often bold plans quietly fail.',
  analyst:
    'Base rates first: comparable cases succeed roughly one time in three. The expected value still favors acting, but only if the downside is capped. Quantify your worst case before committing.',
};

const MOCK_VERDICT = `**Verdict** — Proceed, but stage the commitment: take the reversible first step this week and set a six-month checkpoint.

**Why** — The Strategist showed the upside compounds while the cost is bounded; The Pragmatist showed a reversible first step exists; The Analyst showed the expected value is positive once the downside is capped.

**Dissent worth keeping** — The Skeptic's premise check stands: if the second path turns out not to be genuinely available, the whole comparison collapses. Verify that first.

**Confidence** — 72%. The panel converged from independent angles, but one unverified premise remains.

*(Demo mode: set ANTHROPIC_API_KEY to run a real debate.)*`;

function streamText(text, onDelta, delayMs = 12) {
  const words = text.split(/(?<=\s)/);
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (i >= words.length) return resolve();
      onDelta(words[i++]);
      setTimeout(tick, delayMs);
    };
    tick();
  });
}

async function mockTurn(debater, round, emit) {
  const text = `(${round.title}) ${MOCK_LINES[debater.id] || 'I have considered the question carefully.'}`;
  await streamText(text, (delta) =>
    emit({ type: 'delta', round: round.number, debater: debater.id, text: delta })
  );
  return text;
}

async function mockVerdict(emit) {
  await streamText(MOCK_VERDICT, (delta) => emit({ type: 'verdict_delta', text: delta }), 8);
}
