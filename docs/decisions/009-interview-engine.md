# ADR 009 — Interview engine (Milestone 8) design

Date: 2026-11-04
Status: Accepted
Context: Spec §§4.4–4.6 + §13 M8 acceptance ("a full text interview completes, survives a server restart and fits the call budget"); ADR 002 round order; M2 gateway (`planner`, `interviewer`, `approach_judge` tasks), M3 intake sessions, M4 locked editor + in-browser runners, M6 problem bank, M7 research KB.

## Decisions

### 1. Planner = 1 gateway call for *content*; round order + problem slugs deterministic in code
The `planner` task produces per-round content (goals, focus areas, topics, themes, time budgets) validated by Zod. Round order is **not** left to the LLM — `assemblePlan()` hard-codes the ADR-002 sequence (intro → resume → dsa → cs → behavioral → closing) and DSA slugs come from `selectProblems()`. Rationale: the owner confirmed the order explicitly; an LLM must not be able to reorder or drop rounds. The planner only colours inside the lines.

### 2. Deterministic DSA problem selection, gap-aware
`selectProblems()` filters the bank by seniority (intern/new-grad → easy only; mid/senior → easy+medium), scores topic overlap against the candidate's genuine ATS gaps, tie-breaks by slug. No LLM call needed to pick problems — the LLM only chooses *angles* (via the planner's focus areas). Count: 1 problem for interns, 2 otherwise.

### 3. Session store mirrors the M3 intake store (Mongo TTL 30d + in-memory fallback)
Same proven pattern: `sessions` collection with `expiresAt`, in-memory Map when Mongo is down. The session records everything M10 will need: full transcript (role/text/round/timestamp), per-round status + assessments, DSA artifacts (approach texts, judge verdicts, hints used, submissions + test results, scores), timing (startedAt/endedAt per round), research outcome. **Sessions survive a server restart** via Mongo (verified pattern from M3).

### 4. State machine = pure functions, never throws
`machine.js` exposes `checkTransition` / `advance` as pure functions over `(currentRound, target)`. Transitions are forward-only through the canonical order; DSA has sub-states (shown → approach → coding → submitted → scored). Invalid transitions return `{ ok: false, reason }` → HTTP 409, never an exception. The machine has no I/O and no LLM dependency — fully unit-testable.

### 5. Interviewer = exactly 1 LLM call per turn; bounded context
`interviewer.js` builds the prompt from: plan, candidate profile, current round, the **last 10 turns verbatim + at most 30 older turns condensed to one line each**, and DSA context when relevant. This is the call-budget discipline the spec asks for — context grows O(1) per turn, not O(n). The interviewer may return `question | followup | probe | transition`; round changes are **server-driven** (the machine applies them), the LLM only *suggests* via the transition shape. On interviewer failure → HTTP 503 with a clear message (M2 failover already tried other providers first).

### 6. Real approach judge drives the editor lock — with a never-hard-lock fallback
`POST /api/interview/approach` → `approach_judge` gateway call → `{ accepted, verdict, feedback }`. Verdicts: `accept` (unlock), `hint` (serve precomputed hint, stay locked, ≤3), `clarify` (stay locked, ask for more), `reject`. **Fallback (documented, spec §4.6 "graceful"):** if the judge errors, the editor unlocks with `judge-error` recorded; on the 3rd hint the editor unlocks anyway. A candidate is never permanently locked out by an LLM outage. The M4 `LockedEditor` `demoToggle` is disabled in the interview view (`demoToggle={false}`); the lock is now real.

### 7. Hint ladders precomputed for the whole bank (spec §4.6 compliance fix)
M6 shipped hints only for the 4 original sample problems (48/52 had none). M8 adds `tools/problem-pipeline/bank/hints.js` — 48 hand-authored progressive ladders (2–3 hints each) merged in `bank/index.js`, bank bumped **1.0.0 → 1.1.0**. The 1.0.0 solution/test validation still stands (unchanged); only metadata was added. The client never receives hints except one at a time via the judge endpoint; `toClientSafeDsaProblem` strips hints, solutions and reference code.

### 8. DSA results feed back into the interviewer
`submitDsaResult` records the submission (code + test results + verdict) and immediately runs an interviewer reaction turn with `advanceProblem`/`endRound` flags, so the interviewer can ask about the failing case or move on. The submission itself is client-executed (M4/M5 runners); the server only records and reacts.

### 9. Client-safe projections at the boundary
`clientState()` strips hint ladders, reference solutions and full test details; the approach endpoint serves at most one hint per call. The full bank (`data/problems.json`) is server-side only; the client bundle carries only the playground subset (M6) plus per-interview active-problem projections.

### 10. Error contract: 400 malformed, 404 unknown, 409 bad transition, 502 planner, 503 interviewer
Mirrors the M3 route conventions. The interview logic never throws on bad input.

## Consequences
- M8 ends at the closing round; the final report is M10 but all its inputs are now recorded.
- The interviewer is only as good as the LLM behind it on Render (owner's keys); with no keys it degrades to the deterministic mock (schema-valid but bland) — verified in the HTTP smoke test.
- Python-in-browser and C++-in-browser remain manually unverified in a real browser (M4/M5 caveats carry forward); the interview UI reuses those exact components.
