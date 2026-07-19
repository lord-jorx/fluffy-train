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

// Hard ceiling per turn, so one hung backend (a wedged local server, a stalled
// subprocess) can't freeze the whole debate. Generous because big local models
// on modest hardware are genuinely slow; override with TURN_TIMEOUT_MS.
const TURN_TIMEOUT_MS = parseInt(process.env.TURN_TIMEOUT_MS || '300000', 10) || 300000;

// Combines the caller's abort signal (client disconnected) with a per-turn
// timeout into one signal. Node 18-compatible (no AbortSignal.any).
function linkedAbort(signal, timeoutMs) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error('turn timeout')), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

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

  // Forgive a missing scheme ("localhost:11434/v1" → "http://localhost:11434/v1")
  // so a hand-typed URL doesn't die inside fetch with a cryptic parse error.
  let baseUrl = String(local.baseUrl || env.LLM_BASE_URL || '').trim().replace(/\/+$/, '');
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;

  return {
    backend: req.backend || pickBackend(),
    local: {
      baseUrl,
      model: local.model || env.LLM_MODEL || 'llama3.1',
      apiKey: local.apiKey || env.LLM_API_KEY || 'not-needed',
    },
    api: {
      // Only an actual API key belongs here. ANTHROPIC_AUTH_TOKEN is a different
      // credential (Bearer header, not x-api-key) — passing it as apiKey would
      // 401. When no explicit key is given, the bare `new Anthropic()` client
      // resolves env credentials itself, correctly, whichever kind they are.
      apiKey: api.apiKey || env.ANTHROPIC_API_KEY || '',
      hasEnvAuth: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
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
  if (cfg.backend === 'api' && !cfg.api.apiKey && !cfg.api.hasEnvAuth) {
    throw new Error('Falta la clave de Claude (ANTHROPIC_API_KEY) para el modo Claude API.');
  }
}

// The browser resends the debate context with each follow-up (the server is
// stateless). Clamp everything client-supplied so a crafted request can't
// balloon the prompts. Returns null when the shape isn't a usable history.
export function sanitizeHistory(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const turns = (Array.isArray(raw.turns) ? raw.turns : [])
    .slice(0, 60)
    .map((t) => ({
      round: Math.min(99, Math.max(1, Math.trunc(Number(t?.round)) || 1)),
      name: String(t?.name || 'Advisor').slice(0, 100),
      text: String(t?.text || '').slice(0, 8000),
    }))
    .filter((t) => t.text);
  const question = String(raw.question || '').slice(0, 2000).trim();
  const verdict = String(raw.verdict || '').slice(0, 8000).trim();
  if (!question || !verdict || turns.length === 0) return null;
  return { question, verdict, turns };
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

// Resolves config + panel into everything a debate run needs.
function setupDebate(reqConfig) {
  const cfg = resolveConfig(reqConfig);
  validateConfig(cfg);

  const { debaters, judge } = buildPanel(cfg.panel);
  const mock = cfg.backend === 'mock';
  const anthropic =
    cfg.backend !== 'api' ? null
    : cfg.api.apiKey ? new Anthropic({ apiKey: cfg.api.apiKey })
    : new Anthropic(); // resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN from env

  // Resolve panel models for the active backend so the UI shows the truth.
  for (const d of debaters) d.model = resolveModel(cfg, d.model);
  judge.model = resolveModel(cfg, judge.model);

  return { cfg, mock, anthropic, debaters, judge };
}

function startEvent(ctx, question, rounds, followup) {
  return {
    type: 'start',
    mock: ctx.mock,
    backend: ctx.cfg.backend,
    question,
    ...(followup ? { followup: true } : {}),
    debaters: ctx.debaters.map(({ id, name, model, color, tagline }) => ({
      id, name, model, color, tagline,
    })),
    judge: { id: ctx.judge.id, name: ctx.judge.name, model: ctx.judge.model, color: ctx.judge.color },
    rounds,
  };
}

// Dispatches one turn to the active backend.
function executeTurn(ctx, args, signal, debater, roundTitle) {
  if (ctx.mock) return mockTurn(debater, { title: roundTitle }, args.onDelta, signal);
  if (ctx.cfg.backend === 'local') return localTurn(ctx.cfg, args, signal);
  if (ctx.cfg.backend === 'api') return apiTurn(ctx.anthropic, args, signal);
  return claudeTurn(args, signal);
}

// Runs one round: all five debaters in parallel (bounded), emitting SSE events.
// Returns the completed turns.
async function runRound(ctx, { number, title, buildPrompt }, emit, signal) {
  emit({ type: 'round_start', round: number, title });

  const results = await mapLimit(ctx.debaters, ctx.mock ? 5 : ctx.cfg.concurrency, async (debater) => {
    if (signal?.aborted) return null; // client gone — don't start new turns
    emit({ type: 'turn_start', round: number, debater: debater.id });
    try {
      const onDelta = (text) => emit({ type: 'delta', round: number, debater: debater.id, text });
      const text = await executeTurn(ctx, {
        model: debater.model,
        system: `${SHARED_RULES}\n\n${debater.persona}`,
        prompt: buildPrompt(debater),
        maxTokens: MAX_TURN_TOKENS,
        onDelta,
      }, signal, debater, title);
      emit({ type: 'turn_end', round: number, debater: debater.id });
      return { round: number, name: debater.name, text };
    } catch (err) {
      if (signal?.aborted) return null; // abort noise, not a real turn failure
      emit({ type: 'turn_error', round: number, debater: debater.id, message: friendlyError(err, ctx.cfg) });
      return null;
    }
  });

  return results.filter(Boolean);
}

async function runVerdict(ctx, prompt, emit, signal) {
  emit({ type: 'verdict_start', judge: ctx.judge.id });
  try {
    const onDelta = (text) => emit({ type: 'verdict_delta', text });
    if (ctx.mock) {
      await streamText(MOCK_VERDICT, onDelta, 8, signal);
    } else {
      await executeTurn(ctx, {
        model: ctx.judge.model,
        system: ctx.judge.persona,
        prompt,
        maxTokens: MAX_VERDICT_TOKENS,
        onDelta,
      }, signal, ctx.judge, 'Verdict');
    }
    emit({ type: 'verdict_end' });
  } catch (err) {
    if (!signal?.aborted) {
      emit({ type: 'turn_error', debater: ctx.judge.id, message: friendlyError(err, ctx.cfg) });
    }
  }
}

/**
 * Runs the full debate, invoking `emit(event)` for each SSE event.
 * `reqConfig` is the per-request backend config sent by the browser.
 * `signal` aborts the debate (the caller fires it when the client disconnects,
 * so a closed tab stops burning model calls instead of running all 16 turns).
 */
export async function runDebate(question, emit, reqConfig, signal) {
  const ctx = setupDebate(reqConfig);

  emit(startEvent(ctx, question, ROUNDS.map(({ number, title }) => ({ number, title }))));

  const turns = []; // completed turns, visible to later rounds
  for (const round of ROUNDS) {
    if (signal?.aborted) return;
    const context = [...turns]; // same-round turns run in parallel, blind to each other
    const roundTurns = await runRound(ctx, {
      number: round.number,
      title: round.title,
      buildPrompt: () => buildTurnPrompt(question, round, context),
    }, emit, signal);
    turns.push(...roundTurns);
  }

  if (signal?.aborted) return;
  const prompt = `The question under debate:\n"""\n${question}\n"""\n\n${VERDICT_INSTRUCTION}\n\nAnswer in the same language the question was asked in. Output only the verdict itself.\n\nFull debate transcript:\n\n${transcriptText(turns)}`;
  await runVerdict(ctx, prompt, emit, signal);

  emit({ type: 'done' });
}

/**
 * Runs a follow-up: after a verdict, the user asks the panel something more.
 * One extra round (every advisor sees the full prior transcript + verdict +
 * the follow-up) and then an updated verdict. `history` is the sanitized
 * client-resent context (see sanitizeHistory) — the server stays stateless.
 */
export async function runFollowup(followupQuestion, history, emit, reqConfig, signal) {
  const ctx = setupDebate(reqConfig);

  const roundNumber = Math.min(99, Math.max(...history.turns.map((t) => t.round), 3) + 1);
  const title = 'Follow-up';

  emit(startEvent(ctx, followupQuestion, [{ number: roundNumber, title }], true));

  const context = `${transcriptText(history.turns)}\n\n[Verdict — ${ctx.judge.name}]\n${history.verdict}`;
  const turnPrompt =
    `The question under debate:\n"""\n${history.question}\n"""\n\n` +
    `The user has come back with a follow-up after hearing the verdict:\n"""\n${followupQuestion}\n"""\n\n` +
    `Considering the full debate and the verdict (included below), respond to this follow-up from your perspective. ` +
    `If it changes your recommendation, say so explicitly. Do not repeat your earlier arguments — add what the follow-up specifically calls for.\n\n` +
    `Debate transcript so far:\n\n${context}`;

  const newTurns = await runRound(ctx, {
    number: roundNumber,
    title,
    buildPrompt: () => turnPrompt,
  }, emit, signal);

  if (signal?.aborted) return;
  const verdictPrompt =
    `The question under debate:\n"""\n${history.question}\n"""\n\n` +
    `After your previous verdict, the user asked a follow-up:\n"""\n${followupQuestion}\n"""\n\n` +
    `Deliver an UPDATED verdict that addresses the follow-up. ${VERDICT_INSTRUCTION}\n\n` +
    `Answer in the same language the question was asked in. Output only the verdict itself.\n\n` +
    `Full debate transcript (including your previous verdict and the follow-up round):\n\n${context}\n\n${transcriptText(newTurns)}`;
  await runVerdict(ctx, verdictPrompt, emit, signal);

  emit({ type: 'done' });
}

// One debate turn against any OpenAI-compatible server. Native fetch + SSE.
async function localTurn(cfg, { model, system, prompt, maxTokens, onDelta }, signal) {
  const abort = linkedAbort(signal, TURN_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.local.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: abort.signal,
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
  } finally {
    abort.cleanup();
  }
}

// One debate turn against the Claude API (works with free starter credits).
async function apiTurn(client, { model, system, prompt, maxTokens, onDelta }, signal) {
  const abort = linkedAbort(signal, TURN_TIMEOUT_MS);
  try {
    const stream = client.messages.stream(
      {
        model: API_MODEL_ALIASES[model] || model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: abort.signal }
    );

    stream.on('text', onDelta);

    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      throw new Error('El modelo declinó debatir esta pregunta.');
    }
    return final.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  } finally {
    abort.cleanup();
  }
}

// One debate turn = one Claude Code query on your subscription login.
// Tools are disabled and maxTurns is 1, so it's a single pure-text response.
async function claudeTurn({ model, system, prompt, onDelta }, signal) {
  // The Agent SDK takes an AbortController rather than a signal; bridge our
  // linked signal (client disconnect + turn timeout) into one so a closed tab
  // also kills the underlying Claude Code subprocess.
  const abort = linkedAbort(signal, TURN_TIMEOUT_MS);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  abort.signal.addEventListener('abort', onAbort, { once: true });
  if (abort.signal.aborted) controller.abort();

  try {
    const q = query({
      prompt,
      options: {
        model,
        systemPrompt: system,
        maxTurns: 1,
        allowedTools: [],
        includePartialMessages: true,
        abortController: controller,
      },
    });

    return await consumeClaudeQuery(q, onDelta);
  } finally {
    abort.signal.removeEventListener('abort', onAbort);
    abort.cleanup();
  }
}

// Iterates the Agent SDK message stream, accumulating the final text.
async function consumeClaudeQuery(q, onDelta) {
  let text = '';
  let streamed = false;

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
  if (/turn timeout/i.test(m)) {
    const human = TURN_TIMEOUT_MS >= 60000
      ? `${Math.round(TURN_TIMEOUT_MS / 60000)} min`
      : `${Math.round(TURN_TIMEOUT_MS / 1000)} s`;
    return `El turno superó el tiempo máximo (${human}). ¿El modelo es demasiado grande para tu máquina? Puedes ampliarlo con TURN_TIMEOUT_MS.`;
  }
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

function streamText(text, onDelta, delayMs = 12, signal) {
  const words = text.split(/(?<=\s)/);
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (signal?.aborted || i >= words.length) return resolve();
      onDelta(words[i++]);
      setTimeout(tick, delayMs);
    };
    tick();
  });
}

async function mockTurn(debater, round, onDelta, signal) {
  const text = `(${round.title}) ${MOCK_LINES[debater.id] || 'I have considered the question carefully.'}`;
  await streamText(text, onDelta, 12, signal);
  return text;
}
