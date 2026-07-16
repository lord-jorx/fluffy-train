import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDebate, pickBackend, resolveConfig, validateConfig, serverDefaults } from './lib/debate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(here, 'public')));

// Non-secret server defaults, so the settings UI can preselect a sensible engine.
app.get('/api/config', (req, res) => {
  res.json(serverDefaults());
});

app.post('/api/debate', async (req, res) => {
  const question = (req.body?.question || '').trim();
  if (!question) {
    return res.status(400).json({ error: 'question is required' });
  }
  if (question.length > 2000) {
    return res.status(400).json({ error: 'question is too long (max 2000 characters)' });
  }

  // Validate the chosen engine before opening the stream, so bad config
  // surfaces as a clean 400 the browser can show inline.
  try {
    validateConfig(resolveConfig(req.body?.config));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  let closed = false;
  res.on('close', () => { closed = true; });

  const emit = (event) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    await runDebate(question, emit, req.body?.config);
  } catch (err) {
    emit({ type: 'error', message: err?.message || 'debate failed' });
  }
  res.end();
});

function lanUrls(port) {
  const urls = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${port}`);
    }
  }
  return urls;
}

const PORT = process.env.PORT || 3000;
// Bind on all interfaces so a phone on the same Wi-Fi can open the app.
app.listen(PORT, '0.0.0.0', () => {
  const mode = {
    mock: 'DEMO (MOCK=1 — canned responses)',
    local: `LIVE via OpenAI-compatible server at ${process.env.LLM_BASE_URL} (model: ${process.env.LLM_MODEL || 'llama3.1'})`,
    api: 'LIVE via Claude API (ANTHROPIC_API_KEY — works with free starter credits)',
    'claude-code': 'LIVE via Claude Code login (Pro/Max subscription, no API key)',
  }[pickBackend()];
  console.log(`\n  🏛️  Quorum — mode: ${mode}\n`);
  console.log(`     On this computer:  http://localhost:${PORT}`);
  for (const url of lanUrls(PORT)) {
    console.log(`     On your phone:     ${url}   (same Wi-Fi → Add to Home Screen)`);
  }
  console.log('');
});
