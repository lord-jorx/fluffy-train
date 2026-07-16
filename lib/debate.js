import { query } from '@anthropic-ai/claude-agent-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { buildPanel, ROUNDS, VERDICT_INSTRUCTION } from './panel.js';

// Four interchangeable backends. The active one is chosen per request (from the
// browser settings), falling back to the server environment when the request
// doesn't specify:
//
//   'local'       — any OpenAI-compatible server: Ollama, LM Studio, Jan,
//                   llama.cpp (llama-server), LocalAI, or free hosted tiers
//                   (OpenRouter, Groq, Google AI Studio, Cerebras).
//   'api'         — the Claude API with an ANTHROPIC_API_KEY (free starter
//                   credits on a new console.anthropic.com account).
//   'claude-code' — your Claude Code login via the Agent SDK (Pro/Max sub).
//   'mock'        — canned demo responses, no usage at all.

// Claude Code accepts model aliases; the Anthropic API needs full model IDs.
const API_MODEL_ALIASES = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
};
const CLAUDE_ALIASES = new Set(Object.keys(API_MODEL_ALIASES));

const MAX_TURN_TOKENS = 900;
const MAX_VERDICT_TOKENS = 1500;

const SHARED_RULES = `You are one of five advisors convened at "Quorum", a structured decision-making debate. The user has brought a question they need to decide on.

Rules for every turn:
- Answer in the same language the question was asked in.
- Maximum ~180 words. Dense and pointed beats long and thorough.
- Speak in first person, directly to the user. No meta-commentary about being an AI or about the debate format.
- Stay in character, but truth beats character: never defend a position you believe is wrong just to play a role.
- Output only your debate statement — no preamble, no headings, no sign-off.`;

// The backend the server would use if the request doesn't pick one.
export function pickBackend() {
  if (process.env.MOCK === '1') return 'mock';
  if (process.env.LLM_BASE_URL) return 'local';
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return 'api';
  return 'claude-code';
}

// Non-secret view of the server's env defaults, for the settings UI to preselect.
// `personas` is panel.js's own default debater list (id + display name), so the
// browser's "different model per advisor" grid renders from the same source of
// truth instead of a second, hand-typed copy that could silently drift out of sync.
export function serverDefaults() {
  const { debaters } = buildPanel();
  return {
    backend: pickBackend(),
    local: { baseUrl: process.env.LLM_BASE_URL || '', model: process.env.LLM_MODEL || '' },
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    personas: debaters.map(({ id, name }) => ({ id, name })),
  };
}

// Merge a per-request config (from the browser) over the server environment.
export function resolveConfig(req = {}) {
  const env = process.env;
  const local = req.local || {};
  const api = req.api || {};
  const panel = req.panel || {};
  return {
    backend: req.backend || pickBackend(),
    local: {
      baseUrl: (local.baseUrl || env.LLM_BASE_URL || '').replace(/\/+$/, ''),
      model: local.model || env.LLM_MODEL || 'llama3.1',
      apiKey: local.apiKey || env.LLM_API_KEY || 'not-needed',
    },
    api: {
      apiKey: api.apiKey || env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || '',
    },
    panel: {
      debaterModels: Array.isArray(panel.debaterModels) ? panel.debaterModels : undefined,
      judgeModel: panel.judgeModel || undefined,
    },
    concurrency: Number(req.concurrency) || parseInt(env.DEBATE_CONCURRENCY || '3', 10) || 3,
  };
}

export function validateConfig(cfg) {
  if (cfg.backend === 'local' && !cfg.local.baseUrl) {
    throw new Error('Falta la URL del servidor local (p. ej. http://localhost:11434/v1).');
  }
  if (cfg.backend === 'api' && !cfg.api.apiKey) {
    throw new Error('Falta la clave de Claude (ANTHROPIC_API_KEY) para el modo Claude API.');
  }
}

// Maps a panel model (possibly a Claude alias) to what the active backend wants.
function resolveModel(cfg, model) {
  if (cfg.backend === 'local') {
    const isClaudeAlias = CLAUDE_ALIASES.has(model) || String(model).startsWith('claude');
    return isClaudeAlias ? cfg.local.model : model;
  }
  if (cfg.backend === 'api') return API_MODEL_ALIASES[model] || model;
  return model; // claude-code accepts aliases directly
}

function transcriptText(turns) {
  return turns.map((t) => `[Round ${t.round} — ${t.name}]\n${t.text}`).join('\n\n');
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
 * `reqConfig` is the per-request backend config sent by the browser.
 */
export async function runDebate(question, emit, reqConfig) {
  const cfg = resolveConfig(reqConfig);
  validateConfig(cfg);

  const { debaters, judge } = buildPanel(cfg.panel);
  const backend = cfg.backend;
  const mock = backend === 'mock';
  const anthropic = backend === 'api' ? new Anthropic({ apiKey: cfg.api.apiKey }) : null;

  // Resolve panel models for the active backend so the UI shows the truth.
  for (const d of debaters) d.model = resolveModel(cfg, d.model);
  judge.model = resolveModel(cfg, judge.model);

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
    const context = [...turns]; // same-round turns run in parallel, blind to each other

    const results = await mapLimit(debaters, mock ? 5 : cfg.concurrency, async (debater) => {
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
          : backend === 'local'
            ? await localTurn(cfg, turnArgs)
            : backend === 'api'
              ? await apiTurn(anthropic, turnArgs)
              : await claudeTurn(turnArgs);
        emit({ type: 'turn_end', round: round.number, debater: debater.id });
        return { round: round.number, name: debater.name, text };
      } catch (err) {
        emit({
          type: 'turn_error',
          round: round.number,
          debater: debater.id,
          message: friendlyError(err, cfg),
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
      if (backend === 'local') await localTurn(cfg, verdictArgs);
      else if (backend === 'api') await apiTurn(anthropic, verdictArgs);
      else await claudeTurn(verdictArgs);
    }
    emit({ type: 'verdict_end' });
  } catch (err) {
    emit({ type: 'turn_error', debater: judge.id, message: friendlyError(err, cfg) });
  }

  emit({ type: 'done' });
}

// One debate turn against any OpenAI-compatible server. Native fetch + SSE.
async function localTurn(cfg, { model, system, prompt, maxTokens, onDelta }) {
  const res = await fetch(`${cfg.local.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.local.apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }

  let text = '';
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
    }
  }

  if (!text.trim()) throw new Error('El servidor local devolvió una respuesta vacía.');
  return text;
}

// One debate turn against the Claude API (works with free starter credits).
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
      // Skip synthetic placeholder messages the CLI emits on errors.
      if (msg.message?.model === '<synthetic>') continue;
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

function friendlyError(err, cfg) {
  const m = String(err?.message || err || 'unknown error');
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(m)) {
    return `No se pudo conectar con ${cfg?.local?.baseUrl || 'el servidor local'}. ¿Está corriendo Ollama/LM Studio? (p. ej. \`ollama serve\`)`;
  }
  if (/model.*not.*found|404.*model|not found.*model/i.test(m)) {
    return `El modelo "${cfg?.local?.model}" no existe en el servidor local. Descárgalo primero (p. ej. \`ollama pull ${cfg?.local?.model || 'llama3.1'}\`).`;
  }
  if (/401|unauthorized|invalid.*api.*key|authentication_error|invalid_api_key/i.test(m)) {
    if (cfg?.backend === 'api') return 'La clave de Claude (ANTHROPIC_API_KEY) no es válida. Revísala en console.anthropic.com → API keys.';
    if (cfg?.backend === 'local') return 'La API key del servicio en la nube no es válida. Revísala en tu proveedor (OpenRouter, Groq, etc.).';
    return 'No hay sesión de Claude Code. Entra con `claude` (/login) en el servidor, o usa otro motor.';
  }
  if (/credit|billing|balance|insufficient/i.test(m)) {
    return 'Se agotaron los créditos. Recarga en console.anthropic.com, o cambia a un motor local/gratuito.';
  }
  if (/login|logged|credential/i.test(m)) {
    return 'No hay sesión de Claude Code en el servidor. Entra con `claude` (/login) o elige otro motor en Ajustes.';
  }
  if (/rate|limit|429|overloaded|quota/i.test(m)) {
    return 'Límite de uso alcanzado. Espera unos minutos, baja la concurrencia, o cambia de motor.';
  }
  return m;
}

// ---------------------------------------------------------------------------
// Demo backend — streams canned text so the UI works with zero usage.
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

*(Demo mode: pick a real engine in Settings to hold a live debate.)*`;

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
