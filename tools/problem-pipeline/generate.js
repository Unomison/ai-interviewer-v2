/**
 * Milestone 6 — LLM problem generation module (spec §4.4, step 3-4).
 *
 * Uses the M2 gateway (task `problem_gen`, strongest available model) to
 * propose a NEW problem: own wording of the statement, constraints,
 * examples, function signature spec, tests (visible + hidden, including
 * edge cases), a reference solution, an independent oracle, and a plausible
 * wrong solution — all as one validated JSON object matching the canonical
 * problem schema's authorable subset.
 *
 * The output is a CANDIDATE: it must still pass through the pipeline
 * (canonicalise → verify → differential → calibrate) before entering the
 * bank. Expected outputs in generated tests are re-derived from executed
 * code by the pipeline, never trusted from LLM text alone.
 *
 * Requires real LLM keys. With no keys configured the gateway falls back
 * to deterministic mocks — this module refuses loudly instead of emitting
 * mock problems into the bank.
 *
 * Usage:
 *   node tools/problem-pipeline/generate.js --topic "sliding window" --difficulty easy
 */
import { gateway } from '../../apps/api/src/llm/index.js';
import { problemSchema } from '@ai-interviewer/schemas';

const NO_KEYS_MESSAGE =
  'problem generation needs a real LLM: set GEMINI_API_KEY and/or GROQ_API_KEY. ' +
  'The gateway is in mock mode (no keys found), and mock output must never enter the problem bank.';

/**
 * Propose one candidate problem. Returns the canonical-validated candidate
 * (still unvalidated by execution — run it through the pipeline next).
 * @throws when no LLM keys are configured, the budget is exhausted, or the
 * output fails schema validation.
 */
export async function generateProblem({ topic, difficulty = 'easy', hints = '' } = {}) {
  if (!topic) throw new Error('generateProblem needs a topic, e.g. { topic: "two pointers" }');
  const budget = gateway.budgetAllows('problem_gen');
  if (!budget.allowed) {
    throw new Error(`LLM budget exhausted for problem_gen: ${budget.reason}`);
  }
  const prompt = [
    'You are designing a coding-interview practice problem. Output ONLY JSON matching the required schema.',
    '',
    `Topic: ${topic}. Difficulty: ${difficulty} (easy = solvable in 10-15 min, medium = 20-30 min).`,
    hints ? `Extra guidance: ${hints}` : '',
    '',
    'Rules:',
    '- Write the statement in your OWN words (never copy LeetCode/GFG text).',
    '- tests: at least 3 visible and 3 hidden; include edge cases (empty/single-element/boundary) and one larger input.',
    '- args are positional JSON values for solve(...); expected is the exact expected return value.',
    '- comparison: "exact" for ints/bools/strings, "unordered" when output order does not matter, "float" with floatTolerance for floats.',
    '- reference: optimal solution in all three languages. The C++ code must define solve(...) at global scope, must NOT define main, and may use #include <bits/stdc++.h>.',
    '- oracle: a DIFFERENT, independently-written solution (e.g. brute force) in ONE language — it must produce identical outputs.',
    '- wrong: a PLAUSIBLE buggy solution (off-by-one, missed edge case, wrong comparison) that fails at least one of your tests; explain the bug in note.',
    '- Keep code short and dependency-free (no imports beyond the standard library / STL).',
  ]
    .filter(Boolean)
    .join('\n');

  // The generatable subset of the canonical schema. timeLimitMs/memoryMb have
  // defaults; the pipeline overwrites them during calibration. (Note: we can't
  // use .omit() here because superRefine() wraps the schema in ZodEffects.)
  const draftSchema = problemSchema;
  const res = await gateway.generate({ task: 'problem_gen', prompt, schema: draftSchema });
  if (res.provider === 'mock') {
    throw new Error(NO_KEYS_MESSAGE);
  }
  return res.data;
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  const topic = get('--topic');
  const difficulty = get('--difficulty') || 'easy';
  const out = get('--out');
  try {
    const candidate = await generateProblem({ topic, difficulty });
    const json = JSON.stringify(candidate, null, 2);
    if (out) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(out, json);
      console.log(`candidate written to ${out} — validate it with the pipeline before banking it`);
    } else {
      console.log(json);
    }
  } catch (err) {
    console.error(`generate failed: ${(err && err.message) || err}`);
    process.exit(1);
  }
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '');
  } catch {
    return false;
  }
})();
if (isMain) main();
