# ADR 012 — RAG upgrade + measurement (Milestone 11) design

Date: 2026-11-04
Status: Accepted
Context: Spec §4.9 (knowledge base and RAG) + §5 (data model: `knowledge_chunks` with text, embedding, model name, metadata) + §13 M11 acceptance ("a documented comparison against the non-retrieval pipeline shows latency, quota use and question relevance"); M7 research KB (the chunk source); M8 planner (first retrieval consumer); M2 gateway `embed()` (gemini-embedding-001, 768d); M10 report (citation consumer).

## Decisions

### 1. VectorStore interface with Atlas + in-memory implementations
Spec: "Put it behind a VectorStore interface so a self-hosted Qdrant can replace it later without touching the app." `apps/api/src/rag/store.js` defines the interface (`upsert`, `query`, `deleteBySource`, `count`, `indexReady`) with `AtlasVectorStore` ($vectorSearch aggregation on `kb_chunks`) and `MemoryVectorStore` (cosine + identical metadata-filter semantics, for tests and no-DB runs). All Atlas specifics live in the subclass; a Qdrant port is one new file. `getVectorStore()` resolves Atlas when a DB is connected, memory otherwise.

### 2. One chunk per interview angle; compact everything else
The angle (topic + why) is the planner's highest-signal unit, so each gets its own chunk; overview, tech stack, practices, culture, and news become one or few chunks each. Chunks are capped at 600 chars — a company KB is ~15–30 chunks / a few KB, so the 512 MB Atlas cap is never a concern. Metadata carries the spec's full set (company, role, round, topic, difficulty, year, source_url, confidence) plus bookkeeping (kind, chunk_index, source_id, ingested_at, embedding_model, embedding_dim). `round` is null for KB chunks (company knowledge applies to all rounds); the matcher treats null as a wildcard.

### 3. Confidence is heuristic, documented, and pruned
Provenance fresh/cache/partial maps to 0.85/0.75/0.55 base confidence; angles and overview get +0.05, culture −0.2. The ingest tool prunes below 0.55 by default. These are judgement calls, not measurements — documented here so a future eval can tune them.

### 4. Embedding identity is enforced in code, not convention
`rag/embed.js` reads the canonical identity (model + dimensions) from the same `config.yaml` the gateway uses — one place to change. `checkEmbeddingIdentity()` rejects any embed result whose model/dimensions don't match ("never mix models in one index"); stored chunks carry model+dim and `chunkIdentityMatches()` gates reuse. Mock mode (no keys) is accepted for tests but the ingest tool refuses mock vectors for real indexes unless `--allow-mock`.

### 5. Hybrid = 0.7 vector + 0.3 keyword, metadata pre-filtered
Spec asks for hybrid retrieval (vector + keyword + metadata filters) and reranking "only if the evals show a need". The eval (docs/rag-measurement.md) shows the hybrid scorer ranking the right topic first 85% of the time even with mock embeddings, so no learned reranker was added. `setReranker()` is the seam if a future eval disagrees. Atlas applies metadata filters inside `$vectorSearch` (hence the `filter` fields in the index definition); the memory store mirrors the semantics.

### 6. Retrieval is strictly additive — the no-index path is a first-class citizen
`GET /api/rag/status` reports `disabled` / `not-indexed` / `indexed` honestly. Every retrieval entry point (`getRagContext`, `retrieveForTurn`) falls back to the M7 direct-KB read when the index isn't ready, and every failure inside retrieval degrades to "no retrieval" — the interview never breaks because of RAG. The index is created manually by the owner (docs/atlas-vector-index-walkthrough.md); the app cannot and does not depend on it existing.

### 7. Quota discipline: retrieval costs are bounded and visible
One embed call per planner run; per-turn retrieval only for ≥20-char messages in resume/cs/behavioral rounds with a 5-minute per-session cache; dedup embeds batched per turn. Worst case ~10 extra calls against the 300/day budget — and the planner prompt shrinks ~84% (measured), partly paying it back in tokens.

### 8. The miss is the finding
The eval's single miss ("protecting APIs from abuse with throttling" → expected `rate limiting`) fails on keyword overlap and would be fixed by real embeddings — the write-up says so explicitly rather than hiding it. The measurement doc leads with caveats (mock embeddings, n=10, in-memory latency floor) because a portfolio write-up that hides its limits is worthless.

### 9. Citations ride the session, not a second retrieval
Retrieved chunks' source URLs are stored on the interview session at start (`ragCitations`); the M10 report renders them as `sources`. No extra lookup at report time, and the direct-KB fallback still yields citations from the KB's source list.

## Consequences
- New: `apps/api/src/rag/` (store, chunk, embed, retrieve, index), `routes/rag.js`, `tools/ingest-kb.js`, `tools/rag-eval.js` + fixture, 40 new tests.
- Modified: planner (ragChunks), interview start/turn/stream (retrieval + dedup, best-effort), session schema (ragCitations, ragMode), report schema + generate (sources).
- Owner actions: create the Atlas index (walkthrough), run ingest-kb per company, optionally re-run the eval on the real stack.
