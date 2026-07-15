import { query } from '@anthropic-ai/claude-agent-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { buildPanel, ROUNDS, VERDICT_INSTRUCTION } from './panel.js';

// Two interchangeable backends, auto-detected at request time:
//
//   'api'         — ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) is set.
//                   Works without any subscription: a new console.anthropic.com
//                   account comes with free starter credits.
//   'claude-code' — no key set. Uses your Claude Code login via the Claude
//                   Agent SDK (Pro/Max subscription, no API key).
//
// MOCK=1 forces demo mode (canned responses, no Claude usage).

// Claude Code accepts model aliases; the API needs full model IDs.
const API_MODEL_ALIASES = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
};

const MAX_TURN_TOKENS = 900;
const MAX_VERDICT_TOKENS = 1500;

function pickBackend() {
  if (process.env.MOCK === '1') return 'mock';
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return 'api';
  return 'claude-code';
}
export { pickBackend };

const SHARED_RULES = `You are one of five advisors in "War Table", a structured decision-making debate. The user has brought a question they need to decide on.

Rules for every turn:
- Answer in the same language the question was asked in.
- Maximum ~180 words. Dense and pointed beats long and thorough.
- Speak in first person, directly to the user. No meta-commentary about being an AI or about the debate format.
- Stay in character, but truth beats character: never defend a position you believe is wrong just to play a role.
- Output only your debate statement — no preamble, no headings, no sign-off.`;

// How many debaters speak at once. Each one is a separate Claude Code
// subprocess; keep this modest to stay friendly with subscription limits.
const CONCURRENCY = Math.max(1, parseInt(process.env.DEBATE_CONCURRENCY || '3', 10) || 3);

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

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Runs the full debate, invoking `emit(event)` for each SSE event.
 * Events: start, round_start, turn_start, delta, turn_end, turn_error,
 *         verdict_start, verdict_delta, verdict_end, done.
 */
export async function runDebate(question, emit) {
  const { debaters, judge } = buildPanel();
  const backend = pickBackend();
  const mock = backend === 'mock';
  const client = backend === 'api' ? new Anthropic() : null;

  emit({
    type: 'start',
    mock,
    backend,
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

    const results = await mapLimit(debaters, mock ? 5 : CONCURRENCY, async (debater) => {
      emit({ type: 'turn_start', round: round.number, debater: debater.id });
      try {
        const onDelta = (text) =>
          emit({ type: 'delta', round: round.number, debater: debater.id, text });
        const turnArgs = {
          model: debater.model,
          system: `${SHARED_RULES}\n\n${debater.persona}`,
          prompt: buildTurnPrompt(question, round, context),
          maxTokens: MAX_TURN_TOKENS,
          onDelta,
        };
        const text = mock
          ? await mockTurn(debater, round, onDelta)
          : backend === 'api'
            ? await apiTurn(client, turnArgs)
            : await claudeTurn(turnArgs);
        emit({ type: 'turn_end', round: round.number, debater: debater.id });
        return { round: round.number, name: debater.name, text };
      } catch (err) {
        emit({
          type: 'turn_error',
          round: round.number,
          debater: debater.id,
          message: friendlyError(err),
        });
        return null;
      }
    });

    for (const r of results) if (r) turns.push(r);
  }

  emit({ type: 'verdict_start', judge: judge.id });
  try {
    const onDelta = (text) => emit({ type: 'verdict_delta', text });
    if (mock) {
      await streamText(MOCK_VERDICT, onDelta, 8);
    } else {
      const prompt = `The question under debate:\n"""\n${question}\n"""\n\n${VERDICT_INSTRUCTION}\n\nAnswer in the same language the question was asked in. Output only the verdict itself.\n\nFull debate transcript:\n\n${transcriptText(turns)}`;
      const verdictArgs = {
        model: judge.model,
        system: judge.persona,
        prompt,
        maxTokens: MAX_VERDICT_TOKENS,
        onDelta,
      };
      if (backend === 'api') await apiTurn(client, verdictArgs);
      else await claudeTurn(verdictArgs);
    }
    emit({ type: 'verdict_end' });
  } catch (err) {
    emit({ type: 'turn_error', debater: judge.id, message: friendlyError(err) });
  }

  emit({ type: 'done' });
}

// One debate turn against the Claude API — works without a subscription
// (free starter credits on a new console.anthropic.com account).
async function apiTurn(client, { model, system, prompt, maxTokens, onDelta }) {
  const stream = client.messages.stream({
    model: API_MODEL_ALIASES[model] || model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  stream.on('text', onDelta);

  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') {
    throw new Error('El modelo declinó debatir esta pregunta.');
  }
  return final.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// One debate turn = one Claude Code query on your subscription login.
// Tools are disabled and maxTurns is 1, so it's a single pure-text response.
async function claudeTurn({ model, system, prompt, onDelta }) {
  let text = '';
  let streamed = false;

  const q = query({
    prompt,
    options: {
      model,
      systemPrompt: system,
      maxTurns: 1,
      allowedTools: [],
      includePartialMessages: true,
    },
  });

  for await (const msg of q) {
    if (msg.type === 'stream_event') {
      const delta = msg.event?.delta;
      if (msg.event?.type === 'content_block_delta' && delta?.type === 'text_delta' && delta.text) {
        streamed = true;
        text += delta.text;
        onDelta(delta.text);
      }
    } else if (msg.type === 'assistant' && !streamed) {
      // Skip synthetic placeholder messages the CLI emits on errors
      // (e.g. auth failures) — they carry the error text, not model output.
      if (msg.message?.model === '<synthetic>') continue;
      // Fallback if partial messages aren't delivered by this SDK version.
      const blocks = msg.message?.content ?? msg.content ?? [];
      for (const b of blocks) {
        if (b.type === 'text' && b.text) {
          text += b.text;
          onDelta(b.text);
        }
      }
    } else if (msg.type === 'result') {
      const failed = msg.is_error || msg.subtype?.startsWith?.('error');
      if (failed && !text) {
        const detail = typeof msg.result === 'string' ? msg.result : msg.subtype || 'unknown error';
        throw new Error(detail);
      }
    }
  }

  if (!text.trim()) throw new Error('Claude devolvió una respuesta vacía.');
  return text;
}

function friendlyError(err) {
  const m = String(err?.message || err || 'unknown error');
  if (/credit|billing|balance/i.test(m)) {
    return 'Se agotaron los créditos de la API. Recarga en console.anthropic.com o inicia sesión en Claude Code con una cuenta Pro.';
  }
  if (/invalid.*api.*key|authentication_error/i.test(m)) {
    return 'La ANTHROPIC_API_KEY no es válida. Revísala en console.anthropic.com → API keys.';
  }
  if (/login|logged|auth|credential|unauthorized|401/i.test(m)) {
    return 'No hay sesión de Claude Code ni ANTHROPIC_API_KEY. Entra con `claude` (/login) o exporta una API key, y reinicia el servidor.';
  }
  if (/rate|limit|429|overloaded/i.test(m)) {
    return 'Límite de uso alcanzado. Espera unos minutos y vuelve a intentarlo (o baja DEBATE_CONCURRENCY).';
  }
  return m;
}

// ---------------------------------------------------------------------------
// Mock mode (MOCK=1) — streams canned text so the UI can be demoed offline.
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

*(Demo mode: run without MOCK=1 to hold a real debate on your Claude subscription.)*`;

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

async function mockTurn(debater, round, onDelta) {
  const text = `(${round.title}) ${MOCK_LINES[debater.id] || 'I have considered the question carefully.'}`;
  await streamText(text, onDelta);
  return text;
}
