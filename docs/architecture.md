# Architecture (target, end of v1)

Short version of spec Section 3. Milestone 1 ships only the skeleton:
a health-checked API, a landing page that pings it, and the database contract.

## The visitor's path (production)

```
VISITOR'S BROWSER (React + Vite + Tailwind + Monaco)
  ├─ in-browser code runner (JS Worker, Pyodide, wasm Clang)   [M4/M5]
  ├─ mic via MediaRecorder, browser TTS                         [M9]
  └─ interview transcript UI                                     [M8]
        │ HTTPS (REST + Server-Sent Events for streaming)
        ▼
NODE.JS API — ONE Express service on Render free tier
  ├─ guest sessions (opaque tokens, TTL expiry)                  [M3]
  ├─ interview state machine, persisted to Mongo every step      [M8]
  ├─ LLM gateway: provider chain, retries, cache, quota budget   [M2]
  ├─ PDF/DOCX parsing + PII redaction + ATS scoring              [M3]
  └─ STT proxy (Groq Whisper; Web Speech fallback in browser)    [M9]
        │                                    │
        ▼                                    ▼
MONGODB ATLAS M0 (free)              FREE AI PROVIDERS (keys server-side)
sessions, problems, knowledge        Gemini free tier → Groq open models →
chunks + vectors, research,          OpenRouter free (failover chain)
turns, reports
```

**One deployed backend service.** Free instance hours are shared across a
workspace, so a single Node service fits free hosting better than several.
No separate Python service in production.

**Python is offline tooling only** (spec §3): problem generation/validation,
research ingestion, evals. Output = data in MongoDB. Its CLIs live in `tools/`
and run on the owner's laptop (GitHub Actions later).

**The server never runs untrusted code.** Candidate code runs in the visitor's
browser (Workers + timeouts). Generated problem code runs only in the owner's
local sandbox during offline validation.

**State lives in MongoDB**, written at every transition, so the server can
sleep, restart, or redeploy mid-interview and the session resumes (spec §4.5).

## Guest sessions (spec §5)

No users collection — visitors are guests. Random unguessable session/report
ids, TTL indexes (e.g. 7 days) on everything session-related to stay inside
the 512 MB free cap. Audio is never stored: transcribed and discarded.

## Data model (target, arrives M3+)

`guest_sessions`, `sessions`, `documents`, `ats_reports`, `knowledge_chunks`,
`research`, `problems`, `wanted_problems`, `turns`, `submissions`,
`evaluations`, `reports`. See spec §5 for fields and indexes.

## Milestone 1 slice

- `apps/api`: Express skeleton, helmet + CORS, `/api/health` with DB status,
  graceful degradation when Mongo is missing/unreachable.
- `apps/web`: Vite + Tailwind landing, pings `/api/health` on load, shows the
  "waking the interviewer" state for the sleeping free backend.
- `packages/schemas`: shared Zod contracts (guestSession starting example).
- `docker-compose.yml`: local Mongo for development only.
- CI: install → test (`node --test`) → `vite build`.
