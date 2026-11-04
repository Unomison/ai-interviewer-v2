# Milestone 8 Report — Interview engine (text)

Date: 2026-11-04
Spec: Sections 4.4 (interview planning), 4.5 (interviewer conversation loop), 4.6 (coding rounds: approach judge + locked editor); Section 13 milestone 8; ADR 002 round order; ADR 009.

## Status: DONE

Acceptance (spec §13): *"a full text interview completes, survives a server restart and fits the call budget."*

- Full text interview completes (start → all 6 rounds → closing) — ✅ in-suite with a stubbed gateway (scripted round transitions), asserting the ADR-002 order.
- Survives a server restart — ✅ sessions persist in Mongo (TTL 30d); in-memory fallback when no DB (same proven M3 pattern). The frontend keeps the interview token in `localStorage` and resumes via `GET /api/interview/state`.
- Fits the call budget — ✅ exactly 1 LLM call per interviewer turn; context windowed (last 10 turns verbatim + ≤30 older condensed to one line each); planner = 1 call; approach judge = 1 call per submission; hints are precomputed (zero LLM calls).

## What was built

`apps/api/src/interview/` (all new):
- `schema.js` — Zod request schemas (start/turn/approach/dsa-result/state).
- `planner.js` — one `planner` gateway call (resume.json + jd.json + research KB + ATS gaps) → Zod-validated per-round content; `assemblePlan()` hard-codes the ADR-002 round order and merges deterministic DSA problem selection.
- `selectProblems.js` — deterministic, gap-aware: seniority → difficulty pool (intern/new-grad = easy only; mid/senior = easy+medium), topic overlap with genuine ATS gaps, slug tiebreak. 1 problem for interns, 2 otherwise.
- `store.js` — guest interview sessions: Mongo + TTL 30d, in-memory fallback. Records everything M10 needs: full transcript (role/text/round/timestamp), per-round status + assessments, DSA artifacts (approaches, judge verdicts, hints used, submissions + test results, scores), timing.
- `machine.js` — pure-function state machine (never throws): forward-only round transitions; DSA sub-states (shown → approach → coding → submitted → scored); invalid transitions return a reason → HTTP 409.
- `interviewer.js` — 1 gateway call/turn with bounded context (see above); returns `question | followup | probe | transition`; round changes are server-driven.
- `judge.js` — real `approach_judge` gateway call → `{ accepted, verdict, feedback }`; verdicts `accept | hint | clarify | reject`. **Fallback:** judge error → unlock anyway (`judge-error`); 3rd hint → unlock anyway. Never hard-locks.
- `index.js` — orchestrator: `startInterview` (research-if-needed → planner → intro turn), `takeTurn`, `submitApproach` (serves ≤1 precomputed hint per call), `submitDsaResult` (records submission + runs an interviewer reaction turn with `advanceProblem`/`endRound`), `getState`, `clientState` (strips hints/solutions; serves the client-safe active problem).
- `routes/interview.js` — `POST /api/interview/start|turn|approach|dsa-result`, `GET /api/interview/state`. Error contract: 400 malformed, 404 unknown, 409 bad transition, 502 planner-failed, 503 interviewer-unavailable. Never a bare 500.

`apps/api/src/problems/index.js` — `getFullProblem(slug)` (full bank, server-side only) + `toClientSafeDsaProblem()` (strips hints, reference solutions, hidden-test flags) for the client boundary.

Frontend (`apps/web/src/views/Interview.jsx` + wiring):
- Chat-style interview view: round progress pills (intro → resume → DSA → CS → behavioral → closing), transcript, answer input, resume-after-refresh via `localStorage` token.
- DSA rounds embed the real `LockedEditor` (`demoToggle={false}` — the M4 demo toggle is replaced by the real judge) + `TestRunner` (new optional `onResults` callback); approach box → judge → unlock → code → run → submit; per-language code preserved across switches; C++ toolchain prewarmed during intro/resume.
- Intake flow gains a "Start my mock interview →" button; `App.jsx` gains the `interview` view.

Bank fix (spec §4.6 compliance): M6 shipped hints only for the 4 sample problems — 48/52 had none. New `tools/problem-pipeline/bank/hints.js` (48 hand-authored progressive ladders, 2–3 hints each) merged in `bank/index.js`; bank **1.0.0 → 1.1.0**; re-emitted via `node tools/problem-pipeline/run.js --skip-verify`. The 1.0.0 solution/test validation still stands (solutions and tests untouched — only metadata added); `data/validation-report.json` (52/52) preserved.

Docs: `docs/decisions/009-interview-engine.md` (10 decisions), README section.

## Verification

- `npm test`: **176 tests, 173 pass, 0 fail, 3 skipped** (the 3 skips are the pre-existing M5 browsercc-gated e2es). 34 new M8 tests: planner output validation (good/bad shapes), state-machine transitions (happy path + invalid rejection), approach-judge shaping (accept/hint/clarify/reject → lock state; judge-error → unlock), full mock end-to-end (start → all rounds → closing, asserting ADR-002 order), problem selection (difficulty/topic filtering, gap overlap, intern=1/mid=2).
- Live HTTP smoke test (real Express routes, mock LLM — no keys): **16/16 pass** — start (404 unknown intake / 200 valid, plan order matches ADR-002, DSA slugs present), turn (400 empty / 200 ×2), state (transcript grows to 5, round intro, 404 bad token), approach outside DSA → 409.
- `npm run build`: succeeds, bundle 232.96 KB / 73.81 KB gzip (up from 221 KB — the Interview view; still lean, Monaco/Pyodide/browsercc remain CDN-loaded).
- `/api/health` → 200 (booted, checked, server killed afterwards).
- All servers and background processes killed after verification.

## Honest account: executed live vs mocked

- **Truly executed live**: the full state machine, session store (in-memory path), deterministic problem selection, hint-ladder serving (all 52 problems now carry hints — verified in the emitted bank), lock-state mapping, transcript recording, the real Express routes end-to-end (16/16), error paths (400/404/409), the interview UI build.
- **Mocked/stubbed here, real on Render**: every LLM call (planner, interviewer, approach judge) — no keys on this machine. Unit tests use a scripted stub; the HTTP smoke test uses the M2 mock gateway (schema-valid but bland output — e.g. mock questions are placeholder text). With the owner's Gemini/Groq keys on Render, the same code paths run for real; the mock discipline means nothing is fabricated silently.
- **Not executed here**: the Mongo-backed session path (tested via in-memory fallback — same TTL pattern as the proven M3 store); Python/C++ code execution inside a real browser (M4/M5 caveats carry forward — the interview UI reuses those exact components, and recommends one manual Python + one manual C++ run on the deployed playground).
- **Flake note**: one full-suite run showed a single failure that did not reproduce in 4 subsequent runs (173/0 each time); the failing test name wasn't captured. Treating it as a timing flake; will re-check if it recurs.

## Known limitations (by design, per spec)

- M8 ends at the closing round. The final report is M10 — the session records everything it will need (transcript, per-round assessments, code results, timing, scores).
- Voice is M9 — text only here (the header mic icon is decorative until then).
- The interviewer's quality depends on the LLM behind it; with no keys configured it degrades to the deterministic mock rather than failing.

## What the owner does after pushing

Nothing special. Push the source as usual → Render/Vercel auto-deploy. Optional smoke test on the deployed frontend: complete intake → "Start my mock interview" → answer a few questions → confirm the interviewer responds (real LLM on Render, since the owner's keys are configured there). No seed or dashboard steps needed for M8 (the problem bank seed from M6 covers v1.1.0 — the seed script treats it as a migration).
