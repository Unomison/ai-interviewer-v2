# Milestone 4 report — in-browser runner + locked editor (JS + Python)

Date: 2026-11-04 · Spec §4.6, §4.8 · Acceptance: sample problems run correct
and incorrect solutions with the right pass/fail and timeouts.

## Done

- **Monaco editor** (`apps/web/src/runner/components/LockedEditor.jsx`):
  `@monaco-editor/react`, loaded from CDN at runtime (never bundled —
  production bundle is ~195 KB / 64 KB gzip). Locked mode = readOnly +
  overlay with the spec's exact text "Explain your approach to unlock".
  The real LLM-judged unlock arrives in M8; M4 exposes `locked` /
  `onUnlockRequest` props plus a demo toggle that simulates an accepted
  approach.
- **Language picker**: JavaScript, Python (spec v1 set minus C++, which is
  M5). Starter `solve(...)` templates per language per problem.
- **Execution engine** (`apps/web/src/runner/`):
  - `harness.js` — canonical output comparison (exact / float tolerance /
    unordered), worker scripts, verdict aggregation, first-failing-case rule.
  - `executor.js` — worker-per-test core with hard timeouts: terminate the
    worker on overrun → TLE → continue with the next test. Untrusted code
    never touches the main thread or the backend (no server execution).
  - `pyodide.js` — Pyodide 0.27.7 lazy-loaded from CDN only when Python is
    picked, with staged progress; clear retryable error if the CDN fails.
    Python uses a session worker (Pyodide init is expensive) with identical
    per-test timeout/terminate semantics.
- **Test runner UI** (`TestRunner.jsx`): per-test pass/fail, runtime ms,
  errors; first failing *visible* case shows input/expected/got; hidden
  inputs never displayed; overall verdict banner.
- **4 sample problems** (`problems.js`): two-sum, valid-parentheses,
  reverse-string, contains-duplicate — each with visible + hidden tests in
  the shared problem-spec format M6 will reuse, plus precomputed hints.
- **Playground page**: problem + language pickers, locked editor, runner —
  linked discreetly from the landing ("Here for the coding round?").
  M1 landing and M3 intake/report UI untouched.

## Measured behaviour (verified in `node --test`, real worker path)

| Solution | Result |
|---|---|
| Correct two-sum | all 6 tests pass |
| Incorrect (`return [0, 0]`) | fails; first case shows input `[2,7,11,15], 9`, expected `[0,1]`, got `[0,0]` |
| `while (true) {}` | worker terminated at the timeout → TLE on every test |
| Syntax error / missing `solve` / thrown error | `error` status with a clear message, no hang |
| Python silent worker | timeout → TLE, worker re-initialised for the next test |

## Verification (all run, all green)

- `npm install` — exit 0 (`@monaco-editor/react` added to apps/web)
- `npm test` — **68 pass, 0 fail** (38 M1–M3 + 30 new M4)
- `npm run build` — vite build succeeds; Monaco/Pyodide confirmed
  CDN-loaded, not bundled
- API booted manually: `/api/health` → 200; all servers killed afterwards

## Not done / caveats

- **C++ is Milestone 5** — not started; the executor interface is ready for it.
- Python has not been executed end-to-end in a real browser here (no
  browser in this environment); the Python path is covered by structural
  tests with Pyodide stubbed, and the worker script follows the same
  timeout/terminate protocol as the JS path. Worth one manual run on the
  deployed link (pick Python in the playground, run the tests).
- Per-language time multipliers (JS ×1, Python ×3) are sensible defaults,
  not measured reference runs — M6 calibrates them.
- Tests ship to the browser (spec §4.8 accepts this for a self-practice
  tool); noted in the README.

## Defaults

- Per-test timeout 2000 ms (configurable per problem via `timeLimitMs`).
- Output cap 256 KB per test. First-failing-case reveal: on (configurable).

## Needed from the owner

1. **Push to GitHub** (same flow as M3: download the fresh source zip I'll
   provide, unzip over the local repo keeping `.git`, `git add -A`,
   commit, `git push`) — Render/Vercel auto-deploy from `main`.
2. Optional but recommended: one manual Python run on the deployed
   playground to confirm the Pyodide CDN load in a real browser.
3. Go/no-go on **Milestone 5** (C++ in the browser: WASM Clang toolchain).
