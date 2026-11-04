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

// ---------------------------------------------------------------------------
// Milestone 5 — C++ harness generation.
//
// The browsercc WASI sysroot does not ship bits/stdc++.h, but many DSA
// candidates write `#include <bits/stdc++.h>`. We inject our own shim via
// browsercc's `extraFiles` (compiled with `-I.`), so no extra download is
// needed. The shim intentionally covers the headers DSA solutions use — it
// is not a byte-identical copy of libstdc++'s mega-header.
// ---------------------------------------------------------------------------

/** Contents of the injected `bits/stdc++.h` shim (passed as an extraFile). */
export const STDCPP_SHIM = `#pragma once
// bits/stdc++.h shim for the ai-interviewer browser runner (Milestone 5).
// The wasm-Clang WASI sysroot does not ship this header; this shim pulls in
// the standard headers DSA solutions commonly need.
#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
#include <map>
#include <set>
#include <unordered_map>
#include <unordered_set>
#include <queue>
#include <stack>
#include <deque>
#include <list>
#include <array>
#include <cmath>
#include <climits>
#include <cstdint>
#include <limits>
#include <numeric>
#include <functional>
#include <utility>
#include <sstream>
#include <iomanip>
#include <chrono>
#include <cctype>
#include <bitset>
#include <tuple>
`;

/**
 * v1 type -> C++ declaration / harness converter / harness printer.
 * Mirrors the problem-spec types (spec §4.8): int, float, bool, string and
 * 1D/2D arrays of those. `int` is 32-bit (LeetCode convention).
 */
export const CPP_TYPES = {
  int: { decl: 'int', conv: 'as_int' },
  float: { decl: 'double', conv: 'as_double' },
  bool: { decl: 'bool', conv: 'as_bool' },
  string: { decl: 'std::string', conv: 'as_str' },
  'int[]': { decl: 'std::vector<int>', conv: 'as_vec_int' },
  'float[]': { decl: 'std::vector<double>', conv: 'as_vec_double' },
  'bool[]': { decl: 'std::vector<bool>', conv: 'as_vec_bool' },
  'string[]': { decl: 'std::vector<std::string>', conv: 'as_vec_string' },
  'int[][]': { decl: 'std::vector<std::vector<int>>', conv: 'as_vec_vec_int' },
  'float[][]': { decl: 'std::vector<std::vector<double>>', conv: 'as_vec_vec_double' },
};

/**
 * Generate the C++ test-harness source for a problem (spec §4.8): reads one
 * JSON-encoded test per stdin line, prints `@@TEST i`, calls the
 * candidate's global `solve(...)`, prints the result as canonical JSON
 * (`@@RESULT ...`) plus per-test time (`@@TIME ...ms`). Malformed input
 * yields `@@ERROR` — the harness never throws (exceptions are unavailable
 * under WASI; see ADR 006).
 *
 * The candidate's code is prepended by buildCppSource(); it must define
 * `solve(...)` at global scope and must NOT define `main` (duplicate mains
 * fail the link with a clear compiler error).
 */
export function buildCppHarness(problem) {
  const convLines = problem.params
    .map((p, i) => {
      const t = CPP_TYPES[p.type];
      if (!t) throw new Error(`Unsupported C++ param type: ${p.type}`);
      return `        ${t.decl} __h_a${i} = cppharness::${t.conv}(argv.a[${i}]);`;
    })
    .join('\n');
  const callArgs = problem.params.map((_, i) => `__h_a${i}`).join(', ');
  const rtype = CPP_TYPES[problem.returnType];
  if (!rtype) throw new Error(`Unsupported C++ return type: ${problem.returnType}`);

  return `// ================= generated C++ test harness (do not edit) =================
namespace cppharness {

struct JVal {
    enum class T { Null, Bool, Int, Double, Str, Arr };
    T type = T::Null;
    bool b = false;
    long long i = 0;
    double d = 0.0;
    std::string s;
    std::vector<JVal> a;
};

// Minimal JSON parser for the v1 wire types. Defensive: never throws,
// reports failure via okOut (WASI builds have no exceptions).
struct Parser {
    const std::string& src;
    size_t pos = 0;
    bool ok = true;
    explicit Parser(const std::string& s) : src(s) {}
    void ws() {
        while (pos < src.size()) {
            char c = src[pos];
            if (c == ' ' || c == '\\t' || c == '\\n' || c == '\\r') pos++;
            else break;
        }
    }
    JVal parseValue() {
        ws();
        JVal v;
        if (pos >= src.size()) { ok = false; return v; }
        char c = src[pos];
        if (c == '[') {
            pos++;
            v.type = JVal::T::Arr;
            ws();
            if (pos < src.size() && src[pos] == ']') { pos++; return v; }
            while (true) {
                v.a.push_back(parseValue());
                if (!ok) return v;
                ws();
                if (pos < src.size() && src[pos] == ',') { pos++; continue; }
                break;
            }
            ws();
            if (pos >= src.size() || src[pos] != ']') { ok = false; return v; }
            pos++;
            return v;
        }
        if (c == '"') { v.type = JVal::T::Str; v.s = parseString(); return v; }
        if (c == 't' && src.compare(pos, 4, "true") == 0) { pos += 4; v.type = JVal::T::Bool; v.b = true; return v; }
        if (c == 'f' && src.compare(pos, 5, "false") == 0) { pos += 5; v.type = JVal::T::Bool; v.b = false; return v; }
        if (c == 'n' && src.compare(pos, 4, "null") == 0) { pos += 4; v.type = JVal::T::Null; return v; }
        size_t start = pos;
        if (c == '-') pos++;
        while (pos < src.size() && src[pos] >= '0' && src[pos] <= '9') pos++;
        bool isDbl = false;
        if (pos < src.size() && src[pos] == '.') {
            isDbl = true; pos++;
            while (pos < src.size() && src[pos] >= '0' && src[pos] <= '9') pos++;
        }
        if (pos < src.size() && (src[pos] == 'e' || src[pos] == 'E')) {
            isDbl = true; pos++;
            if (pos < src.size() && (src[pos] == '+' || src[pos] == '-')) pos++;
            while (pos < src.size() && src[pos] >= '0' && src[pos] <= '9') pos++;
        }
        std::string num = src.substr(start, pos - start);
        if (num.empty() || num == "-") { ok = false; return v; }
        if (isDbl) { v.type = JVal::T::Double; v.d = strtod(num.c_str(), nullptr); }
        else { v.type = JVal::T::Int; v.i = strtoll(num.c_str(), nullptr, 10); }
        return v;
    }
    std::string parseString() {
        std::string out;
        pos++; // opening quote
        while (pos < src.size()) {
            char c = src[pos++];
            if (c == '"') break;
            if (c == '\\\\' && pos < src.size()) {
                char e = src[pos++];
                if (e == 'n') out += '\\n';
                else if (e == 't') out += '\\t';
                else if (e == 'r') out += '\\r';
                else out += e;
            } else {
                out += c;
            }
        }
        return out;
    }
};

inline JVal parseJson(const std::string& s, bool& okOut) {
    Parser p(s);
    JVal v = p.parseValue();
    p.ws();
    okOut = p.ok && p.pos == s.size();
    return v;
}

// ---- converters: JSON value -> concrete C++ type ----
inline int as_int(const JVal& v) { return (int)v.i; }
inline double as_double(const JVal& v) { return v.type == JVal::T::Double ? v.d : (double)v.i; }
inline bool as_bool(const JVal& v) { return v.b; }
inline std::string as_str(const JVal& v) { return v.s; }
inline std::vector<int> as_vec_int(const JVal& v) {
    std::vector<int> o; o.reserve(v.a.size());
    for (const auto& e : v.a) o.push_back((int)e.i);
    return o;
}
inline std::vector<double> as_vec_double(const JVal& v) {
    std::vector<double> o; o.reserve(v.a.size());
    for (const auto& e : v.a) o.push_back(e.type == JVal::T::Double ? e.d : (double)e.i);
    return o;
}
inline std::vector<bool> as_vec_bool(const JVal& v) {
    std::vector<bool> o; o.reserve(v.a.size());
    for (const auto& e : v.a) o.push_back(e.b);
    return o;
}
inline std::vector<std::string> as_vec_string(const JVal& v) {
    std::vector<std::string> o; o.reserve(v.a.size());
    for (const auto& e : v.a) o.push_back(e.s);
    return o;
}
inline std::vector<std::vector<int>> as_vec_vec_int(const JVal& v) {
    std::vector<std::vector<int>> o; o.reserve(v.a.size());
    for (const auto& e : v.a) o.push_back(as_vec_int(e));
    return o;
}
inline std::vector<std::vector<double>> as_vec_vec_double(const JVal& v) {
    std::vector<std::vector<double>> o; o.reserve(v.a.size());
    for (const auto& e : v.a) o.push_back(as_vec_double(e));
    return o;
}

// ---- canonical printers: C++ value -> JSON text ----
inline std::string print(int v) { return std::to_string(v); }
inline std::string print(double v) {
    std::ostringstream o;
    o << std::setprecision(17) << v;
    return o.str();
}
inline std::string print(bool v) { return v ? "true" : "false"; }
inline std::string print(const std::string& v) {
    std::string o = "\\"";
    for (char c : v) {
        if (c == '"') o += "\\\\\\"";
        else if (c == '\\\\') o += "\\\\\\\\";
        else if (c == '\\n') o += "\\\\n";
        else if (c == '\\t') o += "\\\\t";
        else if (c == '\\r') o += "\\\\r";
        else o += c;
    }
    o += "\\"";
    return o;
}
template <typename T>
std::string print(const std::vector<T>& v) {
    std::string o = "[";
    for (size_t k = 0; k < v.size(); k++) {
        if (k) o += ",";
        o += print(v[k]);
    }
    o += "]";
    return o;
}
inline std::string print(const std::vector<bool>& v) {
    std::string o = "[";
    for (size_t k = 0; k < v.size(); k++) {
        if (k) o += ",";
        o += v[k] ? "true" : "false";
    }
    o += "]";
    return o;
}

} // namespace cppharness

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);
    std::string line;
    int idx = 0;
    // One JSON-encoded test per stdin line; the browser feeds tests and
    // compares results. EOF ends the run.
    while (std::getline(std::cin, line)) {
        std::cout << "@@TEST " << idx << "\\n" << std::flush;
        bool ok = false;
        cppharness::JVal argv = cppharness::parseJson(line, ok);
        if (!ok || argv.type != cppharness::JVal::T::Arr ||
            argv.a.size() != ${problem.params.length}) {
            std::cout << "@@ERROR bad test input\\n" << std::flush;
            idx++;
            continue;
        }
        auto t0 = std::chrono::steady_clock::now();
${convLines}
        ${rtype.decl} __h_r = ::solve(${callArgs});
        std::string __h_result = cppharness::print(__h_r);
        auto t1 = std::chrono::steady_clock::now();
        std::cout << "@@RESULT " << __h_result << "\\n";
        std::cout << "@@TIME "
                  << std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count()
                  << "\\n" << std::flush;
        idx++;
    }
    return 0;
}
`;
}

/**
 * Assemble the complete C++ translation unit: shim include, the
 * candidate's code (must define `solve(...)`, must not define `main`),
 * then the generated harness.
 */
export function buildCppSource(problem, candidateCode) {
  return (
    '#include <bits/stdc++.h>\n' +
    'using namespace std;\n\n' +
    candidateCode +
    '\n\n' +
    buildCppHarness(problem)
  );
}

/** Encode one test's args as the single stdin line the harness expects. */
export function cppStdinForTest(test) {
  return JSON.stringify(test.args);
}

/**
 * Parse the harness marker protocol from captured stdout.
 * Returns { result, timeMs, error } where result is the JSON-parsed
 * @@RESULT payload (undefined when the test errored or never printed).
 */
export function parseCppMarkers(stdoutText) {
  let result;
  let timeMs;
  let error;
  for (const rawLine of String(stdoutText).split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('@@RESULT ')) {
      try {
        result = JSON.parse(line.slice('@@RESULT '.length));
      } catch {
        error = 'Harness printed unparseable output.';
      }
    } else if (line.startsWith('@@TIME ')) {
      const n = parseInt(line.slice('@@TIME '.length), 10);
      if (Number.isFinite(n)) timeMs = n;
    } else if (line.startsWith('@@ERROR ')) {
      error = line.slice('@@ERROR '.length) || 'Harness error.';
    }
  }
  return { result, timeMs, error };
}
