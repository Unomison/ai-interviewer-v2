# Milestone 6 Report — Offline Problem Pipeline + Validated Bank

Date: 2026-11-04
Spec refs: §4.4 (pipeline), §4.9 (bank), §13 (M6 acceptance)

## Done

- **Canonical schema** (`packages/schemas/index.js`): `problemSchema` (Zod) + `toClientProblem()` projection. Enforces ≥6 tests (≥3 visible, ≥3 hidden), args/params arity, floatTolerance.
- **Pipeline CLI** (`tools/problem-pipeline/run.js`): canonicalise → verify (real JS/Python/C++ runtimes) → differential → calibrate → emit.
- **52-problem bank** hand-authored, covering arrays, strings, hash maps, two pointers, sliding window, stack, binary search, sorting, recursion, math. 44 easy / 8 medium.
- **LLM generation module** (`tools/problem-pipeline/generate.js`): uses M2 gateway; fails loudly in mock mode (no keys).
- **Seed script** (`tools/seed-problems.js`): idempotent, versioned migration; `--dry-run` supported.
- **API**: `GET /api/problems`, `GET /api/problems/:slug` (Mongo-first, bundled fallback).
- **Frontend**: `problems.js` re-exports pipeline-generated `problems.generated.js` (single source of truth).
- **Tests**: `tests/pipeline.test.js` (21 tests: schema, differential, calibration, seed, sync, generate).
- **ADR**: `docs/adr/007-problem-pipeline.md`.

## Validation results (real execution)

Full pipeline run: **52/52 problems passed** verification in all three languages.
Total pipeline time: ~16.5 minutes (dominated by C++ compiles via browsercc).

| Language | Runtime | Sample maxRuntimeMs (two-sum / 3sum / fibonacci) |
|----------|---------|--------------------------------------------------|
| JavaScript | Node worker_threads (M4 harness) | 79ms / 96ms / 81ms |
| Python | Pyodide (npm, file-based worker) | 4ms / 4ms / 4ms |
| C++ | browsercc v0.1.1 (M5) | 331ms / 216ms / 197ms |

Calibration examples: two-sum → timeLimitMs 3310ms (10×331ms); fibonacci → 2000ms (floor).

Per-problem timings and differential results: `data/validation-report.json`.

**Honestly executed vs approximated:**
- ✅ Reference solutions: executed in REAL JS, Python, and C++ runtimes for every test of every problem.
- ✅ Wrong solutions: executed in JS (must fail ≥1 test — guards against weak tests).
- ✅ Oracles: executed in JS (must agree with reference under the problem's comparison mode).
- ⚠️ Wrong/oracle in Python/C++: NOT executed (JS-only by design; algorithmic equivalence is language-agnostic). Documented in ADR 007.
- ⚠️ Calibration timings: measured on this VM (GitHub Actions / Render may differ; limits have 10x headroom).

## Not done / needs keys

- **LLM problem generation**: `generate.js` works but needs `GEMINI_API_KEY` or `GROQ_API_KEY`. The 52-problem bank is 100% hand-authored (no LLM was used).
- **Mongo seed**: Not run here (no Mongo reachable from this VM). The seed logic is unit-tested with a fake collection. The owner must run it against Atlas (see below).

## Acceptance status (§13 M6)

- [x] ≥50 problems validated across languages: **52/52 passed** (JS+Python+C++).
- [x] Bank imported into the app: API serves from Mongo (with bundled fallback); frontend uses generated client file.
- [x] Versioned bank + seed script: `BANK_VERSION=1.0.0`, migration semantics.

## What the owner does

1. **Push to GitHub** (auto-deploys Render + Vercel):
   ```bash
   cd ~/Desktop/ai-interviewer-v2-source
   # ... (swap in the new source files, keep .git) ...
   git add -A
   git commit -m "Milestone 6: problem pipeline + 52-problem bank"
   git push origin main
   ```

2. **Seed the bank into Atlas** (one-time; idempotent):
   ```bash
   MONGODB_URI='mongodb+srv://<user>:<password>@cluster0.hrvx1ld.mongodb.net/ai-interviewer?retryWrites=true&w=majority' \
     node tools/seed-problems.js
   ```
   Expected output: `{"action":"seeded","version":"1.0.0","count":52,...}`.
   Verify: `GET https://ai-interviewer-v2.onrender.com/api/problems` should return `{"source":"mongo","version":"1.0.0","count":52,...}`.

3. **Manual checks** (recommended):
   - One Python problem on the deployed playground (Pyodide CDN load).
   - One C++ problem on the deployed playground (browsercc CDN load).
