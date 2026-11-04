/**
 * Milestone 8 — deterministic DSA problem selection (spec §4.4).
 *
 * No LLM call is spent choosing problem slugs: the bank is filtered by
 * difficulty for the candidate's seniority, then ranked by topic overlap
 * with the candidate's genuine ATS gaps (skills the resume does not
 * evidence). Ties break by slug so selection is fully deterministic and
 * unit-testable.
 */
import { listProblems } from '../problems/index.js';

/** Which bank difficulties are fair game per seniority. */
const DIFFICULTY_POOL = {
  intern: ['easy'],
  'new-grad': ['easy'],
  mid: ['easy', 'medium'],
  senior: ['easy', 'medium'],
  unknown: ['easy'],
};

function normTokens(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length > 2);
}

/**
 * Overlap score between a problem and the candidate's gap skills:
 * +1 per gap-skill token appearing in the problem's topics/title.
 * Pure function — unit tested.
 */
export function scoreProblem(problem, gapSkills = []) {
  const hay = new Set([
    ...(problem.topics || []).flatMap(normTokens),
    ...normTokens(problem.title),
  ]);
  let score = 0;
  for (const gap of gapSkills || []) {
    for (const tok of normTokens(gap)) {
      if (hay.has(tok)) score += 1;
    }
  }
  return score;
}

/**
 * @returns {Promise<Array>} client-safe problems, best first.
 */
export async function selectProblems({
  seniority = 'new-grad',
  gapSkills = [],
  count = 2,
  excludeSlugs = [],
  listFn = listProblems,
} = {}) {
  const { problems } = await listFn();
  const pool = DIFFICULTY_POOL[seniority] || DIFFICULTY_POOL.unknown;
  const excluded = new Set(excludeSlugs || []);
  const candidates = problems.filter(
    (p) => pool.includes(p.difficulty) && !excluded.has(p.slug),
  );
  return candidates
    .map((p) => ({ p, s: scoreProblem(p, gapSkills) }))
    .sort((a, b) => b.s - a.s || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, Math.max(1, count))
    .map((r) => r.p);
}
