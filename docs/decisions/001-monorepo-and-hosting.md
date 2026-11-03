# ADR 001 — Monorepo and hosting for Milestone 1

Date: 2026-11-02
Status: Accepted

## Context

Spec Section 13, Milestone 1: monorepo, Node API skeleton, React skeleton,
MongoDB Atlas M0 connection, CI, `.env.example`, docker-compose for local
tooling. Owner knows MERN + Python. Zero paid services, no API keys required,
swappable adapters.

## Decision

- **npm workspaces monorepo** (`apps/*`, `packages/*`). One repo, one lockfile,
  shared contracts in `packages/schemas`. npm is already on the owner's machine
  and CI; no extra tooling (no Turborepo/Nx — overkill for one service + one app).
- **One deployed backend service** (Node/Express), per spec §3: Render's free
  instance hours are shared across the workspace, so one service fits free
  hosting better than several.
- **Frontend: React + Vite + Tailwind.** Owner knows React; Vite builds a static
  bundle Vercel can host for free.
- **Database: MongoDB Atlas M0** for the deployed demo (512 MB, always free,
  vector search for later milestones). `docker-compose.yml` runs a local
  `mongo:7` for development/offline only.
- **Graceful DB degradation (mandatory):** the API starts with no `MONGODB_URI`
  or an unreachable one and reports `db: "not_configured" | "unreachable"` in
  `/api/health`. A missing database must never crash the server.
- **Tests:** Node's built-in test runner (`node --test`), zero extra deps.
  API tests boot the real server and hit it over HTTP.
- **CI:** GitHub Actions (free for public repos): `npm ci` → `npm test` →
  `vite build`.

## Consequences

- Frontend and backend deploy independently to their free hosts; the web app
  reads the backend URL from `VITE_API_URL` at build time.
- Render's free backend sleeps after ~15 min idle (~1 min cold start), so the
  landing page pings `/api/health` on load and shows a "waking the interviewer"
  state (spec §6).
- The Python tooling folder (`tools/`) is offline-only from day one, so it can
  never accidentally become a production dependency.
