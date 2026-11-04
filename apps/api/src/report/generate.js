/**
 * Milestone 10 — final report generation (spec §4.10).
 *
 * One `report` gateway call over the finished session. The LLM scores only
 * the judgement dimensions (optimisation, communication, resume_depth) and
 * writes prose; deterministic dimensions (problem_solving, code_correctness)
 * are computed in code from executed results. Evidence quotes are enforced
 * afterwards (evidence.js) — unverifiable claims are flagged as inference,
 * never silently presented as fact.
 *
 * Result pattern follows the M8/M9 convention: { ok, ... } or
 * { ok: false, error, message }. Never throws on bad input.
 */
import { gateway } from '../llm/index.js';
import { getSession } from '../interview/store.js';
import { getSession as getIntakeSession } from '../intake/store.js';
import { buildTurnContext } from '../interview/interviewer.js';
import {
  REPORT_DIMENSIONS,
  llmReportSchema,
  reportRequestSchema,
} from './schema.js';
import {
  computeReportStats,
  deterministicDimensionScores,
  overallScore,
} from './stats.js';
import { enforceReportEvidence, partitionEvidence } from './evidence.js';
import { saveReport, createShareToken } from './store.js';

export const DISCLAIMER =
  'This report is an automated estimate, not ground truth. Scores combine ' +
  'deterministic measurements (test results, hint usage) with a language ' +
  'model\u2019s judgement of your transcript. Treat it as practice feedback, ' +
  'not as a hiring decision.';

function gwOf(deps) {
  return (deps && deps.gateway) || gateway;
}

function dimensionMeta(key) {
  return REPORT_DIMENSIONS.find((d) => d.key === key);
}

/** ATS recap for the prompt + stats (null when unavailable). */
async function atsRecap(session) {
  if (!session.intakeToken) return null;
  try {
    const intake = await getIntakeSession(session.intakeToken);
    const r = intake && intake.atsReport;
    if (!r || typeof r.score !== 'number') return null;
    return {
      score: r.score,
      genuineGaps: Array.isArray(r.genuineGaps) ? r.genuineGaps.slice(0, 12) : [],
    };
  } catch {
    return null;
  }
}

function buildReportPrompt({ session, stats, ats }) {
  const transcript = buildTurnContext(session.transcript || []);
  const dsaLines = stats.dsa.map(
    (p) =>
      `- ${p.title} (${p.slug}): pass rate ${p.passRate === null ? 'n/a' : p.passRate + '%'}, ` +
      `hints ${p.hintsUsed}, approach attempts ${p.approachAttempts}, ` +
      `unlocked=${p.unlocked} (${p.unlockReason || 'n/a'}), languages: ${p.languages.join(', ') || 'none'}`,
  );
  const roundLines = stats.rounds.map(
    (r) =>
      `- ${r.round}: ${r.turns} turns` +
      (r.durationMs !== null ? `, ${Math.round(r.durationMs / 1000)}s` : '') +
      (r.assessment ? ` — interviewer note: ${r.assessment}` : ''),
  );
  return [
    'You are an expert interview coach writing a practice-interview report. Output ONLY JSON matching the required schema.',
    '',
    `Candidate: ${session.role || 'software engineering role'}${session.company ? ` at ${session.company}` : ''}.`,
    `Interview duration: ${stats.interviewDurationMs !== null ? Math.round(stats.interviewDurationMs / 60000) + ' min' : 'unknown'}.`,
    '',
    'DETERMINISTIC FACTS (already scored in code — do not re-score these dimensions, but reference the facts in your prose):',
    `Code correctness and problem solving are computed from: ${dsaLines.join(' ')}`,
    ats ? `ATS resume score: ${ats.score}/100; genuine gaps: ${ats.genuineGaps.join(', ') || 'none'}.` : 'No ATS report available.',
    '',
    'ROUND TIMELINE:',
    roundLines.join('\n'),
    '',
    'TRANSCRIPT (condensed where long):',
    transcript,
    '',
    'YOUR JOB — score exactly these three dimensions (0-100, or null when the transcript gives you too little signal):',
    '- optimisation: did the candidate state time/space complexity correctly and choose an efficient approach?',
    '- communication: clarity, structure, and responsiveness across the whole interview.',
    '- resume_depth: depth and ownership shown when discussing their own projects/experience.',
    '',
    'EVIDENCE RULE (strict): every score and every weak-topic claim MUST include 1-2 SHORT quotes copied VERBATIM from the transcript above (candidate\u2019s own words). A claim without a verbatim quote will be marked as inference. If a dimension has too little signal, score it null.',
    'Then write: a 2-4 sentence summary, up to 8 weak topics (each with a reason), and a prioritised study plan (1-8 steps; each step: topic, why it matters for THIS candidate, concrete actions, and suggested problem slugs from the bank when relevant).',
  ].join('\n');
}

/**
 * Generate the final report for a finished interview.
 * @returns {Promise<{ok:true, report}> | {ok:false, error, message}>}
 */
export async function generateReport(input, deps = {}) {
  const parsed = reportRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_request', message: 'sessionToken is required.' };
  }
  const { sessionToken } = parsed.data;

  const session = await getSession(sessionToken);
  if (!session) return { ok: false, error: 'session_not_found', message: 'No interview session found.' };
  if (session.status !== 'done') {
    return { ok: false, error: 'interview_not_complete', message: 'The interview is still in progress.' };
  }

  const stats = computeReportStats(session);
  const ats = await atsRecap(session);
  if (ats) stats.ats = ats;

  const det = deterministicDimensionScores(stats.dsa);
  const prompt = buildReportPrompt({ session, stats, ats });

  let llm;
  try {
    const res = await gwOf(deps).generate({ task: 'report', prompt, schema: llmReportSchema });
    llm = res.data;
  } catch (err) {
    const msg = (err && err.message) || 'report generation failed';
    if (/budget|quota|exhausted/i.test(msg)) {
      return { ok: false, error: 'report_unavailable', message: 'LLM quota exhausted — try the recorded demo instead.' };
    }
    return { ok: false, error: 'report_unavailable', message: `Report generation failed: ${msg}` };
  }

  const enforced = enforceReportEvidence(llm, session.transcript || []);

  // Merge: deterministic dimensions from code, judgement dimensions from the LLM.
  const dimensions = REPORT_DIMENSIONS.map((meta) => {
    if (meta.key === 'problem_solving' || meta.key === 'code_correctness') {
      const score = det[meta.key];
      const dsaFacts = stats.dsa.map((p) => ({
        quote: `${p.title}: ${p.passRate === null ? 'no submission' : p.passRate + '% tests passed'}, ${p.hintsUsed} hint(s) used`,
        speaker: 'candidate',
      }));
      return {
        key: meta.key,
        label: meta.label,
        weight: meta.weight,
        score,
        scoreSource: 'deterministic',
        assessment:
          score === null
            ? 'No DSA submissions were recorded, so this dimension cannot be scored.'
            : `Computed from executed test results and hint usage across ${stats.dsa.length} problem(s).`,
        evidence: dsaFacts.slice(0, 4),
        insufficientData: score === null,
        inference: false,
      };
    }
    const e = enforced.dimensions[meta.key] || { score: null, assessment: '', evidence: [] };
    return {
      key: meta.key,
      label: meta.label,
      weight: meta.weight,
      score: e.score,
      scoreSource: 'llm',
      assessment: e.assessment,
      evidence: e.evidence,
      insufficientData: !!e.insufficientData,
      inference: !!e.inference,
    };
  });

  const report = {
    summary: llm.summary,
    overallScore: overallScore(dimensions),
    dimensions,
    weakTopics: enforced.weakTopics,
    studyPlan: llm.studyPlan,
    stats,
    evidenceReport: {
      verifiedQuotes: enforced.verifiedQuotes,
      inferenceClaims: enforced.inferenceClaims,
    },
    // Milestone 11 — source citations for KB-grounded claims (spec §4.9
    // use #4). Collected at interview start from retrieved chunks (vector)
    // or the KB document's source list (direct fallback).
    sources: Array.isArray(session.ragCitations) ? session.ragCitations : [],
    disclaimer: DISCLAIMER,
  };

  const saved = await saveReport(sessionToken, report);
  const shareToken = await createShareToken(saved.id);
  return {
    ok: true,
    report: { ...report, id: saved.id, createdAt: saved.createdAt, shareToken },
  };
}

/** Re-exported for tests. */
export { partitionEvidence };
