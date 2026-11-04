/**
 * Milestone 6 — problem specs for the in-browser runner.
 *
 * SINGLE SOURCE OF TRUTH: this module re-exports the pipeline-generated
 * `problems.generated.js` (client-safe projection of the canonical bank,
 * playground slugs only). Do not define problems here — edit
 * `tools/problem-pipeline/bank/` and regenerate with:
 *   node tools/problem-pipeline/run.js
 *
 * The generated PROBLEMS entries carry the M4/M5 runner format (id, title,
 * statement, examples, constraints, params, returnType, comparison,
 * timeLimitMs, tests [{args, expected, hidden}], signatures, starter, hints).
 */
export { BANK_VERSION, PROBLEMS } from './problems.generated.js';

export const LANGUAGES = ['javascript', 'python', 'cpp'];

import { PROBLEMS } from './problems.generated.js';

export function getProblem(id) {
  return PROBLEMS.find((p) => p.id === id || p.slug === id) || null;
}
