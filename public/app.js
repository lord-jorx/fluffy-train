// Quorum frontend — streams the debate over SSE (fetch + ReadableStream,
// since EventSource can't POST).

const form = document.getElementById('ask-form');
const questionEl = document.getElementById('question');
const conveneBtn = document.getElementById('convene');
const modeBadge = document.getElementById('mode-badge');
const arena = document.getElementById('arena');
const panelStrip = document.getElementById('panel-strip');
const roundsEl = document.getElementById('rounds');
const verdictSection = document.getElementById('verdict-section');
const verdictBody = document.getElementById('verdict-body');
const judgeModelEl = document.getElementById('judge-model');
const againBtn = document.getElementById('again-btn');

let debaters = [];
let verdictRaw = '';

// ---------------------------------------------------------------------------
// Engine settings — pick local / Claude API / Claude subscription / demo, and
// remember it (plus any keys) in this browser only.
// ---------------------------------------------------------------------------

const STORE_KEY = 'quorum.settings.v1';
const engineToggle = document.getElementById('engine-toggle');
const engineSummary = document.getElementById('engine-summary');
const settingsEl = document.getElementById('settings');
const localPreset = document.getElementById('local-preset');
const localBaseurl = document.getElementById('local-baseurl');
const localModel = document.getElementById('local-model');
const localApikey = document.getElementById('local-apikey');
const apiKeyEl = document.getElementById('api-key');
const installBtn = document.getElementById('install-btn');
const advWrap = document.getElementById('adv-wrap');
const advToggle = document.getElementById('adv-toggle');
const advPanel = document.getElementById('adv-panel');
const advGrid = document.getElementById('adv-grid');
const advJudge = document.getElementById('adv-judge');
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

// Shared by the engine panel and the advanced-panel disclosure buttons.
function toggleDisclosure(button, panel) {
  const open = panel.hidden;
  panel.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
}

engineToggle.addEventListener('click', () => toggleDisclosure(engineToggle, settingsEl));
advToggle.addEventListener('click', () => toggleDisclosure(advToggle, advPanel));

document.getElementById('engine-options').addEventListener('change', readSettingsFromForm);
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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = questionEl.value.trim();
  if (!question) return;
  await runDebate(question);
});

againBtn.addEventListener('click', () => {
  arena.hidden = true;
  againBtn.hidden = true;
  questionEl.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

async function runDebate(question) {
  conveneBtn.disabled = true;
  resetArena();

  try {
    const res = await fetch('/api/debate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, config: requestConfig() }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `request failed (${res.status})`);
    }
    await consumeSSE(res.body, handleEvent);
  } catch (err) {
    modeBadge.hidden = false;
    modeBadge.textContent = `Error: ${err.message}`;
  } finally {
    conveneBtn.disabled = false;
    againBtn.hidden = false;
  }
}

function resetArena() {
  debaters = [];
  verdictRaw = '';
  panelStrip.innerHTML = '';
  roundsEl.innerHTML = '';
  verdictBody.innerHTML = '';
  verdictSection.hidden = true;
  againBtn.hidden = true;
  modeBadge.hidden = true;
  arena.hidden = false;
  arena.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

function handleEvent(ev) {
  switch (ev.type) {
    case 'start': {
      debaters = ev.debaters;
      const label = BACKEND_LABELS[ev.backend] || ev.backend;
      modeBadge.hidden = false;
      modeBadge.textContent = ev.mock
        ? 'Demo mode — pick a real engine in ⚙︎ Engine for a live debate.'
        : `Engine: ${label}`;
      for (const d of ev.debaters) {
        panelStrip.insertAdjacentHTML(
          'beforeend',
          `<div class="chip" title="${esc(d.tagline)}">
             <span class="dot" style="background:${esc(d.color)}"></span>
             <span class="who"><b>${esc(d.name)}</b><small>${esc(d.model)}</small></span>
           </div>`
        );
      }
      judgeModelEl.textContent = `${ev.judge.name} · ${ev.judge.model}`;
      break;
    }
    case 'round_start': {
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
        `<section class="round"><h2>Round ${ev.round} — ${esc(ev.title)}</h2><div class="cards">${cards}</div></section>`
      );
      break;
    }
    case 'turn_start': {
      cardOf(ev)?.classList.add('speaking');
      break;
    }
    case 'delta': {
      const card = cardOf(ev);
      if (card) {
        card.querySelector('.body').textContent += ev.text;
      }
      break;
    }
    case 'turn_end': {
      cardOf(ev)?.classList.remove('speaking');
      break;
    }
    case 'turn_error': {
      const card = ev.round ? cardOf(ev) : null;
      if (card) {
        card.classList.remove('speaking');
        card.classList.add('errored');
        card.querySelector('.body').textContent = `⚠ ${ev.message}`;
      } else {
        verdictBody.textContent = `⚠ ${ev.message}`;
        verdictSection.hidden = false;
      }
      break;
    }
    case 'verdict_start': {
      verdictSection.hidden = false;
      verdictSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      break;
    }
    case 'verdict_delta': {
      verdictRaw += ev.text;
      verdictBody.innerHTML = renderVerdict(verdictRaw);
      break;
    }
    case 'error': {
      modeBadge.hidden = false;
      modeBadge.textContent = `Error: ${ev.message}`;
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
