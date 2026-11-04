/**
 * Milestone 6 — offline problem pipeline: language runtimes in Node.
 *
 * The pipeline validates every problem against the REAL execution paths:
 *  - JavaScript: M4's JS_WORKER_SOURCE via node worker_threads (the exact
 *    code the browser runs), one worker per test, timeout → TLE.
 *  - Python: Pyodide (npm package) inside a node worker_threads Worker,
 *    running M4's buildPythonHarness(); a parent-side watchdog bounds the
 *    whole run so a hanging candidate cannot stall the pipeline.
 *  - C++: browsercc compiled once per solution (M5's flags + bits/stdc++.h
 *    shim), then M5's CPP_RUNNER_WORKER_SOURCE per test in node workers.
 *
 * Unified interface: runSolution({ problem, language, code, timeLimitMs })
 *   → { language, results: [{ index, status, actual?, error?, runtimeMs }],
 *       compileMs?, fatalError? }
 * status ∈ 'pass' | 'fail' | 'error' | 'tle'. Comparison reuses M4's
 * compareResults so the pipeline grades exactly like the browser.
 */
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  JS_WORKER_SOURCE,
  buildPythonHarness,
  compareResults,
  buildCppSource,
  STDCPP_SHIM,
  parseCppMarkers,
  cppStdinForTest,
} from '../../apps/web/src/runner/harness.js';
import { CPP_RUNNER_WORKER_SOURCE, CPP_FLAGS } from '../../apps/web/src/runner/cpp.js';

const REPO_ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

// ---------------------------------------------------------------------------
// JavaScript — one worker per test (M4 executor semantics)
// ---------------------------------------------------------------------------

function runOneJsTest(problem, code, index, timeLimitMs) {
  return new Promise((resolve) => {
    const test = problem.tests[index];
    const t0 = Date.now();
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      w.terminate().catch(() => {});
      resolve(r);
    };
    const w = new Worker(JS_WORKER_SOURCE, { eval: true });
    const timer = setTimeout(() => {
      finish({ index, status: 'tle', runtimeMs: Date.now() - t0, error: `JS test timed out after ${timeLimitMs}ms` });
    }, timeLimitMs);
    // Avoid unhandled 'error' crashing the process if the worker dies.
    w.once('error', (e) => finish({ index, status: 'error', runtimeMs: Date.now() - t0, error: `Worker error: ${e.message}` }));
    w.once('message', (msg) => {
      const runtimeMs = Date.now() - t0;
      if (!msg || !msg.ok) {
        finish({ index, status: 'error', runtimeMs, error: (msg && msg.error) || 'no result' });
        return;
      }
      let pass = false;
      try {
        pass = compareResults(msg.value, test.expected, problem).pass;
      } catch (e) {
        finish({ index, status: 'error', runtimeMs, error: `compare failed: ${e.message}` });
        return;
      }
      finish({ index, status: pass ? 'pass' : 'fail', runtimeMs, actual: msg.value });
    });
    w.postMessage({ code, fnName: problem.functionName || 'solve', args: test.args });
  });
}

export async function runJavaScript(problem, code, { timeLimitMs = 15000 } = {}) {
  const results = [];
  for (let i = 0; i < problem.tests.length; i++) {
    results.push(await runOneJsTest(problem, code, i, timeLimitMs));
  }
  return { language: 'javascript', results };
}

// ---------------------------------------------------------------------------
// Python — Pyodide in a dedicated worker; parent watchdog bounds total time
// ---------------------------------------------------------------------------

const PY_WORKER_PATH = new URL('./py-worker.mjs', import.meta.url);

export async function runPython(problem, code, { timeLimitMs = 20000 } = {}) {
  const overallMs = problem.tests.length * timeLimitMs + 90000; // load + slack
  const t0 = Date.now();
  const harness = buildPythonHarness();
  const tests = problem.tests.map((t, i) => ({ args: t.args, index: i }));
  return new Promise((resolve) => {
    let done = false;
    const w = new Worker(PY_WORKER_PATH, {
      workerData: { code, tests, harness },
    });
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      w.terminate().catch(() => {});
      resolve(r);
    };
    const timer = setTimeout(() => {
      const elapsed = Date.now() - t0;
      const results = problem.tests.map((_, i) => ({
        index: i, status: 'tle', runtimeMs: elapsed, error: `Python run timed out after ${overallMs}ms (worker terminated)`,
      }));
      finish({ language: 'python', results, fatalError: 'python worker timeout — possible infinite loop' });
    }, overallMs);
    w.once('error', (e) => {
      const results = problem.tests.map((_, i) => ({
        index: i, status: 'error', runtimeMs: Date.now() - t0, error: `Python worker error: ${e.message}`,
      }));
      finish({ language: 'python', results, fatalError: e.message });
    });
    w.once('message', (msg) => {
      if (!msg || !msg.ok) {
        const results = problem.tests.map((_, i) => ({
          index: i, status: 'error', runtimeMs: Date.now() - t0, error: (msg && msg.error) || 'no result',
        }));
        finish({ language: 'python', results, fatalError: (msg && msg.error) || 'no result' });
        return;
      }
      const byIndex = new Map(msg.results.map((r) => [r.index, r]));
      const results = problem.tests.map((test, i) => {
        const r = byIndex.get(i);
        if (!r) return { index: i, status: 'error', runtimeMs: 0, error: 'missing result' };
        if (!r.ok) return { index: i, status: 'error', runtimeMs: r.runtimeMs, error: r.error };
        let pass = false;
        try {
          pass = compareResults(r.value, test.expected, problem).pass;
        } catch (e) {
          return { index: i, status: 'error', runtimeMs: r.runtimeMs, error: `compare failed: ${e.message}` };
        }
        return { index: i, status: pass ? 'pass' : 'fail', runtimeMs: r.runtimeMs, actual: r.value };
      });
      finish({ language: 'python', results });
    });
  });
}

// ---------------------------------------------------------------------------
// C++ — browsercc compile once, then one runner worker per test
// ---------------------------------------------------------------------------

let browserccCompile = null;
let fetchShimInstalled = false;

/** browsercc fetches sysroot.tar relative to its module URL (file:// in
 *  node) — node fetch does not speak file://, so shim it to disk reads. */
export function ensureBrowserccFetchShim() {
  if (fetchShimInstalled) return;
  fetchShimInstalled = true;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const href = String(url?.url ?? url);
    if (href.startsWith('file://')) {
      const buf = await readFile(new URL(href));
      return new Response(buf, { status: 200 });
    }
    return nativeFetch(url, opts);
  };
}

export async function ensureBrowsercc(distDir) {
  if (!browserccCompile) {
    ensureBrowserccFetchShim();
    const mod = await import(path.join(distDir, 'index.js'));
    browserccCompile = mod.compile;
  }
  return browserccCompile;
}

const CPP_NODE_PRELUDE = `
const { parentPort } = require('node:worker_threads');
const self = { postMessage: (m) => parentPort.postMessage(m) };
Object.defineProperty(self, 'onmessage', {
  configurable: true,
  set(f) { parentPort.on('message', (msg) => f({ data: msg })); },
});
`;

function runOneCppTest(problem, module, index, timeLimitMs) {
  return new Promise((resolve) => {
    const test = problem.tests[index];
    const t0 = Date.now();
    let done = false;
    const w = new Worker(CPP_NODE_PRELUDE + CPP_RUNNER_WORKER_SOURCE, { eval: true });
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      w.terminate().catch(() => {});
      resolve(r);
    };
    const timer = setTimeout(() => {
      finish({ index, status: 'tle', runtimeMs: Date.now() - t0, error: `C++ test timed out after ${timeLimitMs}ms` });
    }, timeLimitMs);
    w.once('error', (e) => finish({ index, status: 'error', runtimeMs: Date.now() - t0, error: `C++ worker error: ${e.message}` }));
    w.once('message', (msg) => {
      const runtimeMs = Date.now() - t0;
      if (!msg || !msg.ok) {
        finish({ index, status: 'error', runtimeMs, error: (msg && msg.error) || 'no result' });
        return;
      }
      if (msg.exitCode !== 0) {
        finish({ index, status: 'error', runtimeMs, error: `exit code ${msg.exitCode}${msg.stderr ? ' stderr: ' + String(msg.stderr).slice(0, 300) : ''}` });
        return;
      }
      const { result, error } = parseCppMarkers(msg.stdout || '');
      if (error && result === undefined) {
        finish({ index, status: 'error', runtimeMs, error });
        return;
      }
      let pass = false;
      try {
        pass = compareResults(result, test.expected, problem).pass;
      } catch (e) {
        finish({ index, status: 'error', runtimeMs, error: `compare failed: ${e.message}` });
        return;
      }
      finish({ index, status: pass ? 'pass' : 'fail', runtimeMs, actual: result });
    });
    w.postMessage({ module, stdinText: cppStdinForTest(test) + '\n' });
  });
}

export async function runCpp(
  problem,
  code,
  { timeLimitMs = 30000, distDir = process.env.BROWSERCC_DIST, compileTimeoutMs = 180000 } = {},
) {
  if (!distDir) {
    return {
      language: 'cpp',
      results: [],
      fatalError: 'BROWSERCC_DIST is not set — point it at the browsercc dist dir (clang.wasm, lld.wasm, sysroot.tar)',
    };
  }
  const compile = await ensureBrowsercc(distDir);
  const t0 = Date.now();
  let module = null;
  let compileOutput = '';
  try {
    const res = await Promise.race([
      compile({
        source: buildCppSource(problem, code),
        fileName: 'main.cpp',
        flags: CPP_FLAGS,
        extraFiles: { 'bits/stdc++.h': STDCPP_SHIM },
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('compile timeout')), compileTimeoutMs)),
    ]);
    module = res.module;
    compileOutput = res.compileOutput || '';
  } catch (e) {
    return { language: 'cpp', results: [], compileMs: Date.now() - t0, fatalError: `compile failed: ${e.message}` };
  }
  const compileMs = Date.now() - t0;
  if (!module) {
    const results = problem.tests.map((_, i) => ({
      index: i, status: 'error', runtimeMs: 0, error: `compile error: ${compileOutput.slice(0, 500)}`,
    }));
    return { language: 'cpp', results, compileMs, fatalError: `compile error: ${compileOutput.slice(0, 500)}` };
  }
  const results = [];
  for (let i = 0; i < problem.tests.length; i++) {
    results.push(await runOneCppTest(problem, module, i, timeLimitMs));
  }
  return { language: 'cpp', results, compileMs };
}

// ---------------------------------------------------------------------------
// Unified entry
// ---------------------------------------------------------------------------

const RUNNERS = { javascript: runJavaScript, python: runPython, cpp: runCpp };

/**
 * Run one solution in one language against all of a problem's tests.
 * @returns {Promise<{ language, results, compileMs?, fatalError? }>}
 */
export async function runSolution({ problem, language, code, timeLimitMs }) {
  const runner = RUNNERS[language];
  if (!runner) throw new Error(`unknown language: ${language}`);
  return runner(problem, code, { timeLimitMs });
}

/** True when every test passed. */
export function allPassed(run) {
  return run.results.length > 0 && run.results.every((r) => r.status === 'pass');
}
