// War Table frontend — streams the debate over SSE (fetch + ReadableStream,
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
      body: JSON.stringify({ question }),
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
      if (ev.mock) {
        modeBadge.hidden = false;
        modeBadge.textContent = 'Demo mode — set ANTHROPIC_API_KEY on the server for a live debate.';
      }
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
