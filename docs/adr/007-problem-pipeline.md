# ADR 007 — Offline problem pipeline and validated bank

Date: 2026-11-04
Status: accepted
Milestone: 6 (spec §4.4, §4.9, §13)

## Context

The interviewer needs a bank of coding problems (≥50 per §13 M6 acceptance) whose
test suites are *proven* correct — not just authored. A problem enters the bank
only after its reference solution passes every test in all three supported
languages (JS, Python, C++), a plausible wrong solution fails at least one test
(guards against weak tests), and an independent oracle agrees with the reference.

## Decisions

### 1. Canonical schema in `packages/schemas/` (shared)
One Zod schema (`problemSchema`) defines every problem: slug, title, statement,
examples, constraints, params/returnType, comparison mode, topics, difficulty,
tests [{args, expected, hidden}], per-language signatures/starters, hints,
reference/oracle/wrong solutions, source. Enforces ≥6 tests, ≥3 visible, ≥3
hidden, args-length matches params, floatTolerance when comparison=float.

`toClientProblem()` strips reference/oracle/wrong and adds an `id` alias —
the only projection the client ever sees.

### 2. Real runtimes, not mocks (verify stage)
- **JS**: Node `worker_threads`, reusing M4's `JS_WORKER_SOURCE` (worker-per-test,
  timeout → TLE).
- **Python**: Pyodide npm package in a **file-based** worker (`py-worker.mjs`).
  Eval-workers break Pyodide's relative imports; a parent watchdog bounds total
  time.
- **C++**: browsercc (M5) compile-once, then M5's `CPP_RUNNER_WORKER_SOURCE`
  per test. The dist is resolved self-contained: `$BROWSERCC_DIST`, else
  repo-local `tools/problem-pipeline/.cache/`, else fresh `npm pack` from the
  registry. Never relies on ephemeral `/tmp`.

### 3. Differential testing (JS only, documented)
For each problem: at least one hand-written plausible WRONG solution must FAIL
≥1 test (catches trivially weak tests); an independent oracle (differently-
written) must agree with the reference on all tests under the problem's
comparison mode. Both run in **JavaScript only** — the wrong/oracle are
algorithmic variants, and JS execution is the fastest faithful check. (Stated
honestly in the M6 report.)

### 4. Calibration policy
`timeLimitMs = min(10000, max(1000, ceil(10 × worstMeasuredMs)))`. The bank
stores one base limit; the runner's existing per-language multipliers are
unchanged (M4/M5 timeout architecture semantics preserved). Memory: sanity-
checked against the 64 MB C++ wasm cap; all 52 problems well under.

### 5. LLM generation module (`generate.js`) fails loudly without keys
Uses the M2 gateway (`problem_gen` task). If the gateway returns the mock
provider (no keys on this machine), it throws a clear error instead of emitting
mock problems. The 52-problem bank is 100% hand-authored (stated honestly).

### 6. Seed is a versioned migration (`tools/seed-problems.js`)
Idempotent: same bank version → no-op. Newer version → upserts by slug, records
version in `problem_bank_meta`. Problems are never deleted. `--dry-run`
supported. API serves from Mongo when connected, falls back to bundled
`apps/api/data/problems.client.json` (playground keeps working offline).

### 7. Single source of truth for the playground
`apps/web/src/runner/problems.js` re-exports the pipeline-generated
`problems.generated.js` (4 playground slugs). A test asserts every playground
slug exists in the canonical bank. No divergent copies.

## Consequences
- 52 problems validated across JS/Python/C++ (real execution). Report:
  `data/validation-report.json`.
- Pipeline runtime ~15–20 min for the full bank (dominated by C++ compiles).
- Bank version `1.0.0`. Adding a problem = new bank version + migration.
