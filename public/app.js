// Quorum frontend — streams debates over SSE (fetch + ReadableStream, since
// EventSource can't POST), keeps a local debate history, and supports
// follow-up rounds after the verdict.

const $ = (id) => document.getElementById(id);

const form = $('ask-form');
const questionEl = $('question');
const conveneBtn = $('convene');
const modeBadge = $('mode-badge');
const arena = $('arena');
const panelStrip = $('panel-strip');
const roundsEl = $('rounds');
const againBtn = $('again-btn');
const stopBtn = $('stop-btn');
const followupForm = $('followup-form');
const followupQ = $('followup-q');
const historyBtn = $('history-btn');
const historyPanel = $('history-panel');
const historyList = $('history-list');
const historyEmpty = $('history-empty');

// ---------------------------------------------------------------------------
// Engine settings — pick local / Claude API / Claude subscription / demo, and
// remember it (plus any keys) in this browser only.
// ---------------------------------------------------------------------------

const STORE_KEY = 'quorum.settings.v1';
const engineToggle = $('engine-toggle');
const engineSummary = $('engine-summary');
const settingsEl = $('settings');
const localPreset = $('local-preset');
const localBaseurl = $('local-baseurl');
const localModel = $('local-model');
const localApikey = $('local-apikey');
const apiKeyEl = $('api-key');
const installBtn = $('install-btn');
const advWrap = $('adv-wrap');
const advToggle = $('adv-toggle');
const advPanel = $('adv-panel');
const advGrid = $('adv-grid');
const advJudge = $('adv-judge');
// Cached once — these groups are static in the HTML, unlike advInputs below
// (built dynamically from the server's persona list, see buildAdvGrid).
const engineFieldGroups = [...document.querySelectorAll('.engine-fields')];
const advInputs = [];

const BACKEND_LABELS = {
  local: '🖥️ Local / free',
  api: '🔑 Claude API',
  'claude-code': '💎 Claude subscription',
  mock: '🎭 Demo',
};

let settings = {
  backend: 'mock',
  local: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', apiKey: '' },
  api: { apiKey: '' },
  // Optional per-advisor model override — a true multi-model quorum.
  panel: { debaters: ['', '', '', '', ''], judge: '' },
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) {
      settings = {
        ...settings,
        ...saved,
        local: { ...settings.local, ...saved.local },
        api: { ...settings.api, ...saved.api },
        panel: { ...settings.panel, ...saved.panel },
      };
    }
  } catch {}
}

function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {}
}

// Assigning .value resets the caret even when the string is unchanged, which
// would otherwise bounce the cursor to the end on every keystroke (each
// keystroke fires 'input' -> read -> render -> reassign .value).
function setValue(el, v) {
  if (el.value !== v) el.value = v;
}

// Render the 5 debater override fields from the server's persona list (see
// GET /api/config), so the labels can never drift out of sync with the real
// panel order the way a second, hand-typed copy could. `advInputs[i]`'s index
// *is* the position in settings.panel.debaters — no separate id to track.
function buildAdvGrid(personas) {
  advGrid.innerHTML = '';
  advInputs.length = 0;
  personas.forEach((persona, i) => {
    const label = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = persona?.name || `Advisor ${i + 1}`;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '—';
    input.autocomplete = 'off';
    input.addEventListener('input', readAdvFromForm);
    label.append(span, input);
    advGrid.appendChild(label);
    advInputs.push(input);
  });
}

// Fill the form from `settings` and show the right field group.
function renderSettings() {
  const radio = document.querySelector(`input[name="backend"][value="${settings.backend}"]`);
  if (radio) radio.checked = true;

  setValue(localBaseurl, settings.local.baseUrl || '');
  setValue(localModel, settings.local.model || '');
  setValue(localApikey, settings.local.apiKey || '');
  setValue(apiKeyEl, settings.api.apiKey || '');

  // Preset select reflects the current URL (or "custom").
  const known = [...localPreset.options].some((o) => o.value === settings.local.baseUrl);
  localPreset.value = known ? settings.local.baseUrl : '__custom';

  for (const group of engineFieldGroups) {
    group.hidden = group.dataset.for !== settings.backend;
  }

  // Per-advisor overrides are meaningless in demo mode.
  advWrap.hidden = settings.backend === 'mock';
  advInputs.forEach((input, i) => setValue(input, settings.panel.debaters[i] || ''));
  setValue(advJudge, settings.panel.judge || '');

  let summary = BACKEND_LABELS[settings.backend] || 'Engine';
  if (settings.backend === 'local') {
    let host = settings.local.baseUrl;
    try { host = new URL(settings.local.baseUrl).host; } catch {}
    summary = `🖥️ ${settings.local.model || 'model'} · ${host}`;
  }
  engineSummary.textContent = `⚙︎ Engine: ${summary}`;
}

function readSettingsFromForm() {
  const chosen = document.querySelector('input[name="backend"]:checked');
  if (chosen) settings.backend = chosen.value;
  settings.local.baseUrl = localBaseurl.value.trim();
  settings.local.model = localModel.value.trim();
  settings.local.apiKey = localApikey.value.trim();
  settings.api.apiKey = apiKeyEl.value.trim();
  saveSettings();
  renderSettings();
}

function readAdvFromForm() {
  advInputs.forEach((input, i) => { settings.panel.debaters[i] = input.value.trim(); });
  settings.panel.judge = advJudge.value.trim();
  saveSettings();
  renderSettings();
}

// Build the config object sent with each debate request.
function requestConfig() {
  let cfg;
  if (settings.backend === 'local') {
    cfg = {
      backend: 'local',
      local: {
        baseUrl: settings.local.baseUrl,
        model: settings.local.model,
        apiKey: settings.local.apiKey || undefined,
      },
    };
  } else if (settings.backend === 'api') {
    cfg = { backend: 'api', api: { apiKey: settings.api.apiKey } };
  } else {
    cfg = { backend: settings.backend }; // claude-code | mock
  }

  // A true multi-model quorum: give each advisor its own model.
  const debaterModels = settings.panel.debaters.map((m) => m.trim());
  const judgeModel = settings.panel.judge.trim();
  if (settings.backend !== 'mock' && (debaterModels.some(Boolean) || judgeModel)) {
    cfg.panel = { debaterModels, judgeModel: judgeModel || undefined };
  }
  return cfg;
}

// Shared by the engine, advanced-panel and history disclosure buttons.
function toggleDisclosure(button, panel) {
  const open = panel.hidden;
  panel.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
}

engineToggle.addEventListener('click', () => toggleDisclosure(engineToggle, settingsEl));
advToggle.addEventListener('click', () => toggleDisclosure(advToggle, advPanel));
historyBtn.addEventListener('click', () => toggleDisclosure(historyBtn, historyPanel));

$('engine-options').addEventListener('change', readSettingsFromForm);
for (const el of [localBaseurl, localModel, localApikey, apiKeyEl]) {
  el.addEventListener('input', readSettingsFromForm);
}
localPreset.addEventListener('change', () => {
  if (localPreset.value !== '__custom') localBaseurl.value = localPreset.value;
  readSettingsFromForm();
});
advJudge.addEventListener('input', readAdvFromForm); // debater inputs wire themselves in buildAdvGrid

// Always fetch persona names for the advanced panel; only apply the
// engine/local defaults on a first visit, so a returning user's saved
// choice is never silently overwritten.
async function initSettings() {
  const hadSaved = !!localStorage.getItem(STORE_KEY);
  loadSettings();

  let personas = [null, null, null, null, null]; // buildAdvGrid falls back to "Advisor N"
  try {
    const d = await fetch('/api/config').then((r) => r.json());
    if (Array.isArray(d.personas) && d.personas.length === 5) personas = d.personas;
    if (!hadSaved) {
      if (d.backend) settings.backend = d.backend;
      if (d.local?.baseUrl) settings.local.baseUrl = d.local.baseUrl;
      if (d.local?.model) settings.local.model = d.local.model;
    }
  } catch {}

  buildAdvGrid(personas);
  renderSettings();
}
initSettings();

// PWA install prompt → surface our own button.
let deferredPrompt = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => {});
  deferredPrompt = null;
  installBtn.hidden = true;
});
addEventListener('appinstalled', () => {
  installBtn.hidden = true;
});

// ---------------------------------------------------------------------------
// Debate history — stored only in this browser, one entry per debate
// (follow-ups update their entry). Reopening replays the stored events
// through the same renderer the live stream uses.
// ---------------------------------------------------------------------------

const HISTORY_KEY = 'quorum.history.v1';
const HISTORY_MAX = 50;

function loadHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persistHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch {} // full/blocked storage should never break the debate itself
}

function saveDebate() {
  if (!debate || replaying) return;
  const list = loadHistory().filter((e) => e.id !== debate.id);
  list.unshift(debate);
  persistHistory(list);
  renderHistoryList();
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function renderHistoryList() {
  const list = loadHistory();
  historyEmpty.hidden = list.length > 0;
  historyList.innerHTML = '';
  for (const entry of list) {
    const li = document.createElement('li');
    const date = new Date(entry.startedAt).toLocaleDateString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric',
    });
    const n = entry.verdicts?.length || 0;
    li.innerHTML =
      `<button type="button" class="h-open"><b>${esc(truncate(entry.question, 90))}</b>` +
      `<small>${esc(date)} · ${n} verdict${n === 1 ? '' : 's'} · ${esc(BACKEND_LABELS[entry.backend] || entry.backend || '')}</small></button>` +
      `<button type="button" class="h-del" title="Delete" aria-label="Delete">✕</button>`;
    li.querySelector('.h-open').addEventListener('click', () => {
      historyPanel.hidden = true;
      historyBtn.setAttribute('aria-expanded', 'false');
      replayDebate(entry);
    });
    li.querySelector('.h-del').addEventListener('click', () => {
      persistHistory(loadHistory().filter((e) => e.id !== entry.id));
      renderHistoryList();
    });
    historyList.appendChild(li);
  }
}
renderHistoryList();

// Reopen a stored debate by replaying its data as synthetic SSE events
// through handleEvent — one renderer for live and historical debates.
function replayDebate(entry) {
  debate = entry; // adopt it, so follow-ups continue this debate
  replaying = true;
  resetArena();

  handleEvent({
    type: 'start', mock: false, backend: entry.backend, question: entry.question,
    debaters: entry.debaters || [], judge: entry.judge, rounds: [],
  });

  const replayRound = (r) => {
    handleEvent({ type: 'round_start', round: r, title: roundTitleOf(entry, r) });
    for (const t of (entry.transcript || []).filter((t) => t.round === r)) {
      handleEvent({ type: 'turn_start', round: r, debater: t.debaterId });
      handleEvent({ type: 'delta', round: r, debater: t.debaterId, text: t.text });
      handleEvent({ type: 'turn_end', round: r, debater: t.debaterId });
    }
  };
  const replayVerdict = (v) => {
    handleEvent({ type: 'verdict_start' });
    handleEvent({ type: 'verdict_delta', text: v.text });
    handleEvent({ type: 'verdict_end' });
  };

  const rounds = [...new Set((entry.transcript || []).map((t) => t.round))].sort((a, b) => a - b);
  for (const r of rounds.filter((r) => r <= 3)) replayRound(r);
  const verdicts = entry.verdicts || [];
  if (verdicts[0]) replayVerdict(verdicts[0]);
  let vi = 1;
  for (const r of rounds.filter((r) => r > 3)) {
    const v = verdicts[vi];
    handleEvent({
      type: 'start', followup: true, backend: entry.backend, question: v?.question || '',
      debaters: entry.debaters || [], judge: entry.judge,
    });
    replayRound(r);
    if (v) replayVerdict(v);
    vi++;
  }

  replaying = false;
  showBadge('🗂 Reopened from history.');
  if (verdicts.length > 0) followupForm.hidden = false;
  againBtn.hidden = false;
  arena.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function roundTitleOf(entry, r) {
  return entry.roundTitles?.[r] || (r > 3 ? 'Follow-up' : `Round ${r}`);
}

// ---------------------------------------------------------------------------
// Export — copy the verdict, or download the full debate as Markdown.
// ---------------------------------------------------------------------------

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text); // unavailable on plain-HTTP LAN origins
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function debateMarkdown(d) {
  const lines = [`# Quorum — ${d.question}`, '', `_${new Date(d.startedAt).toLocaleString()} · ${BACKEND_LABELS[d.backend] || d.backend || ''}_`, ''];
  const roundMd = (r) => {
    lines.push(`## ${roundTitleOf(d, r)}`, '');
    for (const t of (d.transcript || []).filter((t) => t.round === r)) {
      lines.push(`**${t.name}:** ${t.text}`, '');
    }
  };
  for (const r of [1, 2, 3]) if (d.transcript?.some((t) => t.round === r)) roundMd(r);
  (d.verdicts || []).forEach((v, i) => {
    if (i > 0) {
      lines.push(`## ↩ Follow-up: ${v.question}`, '');
      const r = 3 + i;
      if (d.transcript?.some((t) => t.round === r)) roundMd(r);
    }
    lines.push(`## ⚖ The Arbiter's verdict${i > 0 ? ` (update ${i + 1})` : ''}`, '', v.text, '');
  });
  return lines.join('\n');
}

function downloadTranscript() {
  if (!debate) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([debateMarkdown(debate)], { type: 'text/markdown' }));
  a.download = `quorum-${new Date(debate.startedAt).toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------
// Debate streaming
// ---------------------------------------------------------------------------

let debaters = [];        // active panel, from the start event
let judgeInfo = null;
let debate = null;        // current debate record — doubles as the history entry
let activeVerdict = null; // { raw, body, actions } for the verdict being streamed
let pendingQuestion = ''; // question the in-flight verdict answers
let currentAbort = null;
let replaying = false;

// crypto.randomUUID needs a secure context — unavailable over plain-HTTP LAN.
function newId() {
  return crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function showBadge(text) {
  modeBadge.hidden = false;
  modeBadge.textContent = text;
}

function nameOf(debaterId) {
  return debaters.find((d) => d.id === debaterId)?.name || 'Advisor';
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const question = questionEl.value.trim();
  if (question) startStream({ question });
});

followupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const question = followupQ.value.trim();
  if (question && debate?.verdicts.length) {
    followupQ.value = '';
    startStream({ question, isFollowup: true });
  }
});

stopBtn.addEventListener('click', () => currentAbort?.abort());

againBtn.addEventListener('click', () => {
  arena.hidden = true;
  againBtn.hidden = true;
  questionEl.value = '';
  questionEl.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

async function startStream({ question, isFollowup = false }) {
  const body = { question, config: requestConfig() };
  if (isFollowup) {
    body.history = {
      question: debate.question,
      turns: debate.transcript.map(({ round, name, text }) => ({ round, name, text })),
      verdict: debate.verdicts.at(-1)?.text || '',
    };
  } else {
    debate = {
      id: newId(),
      startedAt: Date.now(),
      backend: null,
      question,
      debaters: [],
      judge: null,
      roundTitles: {},
      transcript: [],
      verdicts: [],
    };
    resetArena();
  }

  pendingQuestion = question;
  conveneBtn.disabled = true;
  followupForm.hidden = true;
  stopBtn.hidden = false;
  currentAbort = new AbortController();

  try {
    const res = await fetch('/api/debate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: currentAbort.signal,
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `request failed (${res.status})`);
    }
    await consumeSSE(res.body, handleEvent);
  } catch (err) {
    if (currentAbort.signal.aborted) {
      showBadge('⏹ Debate stopped.');
      // Freeze the arena cleanly: no card should keep its "speaking" cursor.
      for (const el of roundsEl.querySelectorAll('.card.speaking')) el.classList.remove('speaking');
    } else {
      showBadge(`Error: ${err.message}`);
    }
  } finally {
    currentAbort = null;
    stopBtn.hidden = true;
    conveneBtn.disabled = false;
    againBtn.hidden = false;
    if (debate?.verdicts.length) followupForm.hidden = false;
  }
}

function resetArena() {
  debaters = [];
  judgeInfo = null;
  activeVerdict = null;
  turnBuffers.clear();
  panelStrip.innerHTML = '';
  roundsEl.innerHTML = '';
  followupForm.hidden = true;
  againBtn.hidden = true;
  modeBadge.hidden = true;
  arena.hidden = false;
  if (!replaying) arena.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function consumeSSE(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

const turnBuffers = new Map(); // `${round}-${debaterId}` → accumulated text

function handleEvent(ev) {
  switch (ev.type) {
    case 'start': {
      debaters = ev.debaters;
      judgeInfo = ev.judge;
      if (!replaying && debate) {
        debate.backend = ev.backend;
        debate.debaters = ev.debaters;
        debate.judge = ev.judge;
      }
      if (ev.followup) {
        if (ev.question) {
          roundsEl.insertAdjacentHTML(
            'beforeend',
            `<div class="fu-divider">↩ <em>${esc(ev.question)}</em></div>`
          );
        }
      } else {
        for (const d of ev.debaters) {
          panelStrip.insertAdjacentHTML(
            'beforeend',
            `<div class="chip" title="${esc(d.tagline)}">
               <span class="dot" style="background:${esc(d.color)}"></span>
               <span class="who"><b>${esc(d.name)}</b><small>${esc(d.model)}</small></span>
             </div>`
          );
        }
      }
      if (!replaying) {
        showBadge(ev.mock
          ? 'Demo mode — pick a real engine in ⚙︎ Engine for a live debate.'
          : `Engine: ${BACKEND_LABELS[ev.backend] || ev.backend}`);
      }
      break;
    }
    case 'round_start': {
      if (!replaying && debate) debate.roundTitles[ev.round] = ev.title;
      const cards = debaters
        .map(
          (d) =>
            `<article class="card" id="card-${ev.round}-${esc(d.id)}" style="--card-color:${esc(d.color)}">
               <header><b>${esc(d.name)}</b><small>${esc(d.model)}</small></header>
               <div class="body"></div>
             </article>`
        )
        .join('');
      roundsEl.insertAdjacentHTML(
        'beforeend',
        `<section class="round"><h2>${ev.round <= 3 ? `Round ${ev.round} — ` : ''}${esc(ev.title)}</h2><div class="cards">${cards}</div></section>`
      );
      break;
    }
    case 'turn_start': {
      turnBuffers.set(`${ev.round}-${ev.debater}`, '');
      cardOf(ev)?.classList.add('speaking');
      break;
    }
    case 'delta': {
      const key = `${ev.round}-${ev.debater}`;
      turnBuffers.set(key, (turnBuffers.get(key) || '') + ev.text);
      const card = cardOf(ev);
      if (card) card.querySelector('.body').textContent += ev.text;
      break;
    }
    case 'turn_end': {
      const key = `${ev.round}-${ev.debater}`;
      const text = turnBuffers.get(key) || '';
      turnBuffers.delete(key);
      if (!replaying && debate && text) {
        debate.transcript.push({
          round: ev.round,
          debaterId: ev.debater,
          name: nameOf(ev.debater),
          text,
        });
      }
      cardOf(ev)?.classList.remove('speaking');
      break;
    }
    case 'turn_error': {
      const card = ev.round ? cardOf(ev) : null;
      if (card) {
        card.classList.remove('speaking');
        card.classList.add('errored');
        card.querySelector('.body').textContent = `⚠ ${ev.message}`;
      } else if (activeVerdict) {
        activeVerdict.body.textContent = `⚠ ${ev.message}`;
      } else {
        showBadge(`⚠ ${ev.message}`);
      }
      break;
    }
    case 'verdict_start': {
      const block = document.createElement('section');
      block.className = 'verdict';
      block.innerHTML =
        `<h2><span class="gavel">⚖︎</span> The Arbiter's verdict</h2>` +
        `<p class="judge-model">${esc(judgeInfo?.name || 'The Arbiter')} · ${esc(judgeInfo?.model || '')}</p>` +
        `<div class="verdict-body"></div>` +
        `<div class="verdict-actions" hidden>` +
        `<button type="button" class="act-copy">⎘ Copy verdict</button>` +
        `<button type="button" class="act-dl">⬇ Download transcript</button>` +
        `</div>`;
      roundsEl.appendChild(block);
      activeVerdict = {
        raw: '',
        body: block.querySelector('.verdict-body'),
        actions: block.querySelector('.verdict-actions'),
      };
      if (!replaying) block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      break;
    }
    case 'verdict_delta': {
      if (!activeVerdict) break;
      activeVerdict.raw += ev.text;
      activeVerdict.body.innerHTML = renderVerdict(activeVerdict.raw);
      break;
    }
    case 'verdict_end': {
      if (!activeVerdict) break;
      const text = activeVerdict.raw;
      activeVerdict.actions.hidden = false;
      activeVerdict.actions.querySelector('.act-copy').addEventListener('click', () => copyText(text));
      activeVerdict.actions.querySelector('.act-dl').addEventListener('click', downloadTranscript);
      if (!replaying && debate) {
        debate.verdicts.push({ question: pendingQuestion, text });
        saveDebate();
      }
      activeVerdict = null;
      break;
    }
    case 'error': {
      showBadge(`Error: ${ev.message}`);
      break;
    }
  }
}

function cardOf(ev) {
  return document.getElementById(`card-${ev.round}-${ev.debater}`);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Minimal markdown: only **bold** and *italic*, everything else escaped.
function renderVerdict(text) {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>');
}
