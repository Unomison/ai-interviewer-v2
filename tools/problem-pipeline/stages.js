/**
 * Milestone 6 — offline problem pipeline stages (spec §4.4 / §4.9).
 *
 *   canonicalise → verify → differential → calibrate → emit
 *
 * Each stage is a pure-ish async function so the CLI (run.js) stays thin
 * and the stages are unit-testable with stubbed runtimes.
 */
import { problemSchema, toClientProblem } from '@ai-interviewer/schemas';
import { compareResults } from '../../apps/web/src/runner/harness.js';
import { runSolution, allPassed } from './runtimes.js';

// ---------------------------------------------------------------------------
// 1. canonicalise — validate a candidate problem against the canonical schema
// ---------------------------------------------------------------------------

export class PipelineError extends Error {
  constructor(stage, slug, message) {
    super(`[${stage}] ${slug}: ${message}`);
    this.name = 'PipelineError';
    this.stage = stage;
    this.slug = slug;
  }
}

/**
 * @returns the validated canonical problem (with Zod defaults applied).
 * @throws PipelineError with the schema's human-readable issues.
 */
export function canonicalise(candidate) {
  const slug = (candidate && candidate.slug) || '<unknown>';
  const parsed = problemSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new PipelineError('canonicalise', slug, `schema validation failed — ${issues}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// 2. verify — reference solution passes EVERY test in ALL THREE real runtimes
// ---------------------------------------------------------------------------

const LANGUAGES = ['javascript', 'python', 'cpp'];

/**
 * @returns { language: { run, maxRuntimeMs } } — throws PipelineError unless
 * every test passes in every language.
 */
export async function verify(problem, { timeLimitMs, onProgress } = {}) {
  const perLanguage = {};
  for (const language of LANGUAGES) {
    const code = problem.reference[language];
    onProgress?.(`verify:${language}`, `${problem.slug} — running reference in ${language}…`);
    const run = await runSolution({ problem, language, code, timeLimitMs });
    if (run.fatalError && !allPassed(run)) {
      throw new PipelineError('verify', problem.slug, `${language}: ${run.fatalError}`);
    }
    const bad = run.results.filter((r) => r.status !== 'pass');
    if (bad.length > 0) {
      const first = bad[0];
      const detail =
        first.status === 'fail'
          ? `test #${first.index} failed (expected ${JSON.stringify(problem.tests[first.index].expected)}, got ${JSON.stringify(first.actual)})`
          : `test #${first.index} ${first.status}: ${(first.error || '').slice(0, 300)}`;
      throw new PipelineError('verify', problem.slug, `${language} reference: ${detail}`);
    }
    perLanguage[language] = {
      run,
      maxRuntimeMs: Math.max(...run.results.map((r) => r.runtimeMs || 0)),
      compileMs: run.compileMs ?? null,
    };
  }
  return perLanguage;
}

// ---------------------------------------------------------------------------
// 3. differential — wrong solution must FAIL ≥1 test; oracle must agree
//    with the reference on every test.
// ---------------------------------------------------------------------------

/**
 * Pure predicate over stubbed runs — unit-testable without runtimes.
 * Oracle/reference agreement honours the problem's comparison mode
 * (e.g. 'unordered' for 3sum, where solution order differs legitimately).
 * @returns {null} when the differential bar is met, else a reason string.
 */
export function differentialVerdict({ wrongRun, oracleRun, referenceRuns, problem }) {
  if (!wrongRun || wrongRun.results.length === 0) return 'wrong solution produced no results';
  const wrongFailed = wrongRun.results.some((r) => r.status === 'fail' || r.status === 'error');
  if (!wrongFailed) {
    return 'tests too weak: the wrong solution passes every test (differential bar failed)';
  }
  if (!oracleRun || !allPassed(oracleRun)) {
    const bad = (oracleRun?.results || []).filter((r) => r.status !== 'pass');
    return `oracle does not pass all tests (first bad: test #${bad[0]?.index} ${bad[0]?.status})`;
  }
  // Strict agreement: oracle's actual outputs must equal the reference's
  // actual outputs on every test, under the problem's comparison mode.
  const refByLang = {};
  for (const r of referenceRuns || []) refByLang[r.language] = r;
  const ref = refByLang.javascript || refByLang.python || refByLang.cpp || (referenceRuns || [])[0];
  if (!ref) return 'no reference run to compare the oracle against';
  for (const r of oracleRun.results) {
    const refActual = ref.results[r.index]?.actual;
    const agree = problem
      ? safeCompare(r.actual, refActual, problem)
      : deepEqualJson(r.actual, refActual);
    if (!agree) {
      return `oracle disagrees with reference on test #${r.index} (oracle ${JSON.stringify(r.actual)} vs reference ${JSON.stringify(refActual)})`;
    }
  }
  return null;
}

function safeCompare(a, b, problem) {
  try {
    return compareResults(a, b, problem).pass;
  } catch {
    return false;
  }
}

function deepEqualJson(a, b) {
  return JSON.stringify(normalizeJson(a)) === JSON.stringify(normalizeJson(b));
}

function normalizeJson(v) {
  if (typeof v === 'number') return v === 0 ? 0 : v;
  if (Array.isArray(v)) return v.map(normalizeJson);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = normalizeJson(v[k]);
    return out;
  }
  return v;
}

/**
 * Runs the differential stage for real: wrong solution (its language) +
 * oracle (its language), compared against the reference runs from verify().
 * @throws PipelineError when the bar is not met.
 */
export async function differential(problem, verifyOut, { timeLimitMs, onProgress } = {}) {
  onProgress?.('differential:wrong', `${problem.slug} — running wrong solution (${problem.wrong.language})…`);
  const wrongRun = await runSolution({
    problem,
    language: problem.wrong.language,
    code: problem.wrong.code,
    timeLimitMs,
  });
  onProgress?.('differential:oracle', `${problem.slug} — running oracle (${problem.oracle.language})…`);
  const oracleRun = await runSolution({
    problem,
    language: problem.oracle.language,
    code: problem.oracle.code,
    timeLimitMs,
  });
  const referenceRuns = Object.entries(verifyOut).map(([language, v]) => ({ language, ...v.run }));
  const reason = differentialVerdict({ wrongRun, oracleRun, referenceRuns, problem });
  if (reason) {
    throw new PipelineError('differential', problem.slug, reason);
  }
  return {
    wrong: {
      language: problem.wrong.language,
      note: problem.wrong.note,
      firstFailure: wrongRun.results.find((r) => r.status !== 'pass')?.index ?? null,
    },
    oracle: { language: problem.oracle.language, note: problem.oracle.note, agreement: 'all tests' },
  };
}

// ---------------------------------------------------------------------------
// 4. calibrate — per-language time limits from measured reference runtimes
// ---------------------------------------------------------------------------

/**
 * Calibration policy (ADR 007):
 *  - measured = max per-test runtime of the reference across verify runs,
 *    per language (this machine is fast; browsers on mid-range laptops are
 *    slower, hence the headroom multiple).
 *  - limit = ceil(HEADROOM × measured), floored at FLOOR_MS so trivial
 *    problems keep a sane limit, capped at CAP_MS.
 *  - the runner already applies per-language multipliers at runtime
 *    (M4: python ×3; M5: cpp ×1), so the bank stores ONE base limit.
 *  - memory: sanity note only — all bank problems are small; the C++ wasm
 *    cap is 64 MB (M5 flags).
 */
export const CALIBRATION = {
  HEADROOM: 10,
  FLOOR_MS: 1000,
  CAP_MS: 10000,
  DEFAULT_MS: 2000,
};

export function calibrateLimit(measuredMs) {
  const raw = Math.ceil(CALIBRATION.HEADROOM * Math.max(0, measuredMs));
  return Math.min(CALIBRATION.CAP_MS, Math.max(CALIBRATION.FLOOR_MS, raw));
}

/**
 * @returns {{ timeLimitMs, memoryMb, measured }} — measured per language.
 * Never *lowers* an author-specified limit below DEFAULT_MS; only raises
 * when the headroom math demands it (keeps the M4/M5 2000ms semantics).
 */
export function calibrate(problem, verifyOut) {
  const measured = {};
  for (const [language, v] of Object.entries(verifyOut)) {
    measured[language] = v.maxRuntimeMs;
  }
  const worst = Math.max(0, ...Object.values(measured));
  const computed = calibrateLimit(worst);
  const timeLimitMs = Math.max(CALIBRATION.DEFAULT_MS, computed);
  return {
    timeLimitMs,
    memoryMb: problem.memoryMb || 64,
    measured,
    policy: `max(2000, ceil(10 × worstMeasured=${worst}ms), floor 1000, cap 10000)`,
  };
}

// ---------------------------------------------------------------------------
// 5. emit — versioned bank JSON + client-safe projections
// ---------------------------------------------------------------------------

/**
 * Build the emit artifacts from validated problems (pure function).
 * @returns {{ bank, clientAll, clientPlayground }}
 */
export function buildEmitArtifacts({ version, problems, validations, playgroundSlugs, generatedAt }) {
  const bank = {
    version,
    generatedAt: generatedAt || new Date().toISOString(),
    count: problems.length,
    problems: problems.map((p) => ({ ...p })),
    validations,
  };
  const clientAll = problems.map(toClientProblem);
  const playgroundSet = new Set(playgroundSlugs);
  const clientPlayground = problems.filter((p) => playgroundSet.has(p.slug)).map(toClientProblem);
  return { bank, clientAll, clientPlayground };
}
