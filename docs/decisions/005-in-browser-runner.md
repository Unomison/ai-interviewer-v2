# ADR 005 — In-browser code runner design (Milestone 4)

Date: 2026-11-04
Status: Accepted

## Context

Spec §4.8 requires candidate code to run in the visitor's browser inside Web
Workers with hard timeouts (terminate the worker on overrun): JavaScript
natively, Python via Pyodide, C++ via a WASM Clang toolchain (Milestone 5).
Milestone 4 covers JavaScript + Python, the locked Monaco editor, and the
test-runner UI. There is deliberately no server-side execution (spec
non-goal); the acceptance is that sample problems run correct and incorrect
solutions with the right pass/fail and timeouts.

## Decisions

### 1. One worker per test for JavaScript; a session worker for Python

- **JavaScript**: each test spawns a fresh worker from a Blob URL, the
  executor races the result against the per-test timeout, and terminates the
  worker on overrun (TLE). Spawning is ~ms-cheap for JS, so per-test workers
  are the simplest correct lifecycle.
- **Python**: Pyodide init costs seconds, so one worker serves a whole problem
  run (`PythonSession`). Each test message is still raced against the
  per-test timeout; on overrun the worker is terminated, the test is marked
  TLE, and a fresh worker is lazily re-initialised before the next test
  (progress callback reports the reload). Same terminate-on-TLE semantics,
  without paying Pyodide init per test in the common case.

### 2. The `solve(...)` convention with environment-agnostic worker scripts

The candidate defines `solve(...)`; the harness calls it with the problem's
JSON args and compares the canonicalised output. The JS worker script is
written to run unchanged in a browser Web Worker **and** in node
`worker_threads` (`{ eval: true }`), so `node --test` exercises the exact
code path the browser runs (correct → all pass, wrong → fail, infinite loop
→ terminated/TLE — all asserted in tests).

### 3. Comparison modes: exact / float tolerance / unordered

Per spec §4.8's problem I/O model. `unordered` sorts canonicalised array
elements (used by two-sum, where index order is irrelevant). A `custom`
checker hook is left as a future extension point; none of the M4 problems
need it.

### 4. Monaco from CDN via `@monaco-editor/react`; Pyodide pinned to 0.27.7

- `@monaco-editor/react` lazy-loads the editor from jsDelivr at runtime only
  when the editor mounts. Verified: production bundle is ~195 KB (64 KB
  gzip) with no Monaco or Pyodide runtime inside.
- Pyodide is pinned to **0.27.7** (a known-good 2025 release line) and loaded
  via `importScripts` inside the Python worker on first use, with staged
  progress ("downloading" → "loading") surfaced in the UI. A failed CDN load
  produces a clear, retryable error instead of a hang.

### 5. Timeouts: 2 s default, Python ×3 multiplier

Per-test default 2000 ms (spec: "a few seconds"), configurable per problem
(`timeLimitMs`). Per-language multiplier (spec §4.8): JavaScript ×1,
Python ×3, reflecting Pyodide's slower execution. Multipliers are config,
not code, so M6's measured reference runs can tune them.

### 6. First-failing-case rule

Only the first failing **visible** test reveals input/expected/got; if the
first failure is a hidden test, the UI says a hidden test failed without
showing anything. Hidden inputs never leave the worker boundary in
displayable form. (Per spec §4.6 this is configurable; the default is on.)

### 7. Output cap: 256 KB per test

A runaway `console.log` or giant return value is capped at 256 KB
serialised; overruns are reported as errors, not crashes.

## Consequences

- M5 adds the C++ toolchain behind the same executor interface (worker +
  timeout + terminate); the problem-spec format already supports it.
- M6's offline pipeline reuses `problems.js`' format and the comparison
  functions directly.
- M8 wires the real approach-judging unlock (the M4 demo toggle is a stand-in)
  and the hint ladder (hints are already stored per problem).
- README notes the accepted trade-off from spec §4.8: tests ship to the
  browser, so a determined visitor could read hidden tests — fine for a
  self-practice tool.
