# ADR 011 — Final report, sharing & JIT problems (Milestone 10) design

Date: 2026-11-04
Status: Accepted
Context: Spec §4.10 (evaluation and final report) + §4.9 (JIT problems) + §5 (data model: `reports` with unguessable share id, TTL everywhere) + §6 (frontend screens incl. recorded-demo page) + §13 M10 acceptance; M8 session store (records everything the report needs); M2 gateway (`report` and `problem_gen` tasks already defined); M6 pipeline (trust bar for problems).

## Decisions

### 1. The LLM scores only judgement dimensions; code scores deterministic dimensions
Spec §4.10 splits the five dimensions by source: problem_solving and code_correctness come from executed results (approach judgements, hint counts, test pass rates), while optimisation, communication and resume_depth need a model reading the transcript. So the single `report` gateway call returns only the three judgement dimensions plus prose (summary, weak topics, study plan). `deterministicDimensionScores()` in code computes the other two from the session's DSA artifacts. The model never invents a test pass rate, and code never writes prose. The overall score is a renormalised weighted mean computed in code — never by the model.

### 2. Evidence quotes are verified, not trusted
Spec §4.10: "Rubric prompts require evidence before scoring." The prompt instructs verbatim quotes, but instructions are not enforcement — `enforceReportEvidence()` checks every quote as a case-insensitive substring of the transcript (quotes under 12 chars don't count; "yes" is not evidence). Unverifiable claims are kept but flagged `inference: true`; dimensions with no verifiable evidence are scored null and marked "insufficient data" (spec's exact term). The report carries an `evidenceReport` count so the UI can show "N verified quotes, M inferred claims". No invented evidence can reach the reader unlabeled.

### 3. Deterministic stats are pre-computed so the LLM writes around facts
`computeReportStats()` produces round durations, turn counts, per-problem pass rates (last submission), hint/approach-attempt counts and the ATS recap before the prompt is built. The prompt presents these as "DETERMINISTIC FACTS (already scored — do not re-score)". Pure functions, unit-tested, no LLM involved.

### 4. Share links carry an unguessable token, never a session id
`crypto.randomBytes(16)` → 128-bit hex token stored on the report document alongside `shareRevoked`. `GET /api/report/share/:token` is the only public surface; unknown → 404, revoked/expired → 410 (honest distinction, not a generic 404). `DELETE` revokes idempotently. Reports get their own 30-day TTL, matching sessions. Frontend links use `#/shared/<token>` hash routing so they work on static hosting with no backend route changes.

### 5. Print/PDF = browser print stylesheet, no server rendering
Generating PDFs server-side needs headless Chromium — impossible on the free tier and unnecessary. A `@media print` stylesheet (plus Tailwind `print:` variants) hides chrome and controls page breaks; the user prints to PDF from the browser. The report says "Print / save as PDF" and does exactly that.

### 6. Recorded demo is fully static JSON — provably zero LLM calls
`apps/api/data/recorded-demo.json` holds a realistic 15-turn interview plus a complete pre-computed report whose evidence quotes are verified verbatim against its own transcript (asserted in tests). `GET /api/report/demo` serves it with no gateway touch. The frontend offers it when `GET /api/llm/status` reports the interviewer budget exhausted (checked after an `interviewer_unavailable` failure, not polled). A stub gateway that throws on any call proves the demo path in tests.

### 7. JIT: server generates, browser validates, server never executes
Spec §4.9 forbids server-side execution of generated code, so the trust bar moves to the visitor's browser: `POST /api/problems/jit` returns the full draft (statement, tests, reference/wrong solutions) for a topic with zero bank coverage; `apps/web/src/runner/jitValidate.js` runs the reference through the real in-browser runners (JS always, Python via Pyodide, C++ only if the toolchain is already loaded — never force a 24 MB download for validation) and requires the wrong solution to fail ≥1 test; `POST /api/problems/jit/validate` assesses the receipt with the compressed M6 bar and derives `timeLimitMs = max(reference runtime) × 5`, clamped to 2–30 s. Any failure — generation error, mock mode, budget exhaustion, bad receipt — falls back to the deterministic closest bank problem (topic overlap → difficulty → slug) with an honest reason string. Never serves an unvalidated JIT problem.

### 8. The JIT draft in the browser is a deliberate, documented exception
Serving reference solutions to a client contradicts the "never serve solutions" rule — but the draft goes only to the validating browser, before the candidate ever sees the problem, within their own session, and the validation worker discards it. The alternative (server execution) is spec-forbidden. This is a practice tool, not a contest; the trade-off is documented here rather than hidden.

### 9. Session-scoped drafts + wanted_problems log; the shared bank is never written
Validated JIT problems live in a `jit_drafts` store (Mongo TTL 24 h + in-memory fallback) keyed by session — a visitor can never write into the shared bank (spec §4.9). Every attempt (generated / validated / failed / fallback / budget_exhausted) is logged to `wanted_problems` for the next offline pipeline run, which re-validates properly before anything enters the bank.

### 10. Planner hook for JIT is a pure trigger function, not yet auto-wired
`findJitCandidate({ gapSkills, seniority, problems })` returns the first gap skill with zero bank coverage — the exact "planner wants a topic the bank doesn't cover" trigger from §4.9. It is unit-tested and ready; auto-calling it from the M8 planner is a one-line change deliberately left for a follow-up so M10 ships without touching the interview engine's hot path. The full path (request → browser-validate → serve/fallback) is complete and tested end to end at the API level.

### 11. Deferred: history page with trends
Spec §4.10 mentions a history page listing past sessions with trends. With the guest model (no accounts) this needs a localStorage-based design; it is out of M10's scope and noted here rather than silently dropped.
