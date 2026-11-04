/**
 * Milestone 5 — C++ in the browser (wasm-Clang toolchain via browsercc).
 *
 * Spec §4.8: candidate C++ compiles to WebAssembly with a real Clang/LLD and
 * runs under a WASI runtime, entirely in the visitor's browser. Plugs into
 * M4's runner architecture: the same 4 sample problems, the same `solve()`
 * convention, the same comparison modes and first-failing-case rule.
 *
 * Toolchain: browsercc v0.1.1 (MIT, by BertalanD — see ADR 006). NOTHING is
 * vendored into the repo or the JS bundle: the ~24 MB toolchain loads from
 * the jsDelivr CDN at runtime, lazily, only when the visitor picks C++. The
 * browser HTTP cache (immutable versioned URLs, `cache-control: immutable`)
 * makes the download happen once; the loader pre-fetches with a staged
 * progress bar so the compiler worker's own fetches hit the warm cache.
 * (Cache Storage was considered and rejected: browsercc's Emscripten glue
 * fetches via its own paths, which bypass Cache Storage — see ADR 006.)
 *
 * Two worker types (spec §4.8):
 *  - Compiler worker: a MODULE worker importing browsercc from the CDN.
 *    Takes candidate C++ + generated harness, returns a WebAssembly.Module
 *    (structured-cloned, not transferred — the main thread re-sends it to
 *    every runner worker). Compile flags: -std=c++17 -O2 -fno-exceptions.
 *  - Runner worker: a CLASSIC worker embedding our minimal WASI shim
 *    (wasi-shim.js, inlined via .toString() — Blob workers cannot import
 *    relative modules). One fresh worker per test; the COMPILED MODULE IS
 *    REUSED across tests, so a TLE terminates the runner but never
 *    recompiles (spec: "resume from the next test using the
 *    already-compiled module").
 *
 * Documented toolchain limits (ADR 006):
 *  - C++ exceptions are UNAVAILABLE (WASI). We compile with -fno-exceptions;
 *    candidate try/catch fails the compile with a clear compiler error.
 *  - Threads are unavailable (no pthreads in this build).
 *  - Stack: 8 MB (-Wl,-z,stack-size=8388608) — deep recursion is fine.
 *  - Wasm linear memory cap: 64 MB (-Wl,--max-memory=67108864).
 *  - bits/stdc++.h is OUR shim (harness.js STDCPP_SHIM), injected via
 *    browsercc extraFiles — the WASI sysroot does not ship it.
 */

import {
  STDCPP_SHIM,
  buildCppSource,
  cppStdinForTest,
  parseCppMarkers,
  compareResults,
  aggregateVerdict,
} from './harness.js';
import { createWasiShim } from './wasi-shim.js';

export const BROWSERCC_VERSION = '0.1.1';
export const BROWSERCC_CDN = `https://cdn.jsdelivr.net/npm/browsercc@${BROWSERCC_VERSION}/dist/`;

/**
 * Toolchain files fetched on first C++ use. Sizes measured 2026-11-04 from
 * the live CDN (compressed transfer sizes). Total ≈ 24.2 MB — the "tens of
 * MB, downloaded once" the owner approved (002-section-15-decisions.md).
 */
export const TOOLCHAIN_FILES = [
  { name: 'clang.wasm', bytes: 13918487 },
  { name: 'lld.wasm', bytes: 6325685 },
  { name: 'sysroot.tar', bytes: 3937042 },
  { name: 'index.js', bytes: 1529 },
  { name: 'clang.js', bytes: 18135 },
  { name: 'lld.js', bytes: 20669 },
];
export const TOOLCHAIN_BYTES = TOOLCHAIN_FILES.reduce((n, f) => n + f.bytes, 0);

/** Flags for every candidate compile. See the module docstring for why. */
export const CPP_FLAGS = [
  '-std=c++17',
  '-O2',
  '-fno-exceptions',
  '-I.',
  '-I/',
  '-Wl,-z,stack-size=8388608',
  '-Wl,--max-memory=67108864',
];

/** Generous watchdog for one compile (cold compile ≈ 10–16 s measured). */
export const COMPILE_TIMEOUT_MS = 180000;
/** Per-test captured stdout cap inside the runner worker (1 MB). */
export const RUNNER_CAPTURE_CAP = 1048576;
/** Max serialized result size, mirroring M4's 256 KB guard. */
export const MAX_RESULT_BYTES = 262144;

export class CppToolchainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CppToolchainError';
    this.retryable = true;
  }
}

export class CppCompileError extends Error {
  constructor(compilerOutput) {
    super(
      'C++ compilation failed.\n\n' +
        'Note: C++ exceptions (try/catch/throw) are not supported in the browser build — ' +
        'remove them and try again. Do not define your own main().\n\n' +
        'Compiler output:\n' +
        String(compilerOutput || '(no output)').slice(0, 4000)
    );
    this.name = 'CppCompileError';
    this.compilerOutput = compilerOutput;
  }
}

/** Honest fallback when the toolchain cannot load (spec §4.8: no hosted executor in v1). */
export const CPP_UNAVAILABLE_MESSAGE =
  'C++ is not available on this device right now — the in-browser C++ compiler ' +
  '(a ~24 MB one-time download) failed to load, or the device ran out of memory. ' +
  'JavaScript and Python run the same problems and work everywhere.';

// ---------------------------------------------------------------------------
// Toolchain loader: lazy, staged progress, retryable.
// ---------------------------------------------------------------------------

let toolchainStatus = 'idle'; // idle | loading | ready | error
let toolchainError = null;
let toolchainPromise = null;

export function getCppToolchainStatus() {
  return { status: toolchainStatus, error: toolchainError };
}

function mb(n) {
  return (n / 1048576).toFixed(1);
}

/**
 * Ensure the toolchain files are in the browser HTTP cache. Resolves when
 * ready; throws CppToolchainError (retryable) on failure. Concurrent callers
 * share one download; after an error the next call retries from scratch.
 */
export function ensureCppToolchain(onProgress) {
  if (toolchainStatus === 'ready') return Promise.resolve();
  if (toolchainStatus === 'loading') return toolchainPromise;
  // After an error, allow a retry.
  toolchainStatus = 'loading';
  toolchainError = null;
  toolchainPromise = (async () => {
    try {
      let done = 0;
      for (const f of TOOLCHAIN_FILES) {
        const label = `Downloading C++ toolchain… ${mb(done)} / ${mb(TOOLCHAIN_BYTES)} MB`;
        onProgress?.('toolchain', label, done / TOOLCHAIN_BYTES);
        let res;
        try {
          res = await fetch(BROWSERCC_CDN + f.name);
        } catch (e) {
          throw new Error(`network error fetching ${f.name}: ${(e && e.message) || e}`);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${f.name}`);
        // Consume the body so it lands in the HTTP cache; chunks are
        // discarded as we go (no 24 MB retained in JS memory).
        if (res.body && typeof res.body.getReader === 'function') {
          const reader = res.body.getReader();
          for (;;) {
            const { done: d, value } = await reader.read();
            if (d) break;
            done += value.byteLength || value.length || 0;
            onProgress?.(
              'toolchain',
              `Downloading C++ toolchain… ${mb(done)} / ${mb(TOOLCHAIN_BYTES)} MB`,
              done / TOOLCHAIN_BYTES
            );
          }
        } else {
          await res.arrayBuffer();
          done += f.bytes;
        }
      }
      onProgress?.('toolchain', 'C++ toolchain ready.', 1);
      toolchainStatus = 'ready';
    } catch (err) {
      toolchainStatus = 'error';
      toolchainError = err;
      throw new CppToolchainError(
        `Could not download the C++ toolchain (${(err && err.message) || err}). ` +
          'Check your connection and retry — or use JavaScript/Python for the same problems.'
      );
    }
  })();
  return toolchainPromise;
}

/** Test-only: reset the toolchain loader state (lets tests stub fetch deterministically). */
export function _resetCppToolchainForTests() {
  toolchainStatus = 'idle';
  toolchainError = null;
  toolchainPromise = null;
}

/** M8 hook: start the toolchain download while the candidate explains their approach. */
export function prewarmCppToolchain() {
  ensureCppToolchain().catch(() => {
    /* surfaces honestly when C++ is actually picked */
  });
}

// ---------------------------------------------------------------------------
// Worker sources. Built as strings → Blob URLs so the toolchain never lands
// in the app bundle. The compiler worker MUST be a module worker (it imports
// browsercc from the CDN); the runner worker is classic and embeds the WASI
// shim via .toString() (wasi-shim.js documents this constraint).
// ---------------------------------------------------------------------------

const CPP_COMPILER_WORKER_SOURCE = `
'use strict';
const CDN = ${JSON.stringify(BROWSERCC_CDN)};
const STDCPP_SHIM = ${JSON.stringify(STDCPP_SHIM)};
const FLAGS = ${JSON.stringify(CPP_FLAGS)};
let compileFn = null;
self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (!compileFn) {
      const mod = await import(CDN + 'index.js');
      compileFn = mod.compile;
    }
    const res = await compileFn({
      source: msg.source,
      fileName: 'main.cpp',
      flags: FLAGS,
      extraFiles: { 'bits/stdc++.h': STDCPP_SHIM },
    });
    if (!res.module) {
      self.postMessage({ id: msg.id, ok: false, error: res.compileOutput || 'Compilation failed with no output.' });
      return;
    }
    // Structured clone (NOT transfer): the main thread re-sends the module
    // to every per-test runner worker.
    self.postMessage({ id: msg.id, ok: true, module: res.module });
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: 'Compiler worker failed: ' + ((err && err.message) || String(err)) });
  }
};
`;

const CPP_RUNNER_WORKER_SOURCE = `
'use strict';
var createWasiShim = (${createWasiShim.toString()});
var CAPTURE_CAP = ${RUNNER_CAPTURE_CAP};
self.onmessage = async function (e) {
  var d = e.data || {};
  var stdoutChunks = [];
  var stderrChunks = [];
  var captured = 0;
  var truncated = false;
  function push(arr, chunk) {
    if (truncated) return;
    if (captured + chunk.length > CAPTURE_CAP) {
      var room = CAPTURE_CAP - captured;
      if (room > 0) { arr.push(chunk.slice(0, room)); captured += room; }
      truncated = true;
      return;
    }
    arr.push(chunk);
    captured += chunk.length;
  }
  function decode(arr) {
    var total = 0;
    for (var i = 0; i < arr.length; i++) total += arr[i].length;
    var out = new Uint8Array(total);
    var o = 0;
    for (var j = 0; j < arr.length; j++) { out.set(arr[j], o); o += arr[j].length; }
    return new TextDecoder().decode(out);
  }
  var shim = createWasiShim({
    stdinBytes: new TextEncoder().encode(d.stdinText || ''),
    onStdout: function (c) { push(stdoutChunks, c); },
    onStderr: function (c) { push(stderrChunks, c); },
  });
  try {
    var instance = await WebAssembly.instantiate(d.module, {
      wasi_snapshot_preview1: shim.wasiImport,
    });
    var mem = instance.exports && instance.exports.memory;
    if (!mem) throw new Error('Compiled module did not export its linear memory.');
    shim.setMemory(mem);
    var start = instance.exports._start;
    if (typeof start !== 'function') throw new Error('Compiled module did not export _start.');
    try {
      start();
    } catch (err) {
      // proc_exit() unwinds via this marker; anything else is a real crash.
      if (!err || err.__wasiExit !== true) throw err;
    }
    self.postMessage({
      ok: true,
      exitCode: shim.getExitCode(),
      stdout: decode(stdoutChunks),
      stderr: decode(stderrChunks),
      truncated: truncated,
    });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
`;

// Exported for structural tests (source must contain the shim + markers).
export { CPP_COMPILER_WORKER_SOURCE, CPP_RUNNER_WORKER_SOURCE };

// ---------------------------------------------------------------------------
// Browser worker factories (mirror M4's createBrowserJsWorker).
// ---------------------------------------------------------------------------

function makeWorkerAdapter(w, url) {
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
      try {
        w.terminate();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  };
}

export function createBrowserCppCompilerWorker() {
  const url = URL.createObjectURL(new Blob([CPP_COMPILER_WORKER_SOURCE], { type: 'text/javascript' }));
  const w = new Worker(url, { type: 'module' });
  return makeWorkerAdapter(w, url);
}

export function createBrowserCppRunnerWorker() {
  const url = URL.createObjectURL(new Blob([CPP_RUNNER_WORKER_SOURCE], { type: 'text/javascript' }));
  const w = new Worker(url);
  return makeWorkerAdapter(w, url);
}

// ---------------------------------------------------------------------------
// CppSession: compile once, run each test in a fresh runner worker with a
// hard per-test timeout. TLE terminates the runner; the already-compiled
// module is reused for the next test — never recompiled (spec §4.8).
// ---------------------------------------------------------------------------

export class CppSession {
  constructor({ code, problem, createCompilerWorker, createRunnerWorker, onProgress }) {
    this.code = code;
    this.problem = problem;
    this.createCompilerWorker = createCompilerWorker;
    this.createRunnerWorker = createRunnerWorker;
    this.onProgress = onProgress;
    this.module = null;
    this.compilePromise = null;
  }

  ensureCompiled() {
    if (this.module) return Promise.resolve(this.module);
    if (!this.compilePromise) this.compilePromise = this._compile();
    return this.compilePromise;
  }

  async _compile() {
    await ensureCppToolchain((stage, text, frac) => this.onProgress?.(stage, text, frac));
    this.onProgress?.('compile', 'Compiling your C++… (about 10–15 s on first run)');
    const worker = this.createCompilerWorker();
    let timer;
    try {
      const resultPromise = worker.onceResult();
      worker.post({ id: 1, source: buildCppSource(this.problem, this.code) });
      const watchdog = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ __compileTimeout: true }), COMPILE_TIMEOUT_MS);
      });
      const outcome = await Promise.race([resultPromise, watchdog]);
      if (outcome && outcome.__compileTimeout) {
        throw new CppToolchainError(
          'The C++ compiler timed out — this device may be too slow to compile C++ in the browser. ' +
            'JavaScript and Python run the same problems.'
        );
      }
      if (!outcome.ok) throw new CppCompileError(outcome.error);
      if (!outcome.module) throw new CppCompileError('(compiler returned no module and no output)');
      this.module = outcome.module;
      this.onProgress?.('compile', 'Compiled. Running tests…');
      return this.module;
    } finally {
      clearTimeout(timer);
      try {
        await worker.terminate();
      } catch {
        /* already gone */
      }
    }
  }

  async runTest({ test, index, timeLimitMs }) {
    await this.ensureCompiled();
    const worker = this.createRunnerWorker();
    const started = Date.now();
    let timer;
    try {
      const resultPromise = worker.onceResult();
      // Structured clone of the already-compiled module — no recompile.
      worker.post({ module: this.module, stdinText: cppStdinForTest(test) + '\n' });
      const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ __timeout: true }), timeLimitMs);
      });
      const outcome = await Promise.race([resultPromise, timeoutPromise]);
      clearTimeout(timer);

      if (outcome && outcome.__timeout) {
        return {
          index,
          status: 'tle',
          runtimeMs: timeLimitMs,
          error:
            `Time limit exceeded (${timeLimitMs} ms) — the runner was terminated. ` +
            'The already-compiled module is reused for the next test (no recompile).',
        };
      }
      const runtimeMs = Date.now() - started;
      if (!outcome.ok) {
        return { index, status: 'error', runtimeMs, error: outcome.error || 'Unknown C++ runtime error' };
      }
      if (outcome.exitCode !== 0) {
        const stderr = outcome.stderr ? ` stderr: ${String(outcome.stderr).slice(0, 500)}` : '';
        return { index, status: 'error', runtimeMs, error: `Program exited with code ${outcome.exitCode}.${stderr}` };
      }
      const { result, error } = parseCppMarkers(outcome.stdout);
      if (error && result === undefined) {
        return { index, status: 'error', runtimeMs, error };
      }
      let size = 0;
      try {
        size = JSON.stringify(result)?.length ?? 0;
      } catch {
        return { index, status: 'error', runtimeMs, error: 'Result could not be serialized.' };
      }
      if (size > MAX_RESULT_BYTES) {
        return { index, status: 'error', runtimeMs, error: 'Output too large (over 256 KB).' };
      }
      const { pass } = compareResults(result, test.expected, this.problem);
      if (pass) return { index, status: 'pass', runtimeMs };
      return { index, status: 'fail', runtimeMs, actual: result, expected: test.expected };
    } finally {
      clearTimeout(timer);
      try {
        await worker.terminate();
      } catch {
        /* already terminated */
      }
    }
  }

  async dispose() {
    this.module = null;
    this.compilePromise = null;
  }
}

/**
 * Run all tests for a C++ submission. Compile errors throw CppCompileError
 * (surfaced in the UI with the compiler output); toolchain failures throw
 * CppToolchainError (retryable, with the honest fallback message).
 */
export async function runCppTests({
  code,
  problem,
  timeLimitMs,
  createCompilerWorker,
  createRunnerWorker,
  onProgress,
  onTestDone,
}) {
  // C++ under wasm runs near native speed — no multiplier (M4: JS×1, Py×3).
  const limit = timeLimitMs || Math.round(problem.timeLimitMs || 2000);
  const session = new CppSession({ code, problem, createCompilerWorker, createRunnerWorker, onProgress });
  const results = [];
  try {
    for (let i = 0; i < problem.tests.length; i++) {
      const r = await session.runTest({ test: problem.tests[i], index: i, timeLimitMs: limit });
      results.push(r);
      if (onTestDone) onTestDone(r, i);
    }
  } finally {
    await session.dispose();
  }
  return { ...aggregateVerdict(results), results, timeLimitMs: limit };
}
