// The debate panel: five Claude personas plus a judge that synthesizes the
// verdict. Runs through the Claude Agent SDK on your Claude Code login
// (Pro/Max subscription), so models are the aliases Claude Code accepts:
// 'sonnet', 'haiku', 'opus'. Defaults are Pro-friendly; Max subscribers can
// upgrade the panel via DEBATER_MODELS (comma-separated, five entries) and
// JUDGE_MODEL.

const DEFAULT_DEBATERS = [
  {
    id: 'strategist',
    name: 'The Strategist',
    model: 'sonnet',
    color: '#e05d38',
    tagline: 'Long-term thinking, second-order effects',
    persona:
      'You are The Strategist. You reason about long-term consequences, incentives, and second-order effects. You favor the option that wins over years, not weeks, and you name the trade-offs others gloss over.',
  },
  {
    id: 'skeptic',
    name: 'The Skeptic',
    model: 'sonnet',
    color: '#8f6fe8',
    tagline: 'Hunts hidden assumptions and failure modes',
    persona:
      'You are The Skeptic. Your job is to find the hidden assumptions, missing information, and failure modes in the question itself and in the other debaters’ arguments. You are rigorous, not cynical: when an argument survives your scrutiny, you say so.',
  },
  {
    id: 'pragmatist',
    name: 'The Pragmatist',
    model: 'sonnet',
    color: '#3f9e6e',
    tagline: 'What can actually be executed on Monday',
    persona:
      'You are The Pragmatist. You care about what can actually be executed with the resources, energy, and constraints the asker realistically has. Elegant plans that will not survive contact with reality get called out. You favor reversible first steps.',
  },
  {
    id: 'contrarian',
    name: 'The Contrarian',
    model: 'sonnet',
    color: '#d4a017',
    tagline: 'Argues the side nobody else will',
    persona:
      'You are The Contrarian. You deliberately steelman the position the rest of the panel is dismissing or avoiding. If a consensus is forming, stress-test it. You argue in good faith — your goal is that the final verdict has confronted the strongest opposing case, not to be difficult.',
  },
  {
    id: 'analyst',
    name: 'The Analyst',
    model: 'haiku',
    color: '#4a90d9',
    tagline: 'First principles, numbers, base rates',
    persona:
      'You are The Analyst. You break the question down from first principles: quantify what can be quantified, cite base rates and comparable cases, and separate what is known from what is speculation. You are concise and allergic to vague claims.',
  },
];

const DEFAULT_JUDGE = {
  id: 'judge',
  name: 'The Arbiter',
  model: 'sonnet',
  color: '#c9a86a',
  persona:
    'You are The Arbiter, the judge of a structured debate between five advisors. You did not participate in the debate. You weigh the full three-round transcript and deliver a verdict.',
};

export function buildPanel() {
  const debaters = DEFAULT_DEBATERS.map((d) => ({ ...d }));
  const judge = { ...DEFAULT_JUDGE };

  const modelOverrides = (process.env.DEBATER_MODELS || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  modelOverrides.forEach((model, i) => {
    if (debaters[i]) debaters[i].model = model;
  });
  if (process.env.JUDGE_MODEL) judge.model = process.env.JUDGE_MODEL.trim();

  return { debaters, judge };
}

export const ROUNDS = [
  {
    number: 1,
    title: 'Opening positions',
    instruction:
      'Round 1 of 3 — Opening position. State your position on the question and your two or three strongest arguments for it. Do not hedge into a non-answer: commit to a recommendation.',
  },
  {
    number: 2,
    title: 'Cross-examination',
    instruction:
      'Round 2 of 3 — Cross-examination. You have read the other panelists’ opening positions (included below). Attack the weakest argument you saw, defend your own position against the strongest attack on it, and update your stance if someone genuinely changed your mind — say so explicitly if they did.',
  },
  {
    number: 3,
    title: 'Closing arguments',
    instruction:
      'Round 3 of 3 — Closing argument. Considering the full debate so far (included below), give your final recommendation. Concede the strongest point made against you, then state your sharpest, most actionable final advice.',
  },
];

export const VERDICT_INSTRUCTION =
  'Read the full three-round transcript below and deliver your verdict. Structure it exactly as: (1) **Verdict** — the single recommendation the asker should follow, in one or two sentences; (2) **Why** — the three decisive arguments from the debate, attributing each to the panelist who made it; (3) **Dissent worth keeping** — the strongest surviving counterargument and under what conditions it should change the decision; (4) **Confidence** — a percentage with a one-line justification.';
