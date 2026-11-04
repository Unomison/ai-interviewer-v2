# Milestone 11 — RAG upgrade + measurement (spec §4.9, §13)

Date: 2026-11-04. Status: **done** (pending the owner's one-time Atlas index
creation + ingest run — the app works fully without it).

## Done

- **VectorStore interface** (`apps/api/src/rag/store.js`): `AtlasVectorStore`
  (`$vectorSearch` on `kb_chunks`) + `MemoryVectorStore` (cosine, same filter
  semantics); `getVectorStore()` factory; `indexReady()` probe with graceful
  not-ready.
- **Chunking** (`rag/chunk.js`): one chunk per interview angle + overview /
  stack / practices / culture / news; full spec metadata (company, role,
  round, topic, difficulty, year, source_url, confidence); ≤600 chars;
  prune < 0.55.
- **Embedding identity** (`rag/embed.js`): canonical model/dimensions read
  from the gateway's `config.yaml`; mismatch rejected; mock accepted for
  tests, refused by the ingest tool for real indexes.
- **Retrieval wiring** (`rag/retrieve.js` + `rag/index.js`): planner
  (`getRagContext`), per-turn follow-ups (`retrieveForTurn`, bounded, cached),
  question dedup (asked-question embedding ledger), citations
  (`citationsFor` → session `ragCitations` → M10 report `sources`).
- **Hybrid retrieval**: 0.7 vector + 0.3 keyword + metadata pre-filters;
  `setReranker()` seam (evals didn't demand reranking).
- **Graceful degradation**: `GET /api/rag/status` → `disabled` /
  `not-indexed` / `indexed`; every path falls back to the M7 direct KB read.
- **Ingestion CLI** (`tools/ingest-kb.js`): chunk → prune → freshness TTL →
  embed → upsert; Windows-safe guards; refuses mock vectors and missing
  `MONGODB_URI` loudly.
- **Measurement** (`tools/rag-eval.js` + fixture, `docs/rag-measurement.md`,
  `docs/rag-eval-results.json`): latency / quota / relevance vs the
  no-retrieval baseline.
- **Owner walkthrough** (`docs/atlas-vector-index-walkthrough.md`): exact
  dashboard clicks + index JSON + troubleshooting.
- **ADR 012**, README section, 40 new tests.

## Acceptance (§13 M11)

"Done when a documented comparison against the non-retrieval pipeline shows
latency, quota use and question relevance" — delivered as
`docs/rag-measurement.md`:

| Dimension | Retrieval | Baseline |
|---|---|---|
| Latency | 0.5 ms avg (in-memory; ~50–200 ms est. on Atlas) | 0 ms |
| Quota | 1 embed call / retrieval (~10 worst-case per interview) | 0 |
| Relevance | hit rate 0.90, MRR 0.85 (10 hand-labelled queries) | 1.00 by construction |
| Planner prompt | ~443 chars top-k (84% smaller) | 2,832 chars whole-KB |

## Not done / honest caveats

- **No real embeddings here** (no keys on this machine): the eval ran on
  deterministic mock vectors, so the vector term was noise and keyword /
  metadata terms carried ranking. The doc states this up front, including
  the single miss that real embeddings should fix. Re-run
  `tools/rag-eval.js` on the deployed stack for real numbers.
- **Atlas index not created** (owner's manual step); ingest not run against
  real Atlas. The no-index fallback is the tested, working path until then.
- **Latency is an in-memory floor**; Atlas adds network RTT (budgeted in
  the doc).
- **Sample size n=10** — a write-up, not a paper; the harness ships for
  re-runs.

## Verification

- `npm test`: **313 tests, 310 pass, 0 fail, 3 skipped** (pre-existing M5
  browsercc-gated); 40 new M11 tests.
- `npm run build`: succeeds (bundle delta ≈ +12 KB).
- Live HTTP: `/api/health` 200; `/api/rag/status` 200 reporting `disabled`
  locally (no DB here) with an honest note;
  all servers killed, ports free.
- No secrets added; all new script guards Windows-safe.

## Owner follow-ups

1. Create the Vector Search index (`docs/atlas-vector-index-walkthrough.md`,
   ~5 min, one time).
2. `MONGODB_URI='...' node tools/ingest-kb.js --company "Nokia" --role "Associate Engineer"`
   (repeat per company; `--force` re-ingests after TTL).
3. Optional: re-run `node tools/rag-eval.js` against the real stack and
   compare with `docs/rag-eval-results.json`.
