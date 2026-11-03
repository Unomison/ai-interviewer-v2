# Milestone 1 — Foundation: completion report

Date: 2026-11-02 · Spec: *AI Interviewer: Build Specification (Zero to One)*, Rev 2

## What is done

- **Monorepo** (`package.json`, npm workspaces `apps/*` + `packages/*`, one lockfile).
- **API skeleton** (`apps/api`): Node 24 + Express 4, helmet, CORS locked to
  `CORS_ORIGIN`, JSON body limit, `GET /api/health` → `{status, db, time}`.
  **Graceful degradation is real and tested**: no `MONGODB_URI` → boots and
  reports `db:"not_configured"`; unreachable URI → boots and reports
  `db:"unreachable"` after the 5s driver timeout; the server never crashes.
- **Web skeleton** (`apps/web`): React 18 + Vite 5 + Tailwind 3 landing page.
  Pings `/api/health` on first load and shows a **"waking the interviewer"**
  state (with background retry every 15s) while Render's free backend is cold.
  "Try the sample interview" / "Start my own" lead to an honest
  **"coming in Milestone 3" placeholder** — nothing faked.
- **Shared schemas** (`packages/schemas`): Zod contracts, starting with
  `guestSessionSchema` (opaque token + expiry, spec §5) and the health/error
  response shapes.
- **Mongo wiring**: `MONGODB_URI` env (Atlas M0 for deploy, local
  `mongo:7` via `docker-compose.yml` for dev/offline only).
- **CI** (`.github/workflows/ci.yml`): checkout → Node 24 → `npm ci` →
  `npm test` → `npm run build`.
- **Docs**: `docs/architecture.md`, `docs/decisions/001-monorepo-and-hosting.md`,
  `docs/decisions/002-section-15-decisions.md` (owner-confirmed §15 decisions),
  `docs/free-tier-facts.md` (every fact dated 2026-11-02; unverifiable items
  marked UNVERIFIED, never asserted).
- **Tests** (`tests/health.test.js`, Node built-in runner, zero extra deps):
  3/3 passing — real server booted as a child process, real HTTP assertions.
- **Tools placeholder** (`tools/README.md` + `tools/hello.py`): documents that
  Python tooling is offline-only and arrives in M6/M7.

## What is NOT done (later milestones)

Everything functional: LLM gateway (M2), intake/ATS/sample data (M3),
in-browser runner + locked editor (M4), C++ toolchain (M5), problem pipeline
(M6), research crawler + knowledge base (M7), interview engine (M8), voice
(M9), report/sharing/JIT (M10), RAG (M11), hardening/launch (M12).
No provider keys are used anywhere in M1; `GEMINI_API_KEY`/`GROQ_API_KEY`
placeholders sit commented in `.env.example`.

## Acceptance criteria status (spec §13)

| Criterion | Status |
|---|---|
| Monorepo | ✅ done |
| Node API skeleton | ✅ done |
| React skeleton | ✅ done |
| MongoDB Atlas M0 connection | ✅ code + graceful degradation done; Atlas account/cluster is the owner's step (below) |
| CI | ✅ workflow committed (runs on first push) |
| .env.example | ✅ done |
| docker-compose for local tooling | ✅ done (local `mongo:7`, dev/offline only) |
| "Done when frontend and backend deploy to the free hosts and a health check passes from the public URL" | ⚠️ **code-complete, deploy pending owner accounts** — everything required is built and documented (`README.md` → *Deploy*); the public-URL health check needs the owner's Vercel/Render/Atlas accounts (below) |

## Verification (all run, all green)

```bash
npm install            # 223 packages, exit 0
npm test               # node --test "tests/**/*.test.js" → 3 pass, 0 fail
npm run build          # vite build → dist/ in 2.3s, exit 0
# manual: boot API, curl health
(PORT=5000 node apps/api/src/server.js &) ; sleep 2
curl http://127.0.0.1:5000/api/health
# → {"status":"ok","db":"not_configured","time":"..."}  (200)
curl -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/nope  # → 404
```

Test notes (fixed during this build, for the record):
- `node --test tests/` (directory form) fails on this Node build — the suite
  runs via the glob `node --test "tests/**/*.test.js"`.
- The unreachable-DB test initially asserted on the first 200 response, but the
  Mongo driver needs its full ~5s `serverSelectionTimeoutMS` to declare the
  host dead — the test now polls until the status settles.
- A test-harness bug (unref'd fallback timer referencing the reassigned
  module-level child) SIGKILLed the wrong server; fixed by capturing the target
  locally in `stopServer()`.

All background servers were killed after verification; ports 5000/5199 free.

## Defaults applied (spec §15 — all CONFIRMED by the owner 2026-11-02)

1. **Provider keys**: owner creates **both** Google AI Studio (Gemini) **and**
   Groq. M2 gateway assumes both exist in production, with graceful
   mock/sample fallback when absent.
2. **Editor languages v1**: Python, JavaScript, C++ — all in-browser; Java later.
3. **C++ toolchain**: one-time, lazily loaded, cached download of tens of MB —
   **approved**.
4. **On-demand research**: must work on the **deployed** link (correction to the
   spec's laptop-first default). Pre-crawl seed may still run on the owner's
   laptop first. Time-box ~60s, cache in MongoDB, light enough for free tier.
5. **Company field**: auto-fill from JD only when unambiguous → else leave
   **empty** for the user → else infer from resume. (Recorded as intake design
   note; UI in M3.)
6. **Behavioral round**: in v1, **last** in interview order, LLM only.
7. **Pre-crawl location**: owner's laptop first (GitHub Actions later).

Full text: `docs/decisions/002-section-15-decisions.md`. The owner welcomes
further clarifying questions anytime.

## What is needed from the owner

1. **Accounts + deploy** (the only M1 acceptance item not in our hands):
   Atlas M0 cluster + DB user → Render web service (root = repo root,
   build `npm ci`, start `npm --workspace apps/api run start`,
   env `MONGODB_URI` + `CORS_ORIGIN`) → Vercel project (root = repo root,
   build `npm --workspace apps/web run build`, output `apps/web/dist`,
   env `VITE_API_URL`). Then: `curl <render-url>/api/health` must return
   `db:"connected"`. Step-by-step in `README.md` → *Deploy*.
2. **Keys for M2** (when ready to start it): `GEMINI_API_KEY`
   (Google AI Studio) and `GROQ_API_KEY` — via host dashboards, never in chat.
3. **Decision**: approve starting Milestone 2 (LLM gateway), or redirect.
4. No code was pushed anywhere; no credentials were created or stored.

## New concepts explained (spec rule 1)

- **npm workspaces**: one repo, multiple packages sharing one `node_modules`
  (`npm --workspace apps/web run build` targets one of them).
- **Graceful degradation**: the API boots without a database and says so in
  `/api/health` instead of crashing — required because free hosts sleep and
  restarts happen.
