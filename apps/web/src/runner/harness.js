/**
 * Milestone 4 — test harness core (framework-agnostic, no DOM, no Vite
 * specifics). Everything here is importable from node tests AND the browser
 * bundle.
 *
 * Conventions (spec §4.8):
 * - The candidate defines `solve(...)`; the harness calls it per test case
 *   with the problem's JSON args and compares the canonicalised output.
 * - Comparison modes: 'exact' | 'float' (tolerance) | 'unordered' (arrays).
 * - Only the first failing *visible* test reveals input/expected/got;
 *   hidden test inputs are never displayed.
 */

/** Normalise a value for comparison: -0 → 0, objects get sorted keys. */
export function canonicalize(value) {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { $nan: true };
    return value === 0 ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
    return out;
  }
  return value;
}

function numbersClose(a, b, tol) {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  return Math.abs(a - b) <= tol;
}

function deepEqual(a, b) {
  const ca = canonicalize(a);
  const cb = canonicalize(b);
  if (typeof ca !== typeof cb) return false;
  if (ca !== null && typeof ca === 'object' && !(ca.$nan || cb.$nan)) {
    if (Array.isArray(ca) !== Array.isArray(cb)) return false;
    if (Array.isArray(ca)) {
      if (ca.length !== cb.length) return false;
      return ca.every((v, i) => deepEqual(v, cb[i]));
    }
    if (ca.$nan || cb.$nan) return Boolean(ca.$nan) === Boolean(cb.$nan);
    const ka = Object.keys(ca);
    const kb = Object.keys(cb);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(ca[k], cb[k]));
  }
  if (ca && ca.$nan) return Boolean(cb && cb.$nan);
  return ca === cb;
}

function deepFloatEqual(a, b, tol) {
  const ca = canonicalize(a);
  const cb = canonicalize(b);
  if (typeof ca === 'number' && typeof cb === 'number') return numbersClose(ca, cb, tol);
  if (Array.isArray(ca) && Array.isArray(cb)) {
    if (ca.length !== cb.length) return false;
    return ca.every((v, i) => deepFloatEqual(v, cb[i], tol));
  }
  if (ca !== null && typeof ca === 'object' && cb !== null && typeof cb === 'object') {
    const ka = Object.keys(ca);
    const kb = Object.keys(cb);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepFloatEqual(ca[k], cb[k], tol));
  }
  return ca === cb;
}

/**
 * Compare a candidate's actual output against the expected value.
 * Returns { pass: boolean }.
 */
export function compareResults(actual, expected, problem) {
  const mode = problem.comparison || 'exact';
  if (mode === 'float') {
    return { pass: deepFloatEqual(actual, expected, problem.floatTolerance ?? 1e-6) };
  }
  if (mode === 'unordered') {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return { pass: false };
    const key = (v) => JSON.stringify(canonicalize(v));
    const a = [...actual].sort((x, y) => (key(x) < key(y) ? -1 : 1));
    const b = [...expected].sort((x, y) => (key(x) < key(y) ? -1 : 1));
    return { pass: deepEqual(a, b) };
  }
  return { pass: deepEqual(actual, expected) };
}

/**
 * Aggregate per-test results into an overall verdict.
 * Each result: { index, status: 'pass'|'fail'|'error'|'tle', runtimeMs, ... }
 */
export function aggregateVerdict(results) {
  const total = results.length;
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const tles = results.filter((r) => r.status === 'tle').length;
  const allPass = total > 0 && passed === total;
  const verdict = allPass ? 'all-pass' : tles > 0 ? 'tle' : errors > 0 ? 'error' : 'failed';
  return { total, passed, failed, errors, tles, allPass, verdict };
}

/**
 * First-failure rule (spec §4.6): reveal input/expected/got for the first
 * failing *visible* test only. Hidden test inputs are never displayed.
 * Returns null (no failure), { hidden: true, index } (first failure is hidden),
 * or { hidden: false, index, test, result } (visible failure with details).
 */
export function firstVisibleFailure(results, problem) {
  for (const r of results) {
    if (r.status === 'pass') continue;
    const test = problem.tests[r.index];
    if (test && test.hidden) return { hidden: true, index: r.index, status: r.status };
    return { hidden: false, index: r.index, status: r.status, test, result: r };
  }
  return null;
}

/**
 * Locked-editor state (spec §4.6): Monaco readOnly + a clear overlay while
 * locked. Pure function so the state mapping is unit-testable; the React
 * component renders from it.
 */
export function getEditorLockState({ locked }) {
  if (locked) {
    return {
      readOnly: true,
      overlay: true,
      overlayText: 'Explain your approach to unlock',
      overlaySubtext: 'The editor unlocks once your approach is accepted. (Demo: use the unlock toggle below.)',
    };
  }
  return { readOnly: false, overlay: false, overlayText: null, overlaySubtext: null };
}

/**
 * JavaScript worker source. Environment-agnostic: runs in a browser Web
 * Worker AND in node worker_threads with { eval: true } (same code path —
 * node tests exercise exactly what the browser runs).
 *
 * Protocol in:  { code, fnName, args }
 * Protocol out: { ok: true, value } | { ok: false, error }
 */
export const JS_WORKER_SOURCE = `'use strict';
var __send = function (msg) {
  if (typeof postMessage === 'function') { postMessage(msg); return; }
  try {
    var wt = require('worker_threads');
    wt.parentPort.postMessage(msg);
  } catch (e) { /* no transport available */ }
};
var __onMessage = function (fn) {
  if (typeof self !== 'undefined' && self.addEventListener) {
    self.addEventListener('message', function (e) { fn(e.data); });
  } else {
    try {
      require('worker_threads').parentPort.on('message', fn);
    } catch (e) { /* no transport available */ }
  }
};
__onMessage(function (msg) {
  var code = msg.code, fnName = msg.fnName, args = msg.args;
  var done = function (out) {
    try { __send(out); }
    catch (e) { __send({ ok: false, error: 'Result could not be transferred (unserializable value).' }); }
  };
  var factory;
  try {
    factory = new Function('"use strict";\\n' + code + '\\n;return (typeof ' + fnName + " === 'function') ? " + fnName + ' : null;');
  } catch (e) {
    done({ ok: false, error: 'Syntax error: ' + (e && e.message ? e.message : e) });
    return;
  }
  var fn;
  try { fn = factory(); }
  catch (e) { done({ ok: false, error: String((e && e.message) || e) }); return; }
  if (!fn) { done({ ok: false, error: 'Function "' + fnName + '" is not defined. Your code must define ' + fnName + '(...).' }); return; }
  var result;
  try { result = fn.apply(null, args); }
  catch (e) { done({ ok: false, error: String((e && e.message) || e) }); return; }
  if (result && typeof result.then === 'function') {
    result.then(function (v) { done({ ok: true, value: v }); },
               function (e) { done({ ok: false, error: String((e && e.message) || e) }); });
  } else {
    done({ ok: true, value: result });
  }
});
`;

/**
 * Build the Python harness source for one test case. The worker sets the
 * globals __user_code (candidate source) and __args_json before exec'ing
 * this. The last expression evaluates to a JSON string of the result.
 */
export function buildPythonHarness() {
  return [
    'import json as __json',
    'exec(__user_code, globals())',
    '__call_args = __json.loads(__args_json)',
    'if not callable(globals().get("solve")):',
    '    raise NameError(\'Function "solve" is not defined. Your code must define solve(...).\')',
    '__call_res = solve(*__call_args)',
    '__json.dumps(__call_res, default=str)',
  ].join('\n');
}

/** Short human label for a per-test status. */
export function statusLabel(status) {
  switch (status) {
    case 'pass': return 'Passed';
    case 'fail': return 'Failed';
    case 'error': return 'Error';
    case 'tle': return 'Time limit exceeded';
    default: return status;
  }
}
