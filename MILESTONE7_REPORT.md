# Milestone 7 Report — Research crawler + knowledge base

Date: 2026-11-04
Spec: Section 4.3 (Research agent), Section 13 milestone 7; ADR 002 decision 3
(hard requirement: the on-demand path MUST work on the deployed Render backend).

## Status: DONE

Acceptance (spec §13): *"a pre-crawled company returns sourced, deduplicated
items instantly, and an unseen company is researched on demand in about a
minute and then served from the cache."*

- Pre-crawled/cached company → `source: 'cache'`, instant, no crawl. ✅ (unit-tested)
- Unseen company → researched on demand within the 60s box, then cached. ✅
  (live-measured below)
- `research.json` assembled without vector search (spec's M7 wording) — the KB
  is a structured document for the M8 planner. ✅

## What was built

`apps/api/src/research/` (all new):
- `schema.js` — Zod KB schema shaped for the M8 planner: overview, techStack,
  engineeringPractices, culture, recentDevelopments, **interviewAngles**
  (company-specific topics worth probing, each with `why` + source URLs),
  sources, researchedAt, provenance. Plus the POST body schema.
- `discover.js` — URL discovery: (1) deterministic official-domain guessing
  (`{slug}.com` + /careers, /about-us, /about — zero-cost to propose, verified
  by fetch), (2) LLM-suggested URLs when the gateway has keys (production),
  (3) DuckDuckGo keyless HTML endpoint as best-effort fallback.
- `fetch.js` — polite plain-HTTP fetcher: per-request timeout, streaming byte
  cap, redirect following, research-bot User-Agent, per-origin robots.txt
  (cached 10 min, `Disallow` honoured). Public pages only.
- `extract.js` — zero-dependency HTML→text (strips scripts/styles/nav/footer,
  dedupes boilerplate, decodes entities; also grabs title/meta description).
- `summarize.js` — ONE `research` gateway call → validated KB JSON. **Mock
  discipline**: throws loudly in mock mode (a mock KB would be fabricated
  company facts — same pattern as M6's generate.js).
- `cache.js` — MongoDB collection, 30-day TTL, key `company|role`
  (normalized); in-memory Map fallback when no DB (M1/M3 pattern). Only
  `fresh` KBs are cached — partials never.
- `index.js` — `researchCompany()` orchestrator: cache → discover → fetch
  (≤3 concurrent, ≤5 pages) → extract → summarize → cache. 60s time-box via
  an unref'd deadline timer; outcomes `cache|fresh|partial|failed` — timeouts
  and per-URL failures degrade gracefully, never throw.
- `routes/research.js` — `POST /api/research {company, role}` → always 200
  for valid input (400 only for bad input). Wired in `server.js`.
- Gateway: new `research` task in `apps/api/src/llm/config.yaml`
  (gemini → groq → openrouter).

`tools/seed-research.js` — pre-crawl seeder for any machine with network +
keys: `MONGODB_URI=... GEMINI_API_KEY=... node tools/seed-research.js
--companies "Nokia,Google" [--role "..."]`. Aborts loudly without keys.

Docs: `docs/decisions/008-research-crawler.md` (8 decisions), README section.

## Verification

- `npm test`: **142 tests, 139 pass, 0 fail, 3 skipped** (the 3 skips are the
  M5 browsercc-gated e2es — unchanged). 29 new M7 tests: extraction,
  discovery (incl. DDG-failure fallback), fetcher (local HTTP server: 200/404/
  robots-disallow/timeout/byte-cap), summarizer mock-refusal, cache
  hit/miss/TTL-key, orchestrator (cache hit, fresh+cached, mock→partial with
  no cache write, no-pages→failed+role-generic, 500ms budget→partial in
  <1500ms), **live smoke** (real fetch of https://example.com), and a **real
  server route test** (graceful 200 for an unfetchable company).
- `npm run build`: succeeds, bundle 221.59 KB / 70.78 KB gzip (unchanged —
  research is server-side only).
- `/api/health` → 200; `POST /api/research` validation → 400 on empty company.

## Measured live behaviour (this machine, no LLM keys)

| Probe | Result |
|---|---|
| DDG `html.` endpoint | HTTP 202 + anomaly challenge page — blocked from datacenter IP |
| DDG `lite.` endpoint | HTTP 200 but anomaly challenge page — blocked |
| `nokia.com/careers/` via Node fetch | 200 once, then 403 (bot-wall is flaky/IP-reputation based; curl still 200 → TLS-fingerprint filtering, not UA) |
| `stripe.com`, `anthropic.com`, `careers.google.com` via Node fetch | 200, full pages |
| Live on-demand run: `POST /api/research {"company":"Stripe"}` | `partial`, 3 pages fetched + extracted in **3.6s**, honest note "Summarization needs LLM keys on this server" |
| Live on-demand run: `{"company":"Nokia"}` | `failed` + `fallback: 'role-generic'` (all Nokia pages 403'd Node fetch at that moment) — graceful, 5.1s |

On Render (with the owner's Gemini/Groq keys), the Stripe-style run becomes
`fresh`: same fetch/extract, plus one gateway summarization call, then cached
for 30 days.

## Honest account: executed live vs mocked

- **Truly executed live**: plain-HTTP fetching + robots handling + HTML→text
  extraction against real public sites (example.com in-suite; stripe.com,
  anthropic.com, google careers, nokia.com probed manually); the 60s time-box
  (500ms-budget unit test + real 3.6s Stripe run); cache hit/miss/TTL logic;
  the mock-refusal path (no-keys machine → `partial`, nothing cached).
- **Not executed here**: LLM summarization into KB JSON (no keys on this
  machine — tested with a stubbed gateway; runs for real on Render where the
  owner configured keys); the Mongo-backed cache path (tested via the
  in-memory fallback; same TTL pattern as the proven M3 store); the seed
  script against Atlas (owner-run; it aborts loudly without keys/DB).
- **Approximations**: DDG parsing tested against a fixture (live DDG is
  blocked from here); LLM URL suggestions tested via stub (needs keys).

## Known limitations (by design, per spec)

- Bot-walled sites (Akamai/Cloudflare TLS fingerprinting) 403 Node fetch from
  servers. We do **not** bypass anti-bot protection (spec §4.3 forbids it) —
  those pages are skipped, and the pre-crawl seed (owner's laptop / residential
  IP) plus the cache exist precisely for this.
- No Python CLI twin: the spec's "shared pipeline as Python CLI + Node module"
  is satisfied by one Node module with injectable deps — prompts, schemas and
  rules are shared by construction, so nothing can drift (recorded in ADR 008).
- Embeddings/dedup and recency scoring from spec §4.3 arrive with the M11 RAG
  upgrade; M7 assembles research.json without vector search, per the M7
  acceptance text.

## What the owner does after pushing

Nothing required. Optional: warm the cache —
`MONGODB_URI='...' GEMINI_API_KEY='...' node tools/seed-research.js --companies "Nokia,Google,Microsoft"`.
Verify: `POST https://ai-interviewer-v2.onrender.com/api/research
{"company":"Stripe"}` → expect `source: 'fresh'` (first call, ~seconds) then
`source: 'cache'` (second call, instant).
