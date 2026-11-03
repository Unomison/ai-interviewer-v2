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
apps/web/        React + Vite + Tailwind landing (health ping, M3 placeholder)
packages/schemas/  shared Zod contracts (guestSession starting example)
tools/           Python OFFLINE tooling only (placeholder until M6/M7)
tests/           real API tests via node --test (boots the server, uses HTTP)
docs/            architecture.md, decisions/ (ADRs), free-tier-facts.md
docker-compose.yml  local Mongo for dev/offline only (deployed demo uses Atlas M0)
.github/workflows/ci.yml  install → test → build
```

## Milestones

Per spec Section 13. M1 done (see `MILESTONE1_REPORT.md`). Next: M2 LLM gateway
(adapters, failover, validated structured output) — owner confirmed 2026-11-02
he will create both the Gemini (Google AI Studio) and Groq keys; the gateway is
designed assuming both exist in production with graceful fallback when absent.
See `docs/decisions/002-section-15-decisions.md` for all five confirmed decisions.

## Security / privacy notes (M1)

- No secrets in git (`.env` is gitignored; `.env.example` has placeholders only).
- CORS locked to `CORS_ORIGIN`; helmet headers on; JSON body limit 1 MB.
- Untrusted input handling, PII redaction, rate limits arrive with the features
  that need them (M3+).
