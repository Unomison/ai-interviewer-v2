# ADR 006 — C++ toolchain choice and browser integration (Milestone 5)

Date: 2026-11-04
Status: Accepted

## Context

Spec §4.8 requires C++ to run in the visitor's browser: a wasm-Clang
toolchain (compiler Worker + WASI runner Worker), lazily loaded, cached, with
a `bits/stdc++.h` shim, a generated per-problem harness, per-test timeouts,
and no SharedArrayBuffer/COOP/COEP if avoidable. The owner approved a
one-time, lazily-loaded, cached toolchain download of tens of MB
(002-section-15-decisions.md). M5 plugs into M4's `apps/web/src/runner/`
architecture as a third language running the same 4 sample problems.

## Evaluation

Researched 2026-11-04 via web search, npm, and the GitHub repos. Criteria:
works today, real one-time download size, SharedArrayBuffer need, license
(must suit the owner's open-source portfolio), CDN-loadable, not vendored
into git.

### browsercc v0.1.1 (BertalanD) — CHOSEN

- **Works today**: yes. npm package with precompiled wasm Clang + LLD;
  used in production by Playcode. Verified end-to-end 2026-11-04: compiled
  a hello-world and the full generated two-sum harness (with our WASI shim)
  to a valid `WebAssembly.Module`; all 6 sample tests pass under our shim.
- **Real one-time download** (measured from the live jsDelivr CDN,
  2026-11-04): clang.wasm 13.9 MB + lld.wasm 6.3 MB + sysroot.tar 3.9 MB +
  JS glue ~41 KB = **≈ 24.2 MB compressed**. (The 19 MB `stdc++.h.pch` is
  skipped — see below.)
- **SharedArrayBuffer**: not needed. Zero references in the toolchain JS;
  no COOP/COEP headers required → no `vercel.json` → Monaco, fonts, and
  Pyodide are unaffected. This is the spec's explicit preference.
- **License**: MIT (verified in package.json and the LICENSE file) —
  compatible with the owner's open-source portfolio.
- **CDN**: loads from `https://cdn.jsdelivr.net/npm/browsercc@0.1.1/dist/`
  at runtime; nothing vendored into git or the JS bundle.
- **Limits** (documented, verified): no C++ exceptions (link fails without
  `-fno-exceptions` — confirmed), no threads.

### Rejected

- **zenith-cpp**: could not locate a real project — searches return
  unrelated results. Not evaluable; rejected.
- **cpp-playground**: name collides with several unrelated projects; no
  canonical maintained wasm-Clang distribution found. Rejected.
- **Wasmer JS SDK**: ~100 MB uncompressed, C-focused, heavier than needed.
  Rejected on size.
- **emception** (Emscripten-based Clang): heavier glue, needs more build
  infrastructure; WASI is simpler and matches the spec. Rejected.

## Decisions

### 1. browsercc's public `compile()` API, not vendored internals

`compile({ source, fileName, flags, extraFiles })` → `{ compileOutput,
module }`. The compiler runs in a **module** Web Worker (Blob URL) that
imports the pinned CDN build. Emscripten resolves `clang.wasm`/`lld.wasm`
relative to the CDN `import.meta.url`, and `sysroot.tar` the same way — no
custom file-serving needed.

### 2. Download-once via the browser HTTP cache, not Cache Storage

jsDelivr serves immutable versioned URLs (`cache-control: public,
max-age=31536000, immutable`). The loader pre-fetches the 6 toolchain files
with a staged progress bar, warming the HTTP cache; the compiler worker's
own fetches then hit the warm cache. Cache Storage was considered and
rejected: browsercc's Emscripten glue fetches via its own paths, which
bypass Cache Storage, so warming the HTTP cache is the correct integration
point. (IndexedDB would have the same bypass problem.)

### 3. Compile flags: `-std=c++17 -O2 -fno-exceptions -I. -I/ -Wl,-z,stack-size=8388608 -Wl,--max-memory=67108864`

- `-fno-exceptions` is **mandatory** (WASI has no EH; without it the link
  fails on `__cxa_throw`). Candidate `try`/`catch` therefore fails the
  compile with a clear compiler error — surfaced in the UI with guidance,
  never a hang.
- 8 MB stack: deep recursion is safe. 64 MB linear-memory cap: the
  problem's memory limit, enforced by the toolchain.
- `-O2` over `-O0`: measured compile 16.2 s vs 10.6 s (node) — only ~5 s
  slower — while `-O2` keeps runtime near-native so the 2 s timeout
  measures the algorithm, not the missing optimizer. (Optimization flags
  compared on 2026-11-04; see the M5 report.)
- Threads: assumed unavailable (no pthreads in this build).

### 4. Own `bits/stdc++.h` shim via `extraFiles`, not the 19 MB `.pch`

The WASI sysroot does not ship `bits/stdc++.h`; many DSA candidates use
it. We inject our own 20-header shim through browsercc's `extraFiles`
(compiled with `-I.`/`-I/`) — zero extra download. The precompiled header
would speed up STL-heavy compiles but costs 19 MB more download and
requires exactly `-std=c++20 -O2 -fno-exceptions`; noted as a future
optimization, not taken.

### 5. Own minimal WASI shim (`wasi-shim.js`), no extra dependency

The compiled programs are WASI command modules importing 10
`wasi_snapshot_preview1` functions (verified via
`WebAssembly.Module.imports()`). Our shim implements those plus `args_*`,
`clock_time_get`, `random_get`, `sched_yield`. It is self-contained by
construction (no imports/DOM/Node APIs) so the classic runner Worker can
embed it via `.toString()` — Blob workers cannot import relative modules.
We use our own shim rather than `@bjorn3/browser_wasi_shim` to keep the
runtime dependency surface at zero and the semantics identical between
node tests and the browser.

### 6. Compile once per submit; fresh runner worker per test

`CppSession`: compile once → `WebAssembly.Module` (structured-cloned, not
transferred, so the main thread can re-send it). Each test spawns a fresh
runner worker with its own stdin; the per-test timeout terminates the
worker and marks TLE, and the next test **reuses the already-compiled
module — no recompile** (spec §4.8). Time multiplier ×1 (wasm runs near
native; M4: JS×1, Python×3).

### 7. Failure modes are honest; no hosted-executor fallback in v1

- Toolchain download fails → `CppToolchainError` (retryable) with a clear
  message; the UI offers retry or JS/Python.
- Compile fails → `CppCompileError` carrying the compiler output plus the
  try/catch + no-`main()` guidance.
- Device too weak → the loader/watchdog surfaces `CPP_UNAVAILABLE_MESSAGE`:
  C++ unavailable on this device, JS/Python run the same problems.
- The spec-optional hosted executor is **not built** (per the M5 brief).

## Consequences

- First C++ pick downloads ~24 MB once (progress bar); each submit
  compiles in ~10–16 s (measured; see MILESTONE5_REPORT.md).
- `prewarmCppToolchain()` is exported for M8 (start loading while the
  candidate explains their approach).
- The compiler worker needs `Worker(..., { type: 'module' })`; CSPs that
  block `worker-src blob:` or `connect-src cdn.jsdelivr.net` would break
  it (no CSP is set today; noted for future hardening).
