/**
 * Milestone 4 — execution engine (framework-agnostic).
 *
 * Spec §4.8: run candidate code in the visitor's browser inside Web Workers
 * with hard timeouts — terminate the worker on overrun, mark the test TLE,
 * continue with the next test. Untrusted code NEVER touches the main thread
 * or the backend (there is deliberately no server-side execution).
 *
 * The core `runTests` takes an injected `createWorker()` factory so the exact
 * same code path runs in the browser (Web Worker via Blob URL) and in node
 * tests (worker_threads). Worker adapter interface:
 *   { post(msg), onceResult() -> Promise, terminate() -> Promise|void }
 */

import {
  JS_WORKER_SOURCE,
  compareResults,
  aggregateVerdict,
} from './harness.js';

export const DEFAULT_TIME_LIMIT_MS = 2000;
/** Per-language time-limit multipliers (spec §4.8; Python is slower under Pyodide). */
export const LANGUAGE_TIME_MULTIPLIER = { javascript: 1, python: 3, cpp: 1 };
export const MAX_OUTPUT_BYTES = 262144; // 256 KB per test output

function limitFor(problem, language) {
  const base = problem.timeLimitMs || DEFAULT_TIME_LIMIT_MS;
  return Math.round(base * (LANGUAGE_TIME_MULTIPLIER[language] || 1));
}

/**
 * Browser factory for the JavaScript worker. The worker script is a plain
 * string (no Vite worker bundling) turned into a Blob URL on demand, so it
 * never lands in the initial bundle.
 */
export function createBrowserJsWorker() {
  const url = URL.createObjectURL(new Blob([JS_WORKER_SOURCE], { type: 'text/javascript' }));
  const w = new Worker(url);
  let settled = false;
  return {
    post: (msg) => w.postMessage(msg),
    onceResult: () =>
      new Promise((resolve) => {
        w.onmessage = (e) => {
          if (!settled) {
            settled = true;
            resolve(e.data);
          }
        };
        w.onerror = (e) => {
          if (!settled) {
            settled = true;
            resolve({ ok: false, error: `Worker error: ${(e && e.message) || 'unknown'}` });
          }
        };
      }),
    terminate: () => {
      w.terminate();
      URL.revokeObjectURL(url);
    },
  };
}

async function runOneTest({ worker, code, problem, test, index, timeLimitMs }) {
  const started = Date.now();
  const message =
    worker.messageForTest
      ? worker.messageForTest({ code, problem, test, index })
      : { code, fnName: problem.functionName, args: test.args };

  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timeout: true }), timeLimitMs);
  });
  worker.post(message);
  const outcome = await Promise.race([worker.onceResult(), timeoutPromise]);
  clearTimeout(timer);

  if (outcome && outcome.__timeout) {
    await worker.terminate();
    return {
      index,
      status: 'tle',
      runtimeMs: timeLimitMs,
      error: `Time limit exceeded (${timeLimitMs} ms) — the worker was terminated.`,
    };
  }
  await worker.terminate();

  const runtimeMs = Date.now() - started;
  if (!outcome.ok) {
    return { index, status: 'error', runtimeMs, error: outcome.error || 'Unknown worker error' };
  }
  let size = 0;
  try {
    size = JSON.stringify(outcome.value)?.length ?? 0;
  } catch {
    return { index, status: 'error', runtimeMs, error: 'Result could not be serialized.' };
  }
  if (size > MAX_OUTPUT_BYTES) {
    return { index, status: 'error', runtimeMs, error: 'Output too large (over 256 KB).' };
  }
  const { pass } = compareResults(outcome.value, test.expected, problem);
  if (pass) return { index, status: 'pass', runtimeMs };
  return {
    index,
    status: 'fail',
    runtimeMs,
    actual: outcome.value,
    expected: test.expected,
  };
}

/**
 * Core runner: one worker per test, hard timeout, terminate on overrun.
 * `createWorker` is injected (browser Web Worker or node worker_threads).
 */
export async function runTests({ language, code, problem, timeLimitMs, createWorker, onTestDone }) {
  const limit = timeLimitMs || limitFor(problem, language);
  const results = [];
  for (let i = 0; i < problem.tests.length; i++) {
    const worker = createWorker();
    try {
      const r = await runOneTest({ worker, code, problem, test: problem.tests[i], index: i, timeLimitMs: limit });
      results.push(r);
      if (onTestDone) onTestDone(r, i);
    } finally {
      // runOneTest already terminated the worker on every path; this is a
      // belt-and-braces no-op for factories whose terminate is idempotent.
      try {
        await worker.terminate();
      } catch {
        /* already terminated */
      }
    }
  }
  return { ...aggregateVerdict(results), results, timeLimitMs: limit };
}

/** Convenience: JavaScript tests with the browser worker factory. */
export function runJavaScriptTests({ code, problem, timeLimitMs, onTestDone }) {
  return runTests({
    language: 'javascript',
    code,
    problem,
    timeLimitMs,
    createWorker: createBrowserJsWorker,
    onTestDone,
  });
}

/**
 * Python session: Pyodide init is expensive, so one worker serves a whole
 * problem run. Each test is still raced against the per-test timeout; on
 * overrun the worker is terminated, the test is marked TLE, and a fresh
 * worker is lazily re-initialised before the next test (progress reported).
 */
export class PythonSession {
  constructor({ createWorker, onProgress }) {
    this.createWorker = createWorker;
    this.onProgress = onProgress;
    this.worker = null;
  }

  async ensureReady() {
    if (this.worker) return;
    this.onProgress?.('loading', 'Starting the Python worker…');
    this.worker = this.createWorker((stage, text) => this.onProgress?.(stage, text));
    await this.worker.whenReady();
  }

  async runTest({ code, problem, test, index, timeLimitMs }) {
    await this.ensureReady();
    const started = Date.now();
    let timer;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ __timeout: true }), timeLimitMs);
    });
    this.worker.post(this.worker.messageForTest({ code, problem, test, index }));
    const outcome = await Promise.race([this.worker.onceResult(), timeoutPromise]);
    clearTimeout(timer);

    if (outcome && outcome.__timeout) {
      await this.dispose();
      return {
        index,
        status: 'tle',
        runtimeMs: timeLimitMs,
        error: `Time limit exceeded (${timeLimitMs} ms) — the Python worker was terminated and will reload for the next test.`,
      };
    }
    const runtimeMs = Date.now() - started;
    if (!outcome.ok) {
      return { index, status: 'error', runtimeMs, error: outcome.error || 'Unknown Python error' };
    }
    const { pass } = compareResults(outcome.value, test.expected, problem);
    if (pass) return { index, status: 'pass', runtimeMs };
    return { index, status: 'fail', runtimeMs, actual: outcome.value, expected: test.expected };
  }

  async dispose() {
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch {
        /* ignore */
      }
      this.worker = null;
    }
  }
}

/** Python tests through a persistent session (spec: terminate on overrun). */
export async function runPythonTests({ code, problem, timeLimitMs, createWorker, onProgress, onTestDone }) {
  const limit = timeLimitMs || limitFor(problem, 'python');
  const session = new PythonSession({ createWorker, onProgress });
  const results = [];
  try {
    for (let i = 0; i < problem.tests.length; i++) {
      const r = await session.runTest({ code, problem, test: problem.tests[i], index: i, timeLimitMs: limit });
      results.push(r);
      if (onTestDone) onTestDone(r, i);
    }
  } finally {
    await session.dispose();
  }
  return { ...aggregateVerdict(results), results, timeLimitMs: limit };
}
