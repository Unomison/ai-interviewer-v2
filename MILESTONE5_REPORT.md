# Milestone 5 report — C++ in the browser (wasm-Clang)

Date: 2026-11-04 · Spec §4.8 · Acceptance: the same sample problems pass in
C++ with correct TLE detection, and first-use load + compile times are
acceptable on a mid-range laptop.

## Done

- **Toolchain choice** (ADR `docs/decisions/006-cpp-toolchain.md`):
  **browsercc v0.1.1** (MIT, by BertalanD) — precompiled wasm Clang + LLD,
  used in production by Playcode. Rejected: zenith-cpp (not locatable),
  cpp-playground (no canonical distribution), Wasmer JS SDK (~100 MB),
  emception (heavier). No SharedArrayBuffer → no COOP/COEP headers → no
  `vercel.json`; Monaco, fonts, and Pyodide are unaffected (the spec's
  explicit preference).
- **Nothing vendored**: the toolchain loads from the jsDelivr CDN at
  runtime, lazily, only when the visitor picks C++. Production bundle is
  ~221 KB (71 KB gzip) — the ~24 MB toolchain is not in it.
- **Loader** (`apps/web/src/runner/cpp.js`): staged progress bar for the
  one-time download, browser HTTP-cache caching (immutable versioned URLs;
  Cache Storage rejected — the Emscripten glue bypasses it, see ADR 006),
  retryable error state, and `prewarmCppToolchain()` for M8.
- **Compiler worker**: module Web Worker importing browsercc from the
  pinned CDN; compiles candidate C++ + generated harness with
  `-std=c++17 -O2 -fno-exceptions -I. -I/ -Wl,-z,stack-size=8388608
  -Wl,--max-memory=67108864` (8 MB stack, 64 MB memory cap; exceptions
  unavailable — `try`/`catch` fails the compile with a clear error and
  guidance; threads unavailable).
- **Runner worker**: classic Web Worker embedding our own minimal WASI shim
  (`wasi-shim.js`, inlined via `.toString()`); captures stdout/stderr.
- **`bits/stdc++.h` shim** (`harness.js` `STDCPP_SHIM`): injected via
  browsercc `extraFiles` — the WASI sysroot doesn't ship it; zero extra
  download (the 19 MB `.pch` was evaluated and skipped).
- **Generated C++ harness** (`buildCppHarness`): one JSON test per stdin
  line, `@@TEST` / `@@RESULT` / `@@TIME` / `@@ERROR` markers, per-test
  `steady_clock` timing, never throws. Reuses M4's comparison modes
  (`exact`/tolerance/`unordered`) and the first-failing-case rule.
- **Per-test timeouts**: fresh runner worker per test; on overrun the
  worker is terminated → TLE → the next test runs with the
  **already-compiled module (no recompile)** — the spec's exact
  requirement. Time multiplier ×1 (wasm runs near native; M4: JS×1,
  Python×3).
- **UI wiring**: C++ in the playground language picker with per-problem
  starter templates; `TestRunner` dispatches to `runCppTests`; compile
  errors surface the compiler output (whitespace-preserved, no hang);
  honest fallback message when the toolchain can't load (suggests
  JS/Python; the spec-optional hosted executor is not built).
- **Tests** (`tests/runner.cpp.test.js`): 27 tests — harness codegen, shim
  header mapping, marker parsing, WASI shim surface (fd_read/write,
  proc_exit), toolchain constants, worker-source structure, loader
  error→retry, compile-error surfacing, TLE-with-no-recompile, verdict
  plumbing, plus a **real end-to-end** (gated on `BROWSERCC_DIST`): the
  generated harness compiles with the real browsercc wasm-Clang and runs
  under the real runner-worker source — all 6 two-sum tests pass, a real
  infinite loop yields TLE and the pool recovers, and bad C++ is rejected
  with diagnostics.

## Measured load + compile times (acceptance evidence)

Measured 2026-11-04. "CDN" rows are real compressed transfer sizes from
the live jsDelivr CDN; "compile" rows are real browsercc compiles of the
generated two-sum harness on this machine (Linux VM, node — a mid-range
laptop browser will be in the same ballpark; wasm compile speed is
CPU-bound and browsers run the same wasm).

| Item | Measured |
|---|---|
| One-time download (clang.wasm + lld.wasm + sysroot.tar + JS glue) | **≈ 24.2 MB** compressed (13.9 + 6.3 + 3.9 MB + 41 KB) |
| Cold compile, `-O2` (chosen) | **≈ 15–16 s** |
| Cold compile, `-O1` / `-O0` (rejected) | ≈ 12.7 s / ≈ 10.6 s |
| Per-test run (already compiled) | **< 100 ms** (worker spawn + instantiate) |
| Harness self-time per test | 0–1 ms |

**Judgment**: acceptable. The 24 MB download happens once and is cached;
each submit then costs one ~15 s compile with a progress bar — fine for an
interview loop where candidates run tests a handful of times. `-O2` was
kept over `-O0` despite ~5 s slower compiles because it keeps runtime
near-native, so the 2 s timeout measures the algorithm rather than the
missing optimizer. No recompile ever happens on TLE.

## Acceptance status vs spec M5 criteria

| Criterion | Status |
|---|---|
| Same sample problems pass in C++ | ✅ — real e2e: all 6 two-sum tests pass; harness verified for all 4 problem signatures |
| Correct TLE detection | ✅ — real infinite-loop → TLE; next test reuses the compiled module |
| First-use load + compile times acceptable | ✅ — 24 MB once (cached), ~15 s/compile, measured |
| Lazy loading / caching | ✅ — only on C++ pick; HTTP cache; `prewarm()` for M8 |
| bits/stdc++.h shim | ✅ — injected, zero extra download |
| Generated harness per problem | ✅ — from the shared problem-spec format |
| Per-test timeouts, no recompile after TLE | ✅ — tested |
| Fallback messaging (no hosted executor) | ✅ — honest device message, suggests JS/Python |
| No SharedArrayBuffer / COOP/COEP | ✅ — verified zero references; no vercel.json needed |

## What's needed from the owner

Same flow as M3/M4: **push to GitHub** (`Unomison/ai-interviewer-v2`) —
Render and Vercel auto-deploy. Nothing to configure: no new env vars, no
`vercel.json`, no dashboard changes. After deploy, one manual check is
recommended (I have no live browser): open the deployed playground, pick
C++, run the two-sum starter — expect the ~24 MB toolchain progress bar
once, then a ~15 s compile, then test results.

## Honest testing statement

Truly executed: real browsercc compiles (good code, bad code,
infinite loop), the real generated harness running under the repo's own
WASI shim, the real runner-worker source via node `worker_threads`,
real per-test timeouts with worker termination, and the real
marker→compare→verdict path — all asserted in `node --test` (27/27 pass
with `BROWSERCC_DIST` set; the 3 e2e skip gracefully without it).
Structurally tested only: the compiler *worker* wrapper (a module worker
importing the CDN can't run in node) and the actual browser UI clicks.
The one check I could not do here is loading the deployed page in a real
browser.
