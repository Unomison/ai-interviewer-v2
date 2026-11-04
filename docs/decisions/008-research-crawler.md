# ADR 008 — On-demand research crawler design

Date: 2026-11-04
Status: Accepted
Context: Spec §4.3 + §13 M7; ADR 002 decision 3 (on-demand research MUST work on the deployed Render backend, free tier).

## Decisions

### 1. Plain-HTTP fetching only — no headless browser on the server
Render's free tier cannot run Playwright/Puppeteer. The on-demand path uses
`fetch()` with guardrails (per-request timeout, byte cap, redirect following,
clear User-Agent). Consequence: JS-heavy pages that render nothing
server-side yield thin text and are skipped; bot-walled pages (measured:
nokia.com/about-us/ → HTTP 403) are skipped gracefully. The 60s budget means
we take what the open web gives us.

### 2. URL discovery: deterministic guessing + LLM suggestions; DDG is best-effort only
Measured 2026-11-04 from a datacenter IP:
- `html.duckduckgo.com/html/` → HTTP 202 + anomaly/challenge page, no results.
- `lite.duckduckgo.com/lite/` → HTTP 200 but anomaly challenge page, no results.

This confirms the spec's own warning ("datacenter IPs are sometimes blocked").
So discovery is:
1. **Deterministic official-domain guessing** (`{slug}.com` + /careers, /about-us, /about) — zero-cost to propose, verified by fetch. Immune to search blocking.
2. **LLM-suggested URLs** — the gateway (with real keys, as on Render) proposes official pages; each is verified by fetch. Strongest signal in production.
3. **DuckDuckGo keyless endpoint** — implemented as a fallback for networks where it works; never depended upon.

Tradeoff accepted: for obscure companies with unpredictable domains, discovery is weaker than a real search API — but it needs no keys, works from the server, and the 60s box + partial results keep it honest.

### 3. Hand-rolled HTML→text extractor, zero new dependencies
The spec suggests @mozilla/readability + jsdom for Node. Those are heavy for a
free-tier server running a handful of pages per job. Our ~90-line extractor
strips scripts/styles/nav/footer/aside, dedupes repeated lines, decodes
entities — good enough for an LLM summarizer, which tolerates noise.

### 4. 60s server-side time-box with graceful partials
`researchCompany` races the pipeline against a deadline timer (unref'd so it
never holds the process open). Outcomes: `cache` | `fresh` | `partial` |
`failed`. Timeouts and per-URL failures never throw; the HTTP layer always
answers 200. Total failure returns `fallback: 'role-generic'` so M8 can
continue with generic patterns (spec §4.3 fallback).

### 5. Cache: MongoDB TTL 30 days, keyed `company|role`
Company facts change slowly; a 30-day TTL (same convention as M3 sessions) is
cheap and a slightly stale KB only mildly degrades the planner. Only `fresh`
KBs are cached — partials are returned, never stored. In-memory Map fallback
when no DB is configured (same graceful-degradation pattern as M1/M3).

### 6. Mock discipline: never cache fabrications
The gateway falls back to deterministic mocks without keys. A mock KB would be
*fabricated company facts*, so `summarize.js` throws loudly in mock mode
(same pattern as M6's generate.js). The on-demand route degrades to `partial`
(raw extracts, no KB); the seed script aborts. Nothing mock-derived ever
enters the knowledge base.

### 7. Politeness
Per-origin robots.txt is fetched (cached 10 min) and `Disallow` prefixes for
`*` are honoured; ≤3 concurrent fetches; ≤5 pages per run; public pages only,
no login walls, no anti-bot bypassing.

## Consequences
- M8's planner consumes the KB JSON (schema in `apps/api/src/research/schema.js`):
  overview, tech stack, practices, culture, recent developments, and
  `interviewAngles` — company-specific topics worth probing.
- Pre-crawl seeding (`tools/seed-research.js`) runs from any machine with
  network + keys; GitHub Actions scheduling later per spec.
- What we did NOT build (spec's Python CLI twin): the pipeline stages live in
  one Node module with injectable deps instead of duplicated Python/Node
  implementations — prompts, schemas and scoring rules are shared by
  construction, which satisfies the spec's "stay consistent" intent with less
  code to drift.
