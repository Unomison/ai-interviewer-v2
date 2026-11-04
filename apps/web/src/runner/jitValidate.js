/**
 * Milestone 10 — browser-side JIT validation (spec §4.9).
 *
 * The server generates a JIT problem draft (statement, tests, reference +
 * wrong solutions) but NEVER executes it. This module runs the M6 trust
 * bar in the visitor's own browser, using the real in-browser runners:
 *
 *   1. reference solution must pass ALL tests (JS + Python; C++ when the
 *      toolchain is already loaded — never force a 24 MB download)
 *   2. the wrong solution must FAIL at least one test
 *   3. reference runtimes are measured for the server's time-limit derivation
 *
 * The resulting receipt is posted to POST /api/problems/jit/validate; the
 * server decides (assessJitReceipt) and never serves an unvalidated problem.
 */
import { runJavaScriptTests, runPythonTests } from './executor.js';
import { createPythonWorker } from './pyodide.js';

export const JIT_VALIDATION_TIME_LIMIT_MS = 10000;

/**
 * Run one solution against all tests in one language.
 * @returns {Promise<{passed, total, runtimesMs[], ok}>}
 */
async function runSolution({ language, code, draft, cppRunners }) {
  let summary;
  if (language === 'javascript') {
    summary = await runJavaScriptTests({ code, problem: draft, timeLimitMs: JIT_VALIDATION_TIME_LIMIT_MS });
  } else if (language === 'python') {
    summary = await runPythonTests({ code, problem: draft, createWorker: createPythonWorker, timeLimitMs: JIT_VALIDATION_TIME_LIMIT_MS });
  } else if (language === 'cpp' && cppRunners) {
    const { runCppTests } = await import('./cpp.js');
    summary = await runCppTests({
      code,
      problem: draft,
      timeLimitMs: JIT_VALIDATION_TIME_LIMIT_MS,
      createCompilerWorker: cppRunners.createCompilerWorker,
      createRunnerWorker: cppRunners.createRunnerWorker,
    });
  } else {
    throw new Error(`unsupported JIT validation language: ${language}`);
  }
  return {
    passed: summary.passed,
    total: summary.total,
    runtimesMs: (summary.results || []).map((r) => Math.max(1, Math.round(r.runtimeMs || 1))),
    ok: summary.allPass,
  };
}

/**
 * Validate a JIT draft in the browser.
 *
 * @param {object} draft — full JIT draft (with reference/wrong solutions)
 * @param {object} opts — { languages: ['javascript','python'], cppRunners?, onProgress }
 * @returns {Promise<receipt>} — { language, referencePassed, referenceTotal,
 *   referenceRuntimesMs, wrongFailed, wrongTotal }
 *
 * The receipt covers the PRIMARY language (first in `languages`); the
 * reference must additionally pass in every other listed language.
 * Throws on any execution failure — the caller treats it as "not validated".
 */
export async function validateJitDraft(draft, { languages = ['javascript', 'python'], cppRunners = null, onProgress } = {}) {
  if (!draft || !draft.reference || !draft.wrong) {
    throw new Error('JIT draft is missing reference/wrong solutions.');
  }
  const langs = languages.filter((l) => l === 'javascript' || l === 'python' || (l === 'cpp' && cppRunners));
  if (langs.length === 0) throw new Error('No runnable language available for JIT validation.');

  const report = (stage, text) => {
    try { onProgress?.(stage, text); } catch { /* progress must never break validation */ }
  };

  // Reference must pass everywhere.
  const refRuns = {};
  for (const language of langs) {
    report('validate', `Running reference solution (${language})…`);
    const code = draft.reference[language];
    if (!code) throw new Error(`JIT draft has no reference solution for ${language}.`);
    refRuns[language] = await runSolution({ language, code, draft, cppRunners });
    if (!refRuns[language].ok) {
      throw new Error(
        `Reference solution failed in ${language}: ` +
        `${refRuns[language].passed}/${refRuns[language].total} passed.`,
      );
    }
  }

  // Wrong solution must fail ≥1 test, run in the language it was written
  // in (the draft schema guarantees one of javascript/python/cpp).
  const primary = langs[0];
  const wrongLang = draft.wrong.language;
  if (!langs.includes(wrongLang)) {
    throw new Error(`Cannot validate the wrong solution: language ${wrongLang} is not runnable here.`);
  }
  report('validate', `Running wrong solution (${wrongLang})…`);
  const wrongRun = await runSolution({ language: wrongLang, code: draft.wrong.code, draft, cppRunners });

  const primaryRef = refRuns[primary];
  return {
    language: primary,
    referencePassed: primaryRef.passed,
    referenceTotal: primaryRef.total,
    referenceRuntimesMs: primaryRef.runtimesMs,
    wrongFailed: wrongRun.total - wrongRun.passed,
    wrongTotal: wrongRun.total,
    languagesValidated: langs,
  };
}
