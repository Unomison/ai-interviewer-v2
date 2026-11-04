/**
 * Milestone 4 — Pyodide (Python/WASM) loading and the Python worker.
 *
 * Spec §4.8: Python runs through Pyodide, loaded lazily ONLY when the
 * visitor picks Python, with a visible progress indicator. Everything runs
 * inside a Web Worker — the main thread never executes candidate code.
 * If the CDN load fails, the UI shows a clear retryable error.
 */

import { buildPythonHarness } from './harness.js';

/** Pinned Pyodide release (see ADR 005 for why this version). */
export const PYODIDE_VERSION = '0.27.7';
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/**
 * Python worker source. A classic worker (importScripts) that:
 *  1. on {type:'init'} → loads Pyodide from the CDN (progress posted),
 *     then posts {type:'ready'};
 *  2. on {type:'run', id, code, args} → execs the candidate code, calls
 *     solve(*args), and posts {type:'result', id, ok, value|error}.
 *
 * The executor terminates this worker on per-test timeout (TLE).
 */
export const PYTHON_WORKER_SOURCE = `'use strict';
var PYODIDE_INDEX_URL = ${JSON.stringify(PYODIDE_CDN)};
var __pyodide = null;
var __readyPromise = null;

function __progress(stage, text) {
  try { postMessage({ type: 'progress', stage: stage, text: text }); } catch (e) {}
}

function __ensureReady() {
  if (!__readyPromise) {
    __readyPromise = (async function () {
      __progress('downloading', 'Downloading the Python runtime (~15 MB, first time only)…');
      importScripts(PYODIDE_INDEX_URL + 'pyodide.js');
      __progress('loading', 'Starting the Python runtime…');
      __pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });
      postMessage({ type: 'ready' });
    })().catch(function (err) {
      __readyPromise = null;
      postMessage({ type: 'init-error', error: 'Could not load the Python runtime: ' + (err && err.message ? err.message : err) + '. Check your connection and retry.' });
      throw err;
    });
  }
  return __readyPromise;
}

var HARNESS = ${JSON.stringify(buildPythonHarness())};

self.addEventListener('message', function (e) {
  var msg = e.data || {};
  if (msg.type === 'init') { __ensureReady(); return; }
  if (msg.type !== 'run') return;
  var id = msg.id;
  __ensureReady().then(function () {
    var out;
    try {
      __pyodide.globals.set('__user_code', msg.code);
      __pyodide.globals.set('__args_json', JSON.stringify(msg.args));
      out = __pyodide.runPython(HARNESS);
      var value = JSON.parse(out);
      postMessage({ type: 'result', id: id, ok: true, value: value });
    } catch (err) {
      var text = String((err && err.message) || err);
      // Pyodide wraps Python tracebacks; keep the last line (the actual error).
      var lines = text.split('\\n').filter(function (l) { return l.trim().length > 0; });
      postMessage({ type: 'result', id: id, ok: false, error: lines.length ? lines[lines.length - 1] : text });
    }
  }).catch(function () { /* init-error already posted */ });
});
`;

/**
 * Browser factory for the Python worker, matching the adapter interface the
 * executor's PythonSession expects:
 *   { post, onceResult, terminate, whenReady, messageForTest }
 * `onProgress(stage, text)` receives 'downloading' | 'loading' updates.
 */
export function createPythonWorker(onProgress) {
  const url = URL.createObjectURL(new Blob([PYTHON_WORKER_SOURCE], { type: 'text/javascript' }));
  const w = new Worker(url);
  let readyResolve;
  let readyReject;
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // Tests run strictly sequentially, so results are a simple FIFO queue.
  const resultWaiters = [];

  w.onmessage = (e) => {
    const msg = e.data || {};
    if (msg.type === 'ready') readyResolve();
    else if (msg.type === 'init-error') readyReject(new Error(msg.error));
    else if (msg.type === 'progress') onProgress?.(msg.stage, msg.text);
    else if (msg.type === 'result') {
      const next = resultWaiters.shift();
      if (next) next(msg);
    }
  };
  w.onerror = (e) => {
    const err = new Error(`Python worker error: ${(e && e.message) || 'unknown'}`);
    readyReject(err);
    let next;
    while ((next = resultWaiters.shift())) next({ ok: false, error: err.message });
  };

  let seq = 0;
  return {
    post: (msg) => w.postMessage(msg),
    whenReady: () => {
      w.postMessage({ type: 'init' });
      return readyPromise;
    },
    onceResult: () => new Promise((resolve) => resultWaiters.push(resolve)),
    messageForTest: ({ code, test }) => ({ type: 'run', id: `t${seq++}`, code, args: test.args }),
    terminate: () => {
      w.terminate();
      URL.revokeObjectURL(url);
      let next;
      while ((next = resultWaiters.shift())) next({ ok: false, error: 'Worker terminated.' });
    },
  };
}
