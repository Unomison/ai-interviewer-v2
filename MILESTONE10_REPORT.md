# Milestone 10 — Report, sharing & JIT problems (spec §4.9–4.10, §5–6): report

Date: 2026-11-04. Status: **DONE** (with the honest mock-vs-real caveat below).

## What was built

**Report generation** (`apps/api/src/report/`)
- `POST /api/report/generate {sessionToken}` — finished interviews only
  (409 `interview_not_complete` otherwise). One `report` gateway call over
  the condensed transcript, round assessments, DSA artifacts and ATS recap.
- Split scoring per spec §4.10: the LLM scores only optimisation,
  communication and resume_depth (with verbatim evidence quotes); code
  computes problem_solving and code_correctness deterministically from
  executed test results, hint counts and approach attempts. Overall score
  is a renormalised weighted mean (30/30/15/15/10) computed in code.
- `evidence.js` enforces the evidence rule *after* the call: every quote is
  checked as a verbatim transcript substring (quotes under 12 chars don't
  count). Unverifiable claims are flagged `inference: true`, never dropped
  silently; evidence-less dimensions become "insufficient data" with a
  nulled score (spec §4.10's exact term). The report carries an
  `evidenceReport` count and the "automated estimate, not ground truth"
  disclaimer (same spirit as the ATS report).
- `GET /api/report?sessionToken=` (owner re-fetch), `GET
  /api/report/share/:token` (public; 404 unknown, 410 revoked/expired),
  `DELETE /api/report/share/:token` (idempotent revoke). Share tokens are
  128-bit `crypto.randomBytes` hex — never the session id. Reports have
  their own 30-day TTL (Mongo + in-memory fallback, M8 pattern).

**Report UI** (`apps/web/src/views/Report.jsx`)
- Overall score, five dimension cards with evidence quotes and
  deterministic-vs-LLM source labels, DSA results table, weak topics,
  prioritised study plan, timeline, ATS recap, disclaimer + evidence counts.
- Share box: copyable `#/shared/<token>` link (hash routing works on static
  hosting), revoke button. Print stylesheet → "Print / save as PDF" from
  the browser; no server-side PDF on the free tier (ADR 011).
- Interview completion screen now has "View my report →" (token preserved
  across the done transition and refresh-resume).

**Recorded demo** (spec §6)
- `apps/api/data/recorded-demo.json`: a realistic 15-turn demo interview +
  a complete pre-computed report whose evidence quotes are asserted verbatim
  against its own transcript in tests. `GET /api/report/demo` serves it
  with zero gateway calls (proven by a throwing stub).
- `GET /api/llm/status` reports per-task budget without spending calls; the
  interview view checks it after an `interviewer_unavailable` failure and
  offers the demo banner instead of a dead end. Landing page links it too.

**JIT problems** (spec §4.9; `apps/api/src/problems/jit.js`)
- `POST /api/problems/jit {sessionToken, topic, difficulty}`: bank-covered
  topics return the bank problem immediately (no LLM burned); uncovered
  topics go to the `problem_gen` gateway → full draft returned for
  browser-side validation.
- `apps/web/src/runner/jitValidate.js` runs the M6 trust bar in the real
  in-browser runners (JS always, Python via Pyodide, C++ only if the
  toolchain is already loaded): reference must pass all tests, wrong must
  fail ≥1, runtimes measured. Receipt → `POST /api/problems/jit/validate`
  → assessed by pure `assessJitReceipt()`; pass derives
  `timeLimitMs = max(reference runtime) × 5` (clamped 2–30 s).
- Any failure (generation error, mock mode, budget exhaustion, bad receipt)
  falls back to the deterministic closest bank problem
  (topic overlap → difficulty → slug) with an honest reason string. Never
  serves an unvalidated JIT problem. The server never executes generated
  code. Drafts are session-scoped (24 h TTL); every attempt is logged to
  `wanted_problems` for the next offline pipeline run. The planner trigger
  `findJitCandidate()` (first gap skill with zero bank coverage) is
  implemented and unit-tested; auto-wiring into the M8 planner is a
  deliberate one-line follow-up (ADR 011).

## Verification (all green, independently run)

- `npm test`: **273 tests, 270 pass, 0 fail, 3 skipped** (pre-existing M5
  browsercc-gated). **42 new M10 tests** across `tests/report.test.js`
  (schemas, deterministic stats incl. the problem_solving formula,
  evidence enforcement incl. the insufficient-data rule, full
  generateReport with a stubbed gateway, share lifecycle, demo
  verbatimness) and `tests/jit.test.js` (topic matching, receipt
  assessment, time-limit derivation, request/validate orchestration incl.
  all fallback branches, wanted_problems logging).
- `npm run build`: succeeds; main bundle 264 KB (~+12 KB for the report
  views and JIT validator — Monaco/Pyodide/browsercc still CDN-loaded).
- Live HTTP on a scratch port: `/api/health` 200; `/api/llm/status` 200
  with per-task budgets; `/api/report/demo` 200 with the full demo shape;
  generate/report/share/jit/jit-validate all return 400 on empty bodies,
  404 on unknown shares; no bare 500s anywhere. Server killed afterwards;
  port verified free.

## Honest mock-vs-real account

- Every `report` and `problem_gen` gateway call ran stubbed here (no keys
  on this machine). The evidence enforcer, deterministic scorers and all
  fallback branches are fully exercised; the real prose quality depends on
  the owner's keys on Render, as with M8.
- The browser-side JIT validation module (`jitValidate.js`) is wired to
  the real executors but was not executed in a real browser here — same
  standing caveat as M4/M5's runners. Its receipt *assessment* (the part
  that decides serve vs fallback) is fully unit-tested server-side.
- The recorded demo is real static data served live (verified over HTTP).

## Acceptance (spec §13 M10)

- Final report with evidence quotes ✅ (verified quotes + inference flags)
- Study plan ✅ (prioritised, with reasons + suggested bank problems)
- Shareable private link ✅ (unguessable token, TTL, revoke, hash-routed)
- Print/PDF view ✅ (browser print stylesheet)
- Recorded-demo page for quota exhaustion ✅ (zero LLM calls, offered on
  budget exhaustion)
- JIT path with browser-side validation and fallback ✅ (all branches
  tested; never serves unvalidated problems)

## Deferred / follow-ups (documented in ADR 011)

- Auto-wiring `findJitCandidate()` into the M8 planner (one-line hook).
- History page with trends (spec §4.10 mentions it; needs a guest-model
  design — localStorage-based — out of M10 scope).

## After pushing

Nothing special: the standard push flow; Render/Vercel auto-deploy. The
report button appears automatically when an interview completes. To see a
real report end to end, finish any interview on the deployed link (needs
the owner's LLM keys on Render, as usual).
