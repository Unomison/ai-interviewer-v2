# AI Interviewer v2 — build from the spec, milestone by milestone

An AI mock interviewer for **software engineering candidates**: a realistic voice +
transcript interview, a locked-editor DSA coding round with real in-browser test
execution, and company-aware questions.

**This build is public, zero-install and login-free.** A visitor opens a link and
uses it — no account, no downloads, no local model. Everything runs on
open-source software and genuinely free tiers, behind swappable adapters.
See the full source of truth: `~/workspace/user/files/AI_Interviewer_Build_Specification__Zero_to_One___1.pdf`
(the spec; `docs/` summarises the parts that matter for building).

> Milestone 1 (this commit): foundation — monorepo, API skeleton, web skeleton,
> Atlas M0 wiring with graceful degradation, CI. Interview features arrive in
> Milestones 2–12. See `MILESTONE1_REPORT.md`.

## Architecture (one paragraph)

The visitor's browser (React + Vite + Tailwind, later Monaco) talks over HTTPS to
**one** Node/Express API. The API keeps interview state in **MongoDB Atlas (free
M0)** and calls free AI providers (Gemini → Groq → OpenRouter failover chain)
through a swappable LLM gateway — provider keys stay on the server. Candidate
code always runs **in the visitor's browser** (JS Worker, Pyodide, wasm Clang);
the server never executes untrusted code. Python lives in `tools/` for **offline
only**: research ingestion, problem generation/validation, evals. Sessions are
guests (no login), data auto-deletes via TTL. Details: `docs/architecture.md`.

### Two new concepts, briefly (spec rule 1)

- **npm workspaces** — one repo, several packages (`apps/api`, `apps/web`,
  `packages/schemas`) sharing a single `node_modules` and lockfile. Commands
  like `npm --workspace apps/web run build` target one package; `npm install`
  at the root installs everything.
- **Graceful degradation** — the API *never crashes* for lack of a database.
  With no `MONGODB_URI` (or an unreachable one) it still boots and
  `/api/health` reports `db: "not_configured"` / `"unreachable"`. The frontend
  shows a "waking the interviewer" state while the free backend is cold.

## Local setup

Prerequisites: Node 20+ (Node 24 used here), npm, and optionally Docker for a
local Mongo.

```bash
# 1. Install everything (root, workspaces)
npm install

# 2. (Optional) start a local Mongo for development
docker compose up -d
#    -> MONGODB_URI=mongodb://localhost:27017/ai_interviewer

# 3. Configure (API reads .env; web reads VITE_* at build time)
cp .env.example .env
#    edit MONGODB_URI / CORS_ORIGIN / VITE_API_URL as needed

# 4. Run
npm run dev:api   # API on http://localhost:5000
npm run dev:web   # Web on http://localhost:5173  (new terminal)

# 5. Verify
curl http://localhost:5000/api/health
# {"status":"ok","db":"not_configured","time":"..."}  <- expected without a DB

# 6. Tests + web build
npm test          # node --test: boots the real API, hits /api/health over HTTP
npm run build     # vite build of apps/web
```

No `MONGODB_URI`? That's fine — everything above works; the health check just
says `db: "not_configured"`.

## Deploy (free hosts)

> **What only the owner can do** (needs their accounts): create the Vercel,
> Render and Atlas accounts, create the Atlas M0 cluster + database user, and
> paste the connection string / URLs into the dashboards. Everything else is
> code that's already here.

### 1. Database — MongoDB Atlas M0 (free, 512 MB)

1. Sign up at mongodb.com/atlas (no credit card) → create an **M0** cluster.
2. Database Access → add a user (username + strong password, read/write).
3. Network Access → allow `0.0.0.0/0` (Render's outbound IPs change; tighten later).
4. Connect → copy the connection string, e.g.
   `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/ai_interviewer`

### 2. Backend — Render free web service

1. New → Web Service → connect this GitHub repo.
2. Root directory: repo root. Build command: `npm ci` · Start command:
   `npm --workspace apps/api run start`
3. Environment: `Node 24`; add env vars:
   - `MONGODB_URI` = your Atlas string
   - `CORS_ORIGIN` = your Vercel URL (step 3)
   - `PORT` is set by Render automatically — the server reads `process.env.PORT`.
4. Deploy → note the public URL, e.g. `https://ai-interviewer-api.onrender.com`.
5. Health check from the public URL: `curl https://<service>.onrender.com/api/health`
   must return `{"status":"ok","db":"connected",...}`. First request after idle
   takes ~1 min (free tier sleeps after ~15 min — expected).

### 3. Frontend — Vercel (Hobby, free for personal/portfolio use)

1. New Project → import this repo. Framework preset: **Vite**.
2. Root directory: `apps/web`. Build command: `npm run build` (run from repo
   root it resolves via workspaces — or set root to repo and override the build
   command to `npm --workspace apps/web run build`, output dir `apps/web/dist`).
   Simplest reliable setup: **Root Directory = repo root**, Build Command =
   `npm --workspace apps/web run build`, Output Directory = `apps/web/dist`.
3. Environment variable: `VITE_API_URL` = your Render URL from step 2
   (Vite bakes this in at build time — redeploy after changing it).
4. Deploy → open the URL. The landing page pings `/api/health` on load and
   shows "waking the interviewer" while Render wakes.

### 4. Sanity checklist (public URLs)

- `GET <render-url>/api/health` → 200, `db: "connected"`.
- Vercel site loads, backend badge flips to "Interviewer is awake".
- "Try the sample interview" / "Start my own" → Milestone 3 placeholder
  (no faked functionality).

## Repo layout

```
apps/api/        Node/Express API skeleton (health, DB helper, graceful degradation)
apps/api/src/llm/  LLM gateway (M2): adapters, config.yaml, failover, cache, mocks
apps/web/        React + Vite + Tailwind: landing (health ping), intake flow,
               ATS report UI, M4 code playground (Monaco + Workers + Pyodide)
packages/schemas/  shared Zod contracts (guestSession starting example)
tools/           Python OFFLINE tooling only (placeholder until M6/M7)
tests/           real API tests via node --test (boots the server, uses HTTP)
docs/            architecture.md, decisions/ (ADRs), free-tier-facts.md
docker-compose.yml  local Mongo for dev/offline only (deployed demo uses Atlas M0)
.github/workflows/ci.yml  install → test → build
```

## LLM gateway (Milestone 2, spec §8)

Every feature talks to AI providers through **one module** instead of calling
them directly:

```js
import { gateway } from './src/llm/index.js';
const res = await gateway.generate({ task: 'parse', prompt, schema: myZodSchema });
// → { data, text, provider, model, usage, cached, attempts }
// data is ALWAYS validated against your Zod schema.
const { vectors } = await gateway.embed(['some text']);
```

**Env vars** (owner pastes real keys into the host dashboard — Render →
Environment — never into git or chat):

| Var | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio key (primary provider) |
| `GROQ_API_KEY` | Groq key (fast fallback) |
| `OPENROUTER_API_KEY` | Optional extra fallback; chain skips it when absent |
| `OLLAMA_ENABLED` / `OLLAMA_BASE_URL` | Dev-only local model; never in the visitor's path |

**`apps/api/src/llm/config.yaml`** holds the per-task provider chains
(`parse`, `ats_rubric`, `planner`, `interviewer`, `approach_judge`,
`report`, `embed` — default Gemini → Groq → OpenRouter), model names,
daily request/token limits, the global budget (300 calls / 2M tokens per
day), cool-downs and the cache size. Retune here, not in code.

**How it behaves**: 429 → brief back-off, try the next provider; 503 or a
timeout → that provider rests for 60s and is routed around; a provider that
answers but fails Zod validation gets one retry with the error spelled out,
then a loud error. Identical requests are served from an in-memory
content-hash cache. When the daily budget is spent, calls stop with the
friendly "interviewer is resting" message instead of half-running.

**Mock mode**: with no keys configured at all, the gateway serves
deterministic, schema-valid mock answers (and mock embeddings), so the whole
pipeline runs end-to-end — local dev, CI, and demos never hard-require a key.
Design details: `docs/decisions/003-llm-gateway-design.md`.

## Guest intake + ATS (Milestone 3, spec §4.1–4.2)

No login — visitors get an unguessable session token after accepting the
consent notice. The flow: **upload resume** (PDF/DOCX, ≤2 MB, ≤3 pages,
scanned PDFs rejected with a friendly message) → **PII redaction** (email,
phone, links, street address stripped; name → "Candidate") → **one** LLM
call → `resume.json` → optional **JD** (paste or upload → one LLM call →
`jd.json`) → **ATS report**.

The **hybrid ATS score** blends four parts (weights in
`apps/api/src/intake/atsConfig.js`): keyword/skill match 40% (deterministic:
skill alias map + Fuse.js fuzzy matching, required skills weigh double),
semantic match 25% (embedding similarity via the gateway), structure 15%
(deterministic: headings, extractable text, contact info, length), impact
20% (one `ats_rubric` LLM call — the same call returns before/after rewrite
suggestions). The report also splits missing keywords into "you appear to
have this but did not state it" vs "genuine gap", and **never suggests
claiming skills you don't have**. No JD → scored against a generic role
template, clearly labelled. The report always carries the honesty note:
*this is an estimate — real ATS products rarely expose scores.*

Privacy (spec §10): consent before upload; PII redacted before any model
call; the raw file is discarded right after parsing and never stored;
sessions auto-delete via a MongoDB TTL index (30 days); a "delete my data"
button (`DELETE /api/intake/session`) wipes a session on demand.

**Try it without uploading anything**: "Try the sample interview" serves a
precomputed ATS report with **zero LLM calls**
(`GET /api/sample/ats-report`).

API routes: `POST /api/intake/consent`, `POST /api/intake/resume`
(multipart), `POST /api/intake/jd`, `POST /api/ats/report`,
`DELETE /api/intake/session`, `GET /api/sample/ats-report`. The session
token travels in the `x-session-token` header. Design details:
`docs/decisions/004-resume-parsing-libraries.md`.

## In-browser code runner (Milestone 4, spec §4.6, §4.8)

Candidate code runs **entirely in the visitor's browser** — inside Web
Workers with hard timeouts. There is deliberately no server-side execution
of untrusted code (spec non-goal). JavaScript runs natively; Python runs
through Pyodide (WebAssembly), lazy-loaded from CDN only when Python is
picked, with a progress indicator; C++ (Milestone 5) compiles in-browser
with a real Clang/LLD toolchain, also lazy-loaded from CDN.

- **Locked editor**: Monaco (loaded from CDN at runtime — never bundled;
  the production JS is ~220 KB), readOnly with the overlay "Explain your
  approach to unlock" (spec §4.6). The LLM-judged unlock is M8; M4 has a
  demo toggle.
- **Test harness**: your code defines `solve(...)`; the harness calls it per
  test with the problem's JSON args and compares canonicalised output
  (`exact` / float tolerance / `unordered`). Per-test timeout (default
  2 s; Python ×3, C++ ×1 multipliers): on overrun the worker is
  **terminated**, the test is marked TLE, and the run continues with the
  next test.
- **Results panel**: per-test pass/fail, runtime, errors. Only the first
  failing *visible* test reveals input/expected/got; hidden inputs are never
  displayed.
- **Playground**: 4 hand-written problems (two-sum, valid-parentheses,
  reverse-string, contains-duplicate) in the shared problem-spec format M6
  will reuse — linked discreetly from the landing page.

Accepted trade-off (spec §4.8): tests ship to the browser, so a determined
visitor could read hidden tests — fine for a self-practice tool. Design
details: `docs/decisions/005-in-browser-runner.md`.

### C++ in the browser (Milestone 5, spec §4.8)

C++ is a third language in the playground picker, running the same 4
problems. The toolchain is **browsercc v0.1.1** (MIT) — a precompiled
wasm Clang + LLD — loaded from the jsDelivr CDN at runtime. Nothing is
vendored into git or the JS bundle.

- **One-time download ≈ 24 MB** (measured: clang.wasm 13.9 MB + lld.wasm
  6.3 MB + sysroot.tar 3.9 MB, compressed), cached by the browser
  afterwards; a staged progress bar shows the download, then the compile.
  `prewarmCppToolchain()` is exported so M8 can start loading while the
  candidate explains their approach.
- **Compile** happens in a module Web Worker
  (`-std=c++17 -O2 -fno-exceptions`, 8 MB stack, 64 MB memory cap);
  **run** happens in a classic worker under our own minimal WASI shim.
  Compile once per submit (~10–16 s measured); each test runs in a fresh
  worker, and a TLE terminates the worker while the **already-compiled
  module is reused** — no recompile.
- **`bits/stdc++.h` works** via our injected shim (the WASI sysroot does
  not ship it). The generated harness reads one JSON test per stdin line
  and prints `@@TEST` / `@@RESULT` / `@@TIME` markers.
- **Limits** (WASI): no C++ exceptions — `try`/`catch` fails the compile
  with a clear error and guidance; no threads; don't define your own
  `main()`.
- **Fallback**: if the toolchain can't load (e.g. a low-memory phone),
  the UI says so honestly and suggests JavaScript/Python. The
  spec-optional hosted executor is not built.

No SharedArrayBuffer is needed, so no COOP/COEP headers — Monaco, fonts,
and Pyodide are unaffected. Toolchain evaluation and decisions:
`docs/decisions/006-cpp-toolchain.md`; milestone report:
`MILESTONE5_REPORT.md`.

## Milestones

Per spec Section 13. M1 done (see `MILESTONE1_REPORT.md`); M2 done (see
`MILESTONE2_REPORT.md`); M3 done (see `MILESTONE3_REPORT.md`); M4 done (see
`MILESTONE4_REPORT.md`); M5 done (see `MILESTONE5_REPORT.md`); M6 done (see
`MILESTONE6_REPORT.md`). Next: M7 — interview orchestration.

## Problem bank (Milestone 6, spec §4.9)

52 hand-authored DSA problems, each validated by executing its reference
solution in real JS/Python/C++ runtimes (`node tools/problem-pipeline/run.js`).
Bank v1.0.0. Seed into Mongo: `MONGODB_URI=... node tools/seed-problems.js`.
API: `GET /api/problems`. Full report: `MILESTONE6_REPORT.md`.

## Security / privacy notes (M1)

- No secrets in git (`.env` is gitignored; `.env.example` has placeholders only).
- CORS locked to `CORS_ORIGIN`; helmet headers on; JSON body limit 1 MB.
- Untrusted input handling, PII redaction, rate limits arrive with the features
  that need them (M3+).
