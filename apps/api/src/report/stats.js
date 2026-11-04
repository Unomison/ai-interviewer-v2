/**
 * Milestone 10 — deterministic report statistics (spec §4.10).
 *
 * Everything here is computed from recorded session data, never by the
 * LLM: round durations, turn counts, DSA pass rates, hint usage. The model
 * writes prose *around* these facts. Pure functions — trivially testable.
 */
import { scoreDsaProblem } from '../interview/machine.js';
import { ROUND_ORDER } from '../interview/schema.js';

/**
 * Per-problem DSA facts from the session's dsa map.
 * @returns {Array} [{ slug, title, passRate|null, hintsUsed, approachAttempts,
 *                     unlocked, unlockReason, languages }]
 */
export function dsaProblemStats(dsa = {}) {
  return Object.values(dsa).map((p) => {
    const submissions = p.submissions || [];
    const last = submissions[submissions.length - 1];
    const passRate =
      last && last.results && typeof last.results.total === 'number' && last.results.total > 0
        ? Math.round((last.results.passed / last.results.total) * 100)
        : null;
    const languages = [...new Set(submissions.map((s) => s.language).filter(Boolean))];
    return {
      slug: p.slug,
      title: p.title || p.slug,
      passRate,
      hintsUsed: p.hintsUsed || 0,
      approachAttempts: p.approachAttempts || 0,
      unlocked: !!p.unlocked,
      unlockReason: p.unlockReason || null,
      languages,
    };
  });
}

/**
 * Deterministic dimension scores (spec §4.10: "Hint penalties and time
 * overruns applied deterministically").
 *
 * - code_correctness: mean pass rate of attempted DSA problems (null when
 *   nothing was submitted).
 * - problem_solving: starts at 100; −10 per hint (cap −30); −8 per extra
 *   approach attempt beyond the first per problem (cap −24); −10 when the
 *   editor was unlocked without a judged accept (hints-exhausted /
 *   judge-error). Null when no DSA problem was attempted.
 */
export function deterministicDimensionScores(dsaStats) {
  const attempted = dsaStats.filter((p) => p.passRate !== null);
  if (attempted.length === 0) {
    return { code_correctness: null, problem_solving: null };
  }
  const code_correctness = Math.round(
    attempted.reduce((sum, p) => sum + p.passRate, 0) / attempted.length,
  );
  let problem_solving = 100;
  for (const p of dsaStats) {
    problem_solving -= Math.min(p.hintsUsed * 10, 30);
    problem_solving -= Math.min(Math.max(p.approachAttempts - 1, 0) * 8, 24);
    if (p.unlocked && p.unlockReason && p.unlockReason !== 'accepted') problem_solving -= 10;
  }
  problem_solving = Math.max(0, Math.min(100, Math.round(problem_solving)));
  return { code_correctness, problem_solving };
}

/**
 * Overall score: weighted mean over dimensions that have data
 * (weights renormalised). Null when no dimension has data.
 */
export function overallScore(dimensions) {
  const scored = dimensions.filter((d) => d.score !== null && d.score !== undefined);
  if (scored.length === 0) return null;
  const totalWeight = scored.reduce((s, d) => s + d.weight, 0);
  if (totalWeight === 0) return null;
  return Math.round(scored.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight);
}

function roundDurationMs(round) {
  if (!round || !round.startedAt || !round.endedAt) return null;
  const ms = new Date(round.endedAt) - new Date(round.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * Full deterministic stats block for a finished interview session.
 * Never throws on missing fields — absent data becomes null.
 */
export function computeReportStats(session) {
  const transcript = Array.isArray(session.transcript) ? session.transcript : [];
  const rounds = [];
  const planOrder = Array.isArray(session.plan) && session.plan.length > 0
    ? session.plan.map((r) => r.type)
    : ROUND_ORDER;
  for (const type of planOrder) {
    const r = (session.rounds || {})[type] || {};
    rounds.push({
      round: type,
      durationMs: roundDurationMs(r),
      turns: transcript.filter((t) => t.round === type).length,
      assessment: typeof r.assessment === 'string' && r.assessment ? r.assessment : null,
    });
  }
  const dsa = dsaProblemStats(session.dsa);
  const interviewDurationMs =
    session.startedAt && session.endedAt
      ? Math.max(0, new Date(session.endedAt) - new Date(session.startedAt))
      : null;
  return {
    interviewDurationMs,
    totalTurns: transcript.length,
    candidateTurns: transcript.filter((t) => t.role === 'candidate').length,
    rounds,
    dsa,
    hintsUsedTotal: dsa.reduce((s, p) => s + p.hintsUsed, 0),
    ats: null, // filled by generate.js from the intake session when available
  };
}

/** Re-exported for the report: per-problem score incl. hint penalty (M8). */
export { scoreDsaProblem };
